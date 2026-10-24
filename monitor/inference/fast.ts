// The dot on the plan, with as little lag as the radio allows. Every raw reading moves its listener's level at once
// (no 3 s median), and the floor grid steps ten times a second. The dot is not held inside the room the tracker
// believes: the grid already keeps it out of walls, so it walks through the doorway as the person does, and the
// room label catches up a moment later. A short lead along the person's velocity covers what lag is left.
//
// Only the dot comes from here. Room changes, alerts and predictions stay on the steadier one-second path.

import type { HomeModel, Vec2 } from "@/lib/types";
import { edgeDistance, innerPoint, roomAt } from "@/lib/world/geometry";
import { FloorFilter, type FloorFilterOptions } from "./floor-filter";

export interface FastOptions {
  tauMs?: number; // how quickly a listener's level follows new readings
  heardMs?: number; // a listener with no reading for this long is not hearing the tag
  leadMs?: number; // draw the dot this far ahead along its velocity
  stepMs?: number; // how often tick is called; sets how much each step counts as evidence
  floor?: FloorFilterOptions;
}

export const FAST_DEFAULTS = { tauMs: 400, heardMs: 1500, leadMs: 300, stepMs: 100 }; // tools/position-lag.ts: about 0.7 s behind, little wobble
const FAST_FLOOR: FloorFilterOptions = { cellIn: 10, walkIn: 20, stillIn: 9, modeIn: 48, roomWeight: 0.15 };
const CLIP_DB = 10; // one odd reading moves a level at most this far
const WALL_CANDIDATES = [2, 4, 6, 9, 12]; // dB per wall: from thin partitions to brick
const WALL_HALF_LIFE_S = 120; // walls are judged on the last few minutes of readings
const WALL_EVERY_MS = 30_000; // and switched at most this often, only when clearly better
const LABEL_IN = 18; // the label moves to a new room once the dot is this far inside it (less in a narrow room), so a doorway does not flicker
const CATCH_UP = 120; // in/s: fast enough to catch up after a doorway, slow enough that the dot never jumps across the plan

export interface FastEstimate { x: number; y: number; spreadIn: number; room: string; share: number; velocity: Vec2 } // room: where the dot is; share: belief in that room

export class FastPositioner {
  private level = new Map<string, { v: number; ts: number }>();
  private grid: FloorFilter;
  private o: typeof FAST_DEFAULTS;
  private prev?: { x: number; y: number; ts: number };
  private vel: Vec2 = { x: 0, y: 0 };
  private shown?: { x: number; y: number; ts: number }; // the dot as drawn: it walks, through doorways, toward the estimate
  private label?: string; // the room the dot is in, with a little hysteresis at doorways
  private depth: Record<string, number>; // how far from its walls each room's most open spot is
  private last?: FastEstimate;
  private wallScore = WALL_CANDIDATES.map(() => 0);
  private wallAt = { judged: 0, chose: 0 };
  lastReadingTs = 0;

  constructor(private home: HomeModel, opts: FastOptions = {}) {
    this.o = { ...FAST_DEFAULTS, ...opts };
    this.grid = new FloorFilter(home, { ...FAST_FLOOR, ...opts.floor });
    this.depth = Object.fromEntries(home.rooms.map((r) => [r.id, r.polygon.length >= 3 ? edgeDistance(innerPoint(r.polygon), r.polygon) : 0]));
  }

  get ready() { return this.grid.ready; }

  reset() {
    this.level.clear();
    this.grid.reset();
    this.prev = undefined;
    this.shown = undefined;
    this.label = undefined;
    this.last = undefined;
    this.vel = { x: 0, y: 0 }; // the learned walls stay: they belong to the home, not to this stretch of readings
  }

  push(r: { receiverId: string; rssi: number; ts: number }) {
    this.lastReadingTs = Math.max(this.lastReadingTs, r.ts);
    const cur = this.level.get(r.receiverId);
    if (!cur || r.ts - cur.ts > this.o.heardMs) {
      this.level.set(r.receiverId, { v: r.rssi, ts: r.ts });
      return;
    }
    const a = 1 - Math.exp(-Math.max(r.ts - cur.ts, 1) / this.o.tauMs);
    const d = Math.max(-CLIP_DB, Math.min(CLIP_DB, r.rssi - cur.v));
    this.level.set(r.receiverId, { v: cur.v + a * d, ts: r.ts });
  }

  tick(ts: number, online: Record<string, boolean> = {}, roomBelief?: Record<string, number>): FastEstimate | undefined {
    const order = [...this.level.keys()];
    const rssi = order.map((id) => {
      const l = this.level.get(id)!;
      return ts - l.ts <= this.o.heardMs ? l.v : -100;
    });
    // Each step sees mostly the same smoothed levels as the last, so it counts as a fraction of one reading
    if (!this.grid.step(order, rssi, online, roomBelief, Math.min(1, this.o.stepMs / this.o.tauMs))) return;
    this.learnWalls(ts, order, rssi, online);
    const est = this.grid.locate();
    if (!est) return;

    if (this.prev && ts > this.prev.ts) {
      const dt = (ts - this.prev.ts) / 1000, k = 1 - Math.exp(-dt / 0.4);
      this.vel = { x: this.vel.x + k * ((est.x - this.prev.x) / dt - this.vel.x), y: this.vel.y + k * ((est.y - this.prev.y) / dt - this.vel.y) };
    }
    this.prev = { x: est.x, y: est.y, ts };

    // Lead: a little ahead along the way the person is moving, unless that would cross a wall or leave the home
    const lead = this.o.leadMs / 1000;
    const ahead = { x: est.x + this.vel.x * lead, y: est.y + this.vel.y * lead };
    const goal = this.grid.clear(est, ahead) && roomAt(this.home, ahead) ? ahead : est;
    const p = this.walk(goal, ts);

    // The location shown is the room the dot is standing in, so the words and the pinpoint always agree
    const here = roomAt(this.home, p)?.id ?? est.room;
    if (!this.label || (here !== this.label && this.inside(here, p))) this.label = here;
    const rooms = this.grid.rooms(), total = Object.values(rooms).reduce((a, b) => a + b, 0) || 1;
    this.last = { x: p.x, y: p.y, spreadIn: est.spreadIn, room: this.label, share: (rooms[this.label] ?? 0) / total, velocity: this.vel };
    return this.last;
  }

  // The last dot, standing still: for a moment when readings drop out, so the dot holds its place instead of
  // handing over to another estimate and sliding across the plan.
  hold(): FastEstimate | undefined {
    return this.last && { ...this.last, velocity: { x: 0, y: 0 } };
  }

  private inside(roomId: string, p: Vec2) {
    const room = this.home.rooms.find((r) => r.id === roomId);
    // A narrow hallway is only a couple of feet from wall to wall, so its buffer shrinks with it
    return !room || edgeDistance(p, room.polygon) >= Math.min(LABEL_IN, 0.4 * (this.depth[roomId] ?? 0));
  }

  get wallDb() { return this.grid.wallDb; }

  // Learn this home's loss per wall from the readings: once a second, score each candidate; every 30 s, move to the
  // best if it is clearly better. Thin walls read as "close" to too many listeners at once with the wrong value.
  private learnWalls(ts: number, order: string[], rssi: number[], online: Record<string, boolean>) {
    if (ts - this.wallAt.judged < 1000) return;
    const dt = this.wallAt.judged ? Math.min(ts - this.wallAt.judged, 5000) / 1000 : 1;
    this.wallAt.judged = ts;
    const costs = this.grid.wallCosts(order, rssi, online, WALL_CANDIDATES);
    if (!costs) return;
    const keep = Math.pow(0.5, dt / WALL_HALF_LIFE_S);
    this.wallScore = this.wallScore.map((s, i) => keep * s + costs[i]);
    if (!this.wallAt.chose) this.wallAt.chose = ts;
    if (ts - this.wallAt.chose < WALL_EVERY_MS) return;
    this.wallAt.chose = ts;
    const now = WALL_CANDIDATES.indexOf(this.grid.wallDb);
    const best = this.wallScore.indexOf(Math.min(...this.wallScore));
    if (best !== now && (now < 0 || this.wallScore[best] < 0.97 * this.wallScore[now])) this.grid.setWallDb(WALL_CANDIDATES[best]);
  }

  // Move the drawn dot toward the goal like a person would: straight when nothing is in the way, otherwise to the
  // doorway first, never faster than CATCH_UP. So the trail it leaves never passes through a wall.
  private walk(goal: Vec2, ts: number): Vec2 {
    const s = this.shown;
    if (!s) {
      this.shown = { ...goal, ts };
      return goal;
    }
    let to = goal;
    if (!this.grid.clear(s, goal)) {
      // Along the grid's walkable cells, aiming at the farthest one still in plain sight, so the dot takes the
      // doorway the way a person would and never cuts through a wall. No way through (a missed door): go straight.
      const path = this.grid.route(s, goal);
      if (path?.length) {
        let i = 0;
        while (i + 1 < path.length && this.grid.clear(s, path[i + 1])) i++;
        to = path[i];
      }
    }
    const d = Math.hypot(to.x - s.x, to.y - s.y), max = (CATCH_UP * Math.max(ts - s.ts, 1)) / 1000;
    const k = d > max ? max / d : 1;
    this.shown = { x: s.x + (to.x - s.x) * k, y: s.y + (to.y - s.y) * k, ts };
    return this.shown;
  }
}
