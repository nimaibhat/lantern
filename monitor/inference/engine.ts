// Frame in, room / position / prediction out. No timers or I/O here, so tests and replays drive it directly;
// index.ts wires it to the monitor bus.

import type { Anchor, HomeModel, LocationEvent, LocationSource, PositionEstimate, Prediction, SensorFrame, Vec2 } from "@/lib/types";
import { adjacency, clampToRoom, innerPoint, roomAt, roomPath, routeBetween } from "@/lib/world/geometry";
import { baselinePosterior } from "./baseline";
import { RoomHmm } from "./hmm";
import { MISSING, align, knnPosterior, usable, type KnnModel } from "./knn";
import { FastPositioner, type FastOptions } from "./fast";
import { FloorFilter, type FloorFilterOptions } from "./floor-filter";
import { PositionTracker, estimatePosition } from "./position";
import { predictNext, type MarkovModel } from "./predictor";
import { RoomTracker } from "./tracker";

export type InferenceEvent = { k: "location"; d: LocationEvent } | { k: "prediction"; d: Prediction };
export interface Models { knn?: KnnModel; markov?: MarkovModel }

export interface EngineOptions {
  useHmm?: boolean; // false turns off the door graph (HMM and door hops), for the with/without comparison
  maskOffline?: boolean; // false compares unplugged listeners as -100, for the before/after comparison
  source?: LocationSource;
  hourOf?: (ts: number) => number; // 0 to 24, for the predictor's time-of-day context
  minPrediction?: number;
  // Defaults picked by sweeping the fake route sessions (tools/vineet-replay.ts). steps = 3 halves false
  // redirects but adds about 1 s of delay; fast = 0.95 cut the median room-change delay from 3 s to 2 s with no
  // more false redirects; smoothing barely moves the error (BLE is the limit), so the lighter, quicker 0.5 wins.
  threshold?: number; // room tracker hysteresis
  steps?: number;
  fast?: number; // a door-graph belief this high changes rooms after one frame instead of `steps`
  smoothing?: number; // avatar filter: share of the way to the raw estimate per 200 ms tick
  maxSpeed?: number; // avatar speed limit, inches per second
  positioner?: "grid" | "centroid"; // grid: the wall-aware floor filter; centroid: the old weighted centroid, for comparison
  floor?: FloorFilterOptions;
  live?: false | FastOptions; // the low-lag dot from raw readings; off, or tuned. Without raw readings the frame path draws the dot
  stay?: number; // HMM self-transition per 1 s frame
  eps?: number; // HMM probability of a move the doors do not allow
  newId?: () => string;
}

const slug = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// A listener named after a scanned room ("kitchen", "Bedroom 2") counts as standing in that room until someone
// places it exactly, so a new home pinpoints as soon as its laptops are named. A placed anchor always wins.
export function namedAnchors(home: HomeModel, ids: Iterable<string>): Anchor[] {
  const placed = new Set(home.anchors.map((a) => a.receiverId));
  const out: Anchor[] = [];
  for (const id of ids) {
    if (placed.has(id)) continue;
    const room = home.rooms.find((r) => !r.virtual && r.polygon.length >= 3 && (slug(r.id) === slug(id) || slug(r.name) === slug(id)));
    if (room) out.push({ receiverId: id, position: innerPoint(room.polygon), heightIn: 36 });
  }
  return out;
}

const STALE_MS = 5000; // tag not heard for this long: stop moving the avatar
const GAP_MS = 15000; // tag silent this long: the person could be anywhere when it comes back

export class InferenceEngine {
  private hmm!: RoomHmm;
  private rooms: RoomTracker;
  private pos!: PositionTracker;
  private floor?: FloorFilter;
  private fast?: FastPositioner;
  private online: Record<string, boolean> = {};
  private gridRooms = false; // no trained model for this home: the floor grid decides the room too
  private spreadIn?: number;
  private roomIds: string[] = [];
  private anchors: Record<string, Vec2> = {};
  private receiverRoom: Record<string, string> = {};
  private exits: Record<string, number> = {};
  private lastHeardTs = 0;
  private seq = 0;
  private last: { frame?: SensorFrame; posterior?: Record<string, number>; belief?: Record<string, number>; raw?: Vec2; prediction?: Prediction } = {};

  private base!: HomeModel; // the home as loaded; `home` adds listeners placed by their names
  private heard = new Set<string>();

  constructor(private home: HomeModel, private models: Models, private opts: EngineOptions = {}) {
    const hop = opts.useHmm === false ? undefined : (a: string, b: string) => roomPath(this.home, a, b)[1] ?? b;
    this.rooms = new RoomTracker(opts.threshold ?? 0.7, opts.steps ?? 2, hop, opts.fast ?? 0.95);
    this.setHome(home);
  }

  setHome(base: HomeModel) {
    this.base = base;
    const home = { ...base, anchors: [...base.anchors, ...namedAnchors(base, this.heard)] };
    this.home = home;
    this.roomIds = home.rooms.map((r) => r.id);
    this.anchors = Object.fromEntries(home.anchors.map((a) => [a.receiverId, a.position]));
    this.exits = Object.fromEntries(Object.entries(adjacency(home)).map(([r, n]) => [r, new Set(n).size]));
    this.receiverRoom = Object.fromEntries(home.anchors.map((a) => [a.receiverId, roomAt(home, a.position)?.id ?? a.receiverId]));
    const floor = this.opts.positioner === "centroid" ? undefined : new FloorFilter(home, this.opts.floor);
    this.floor = floor?.ready ? floor : undefined;
    const fast = this.opts.live === false ? undefined : new FastPositioner(home, this.opts.live);
    this.fast = fast?.ready ? fast : undefined;
    this.fitModels();
    this.restart();
  }

  // Forget where the person was: after a home model change, or when the tag comes back from a long silence
  private restart() {
    this.hmm = new RoomHmm(this.roomIds, this.home.doors.map((d) => [d.roomA, d.roomB]), this.opts.stay ?? 0.95, this.opts.eps ?? 1e-6);
    this.rooms.reset();
    this.pos = new PositionTracker(this.opts.smoothing ?? 0.5, this.opts.maxSpeed ?? 100);
    this.floor?.reset();
    this.fast?.reset();
    this.spreadIn = undefined;
  }

  setModels(models: Models) {
    this.models = models;
    this.fitModels();
  }

  // A kNN trained on another home (other rooms, other listeners) cannot say anything here: a freshly scanned home
  // has no model of its own yet. Its floor grid, which knows the rooms and walls, picks the room instead. With no
  // model at all the strongest receiver still decides, as before.
  private fitModels() {
    const knn = this.models.knn;
    const rooms = new Set(this.roomIds), placed = new Set(Object.keys(this.anchors));
    const fits = !!knn && knn.rooms.every((r) => rooms.has(r)) && knn.order.filter((id) => placed.has(id)).length >= 2;
    this.gridRooms = !!this.floor && !!knn && knn.algo === "knn" && !fits;
  }

  // One raw reading, the moment it arrives. Feeds only the dot; rooms come from frames.
  onReading(r: { receiverId: string; rssi: number; ts: number }) {
    this.hear(r.receiverId);
    this.fast?.push(r);
  }

  // A listener heard for the first time: if its name matches a room and nobody placed it, put it there and rebuild.
  private hear(id: string) {
    if (this.heard.has(id)) return;
    this.heard.add(id);
    if (!this.anchors[id] && namedAnchors(this.base, [id]).length) this.setHome(this.base);
  }

  onFrame(f: SensorFrame): InferenceEvent[] {
    f.order.forEach((id, i) => f.rssi[i] > MISSING && this.hear(id));
    this.last.frame = f;
    this.online = f.online;
    // Nobody hears the tag (out of range, or the tag app closed): hold the last belief rather than learn from silence
    if (!f.rssi.some((v) => v > MISSING)) return [];
    if (this.lastHeardTs && f.ts - this.lastHeardTs > GAP_MS) this.restart();
    this.lastHeardTs = f.ts;

    const knn = this.models.knn;
    const gridStep = this.gridRooms && !!this.floor?.step(f.order, f.rssi, f.online);
    const posterior = gridStep
      ? this.floor!.rooms()
      : knn?.algo === "knn" && knn.vectors.length
        ? knnPosterior(knn, align(f, knn.order), this.opts.maskOffline === false ? undefined : usable(f, knn.order))
        : baselinePosterior(f.order, f.rssi, this.roomIds, this.receiverRoom);
    const belief = this.opts.useHmm === false ? posterior : this.hmm.step(posterior);

    const change = this.rooms.step(belief);
    // The spot inside the room: the floor grid when the home has listeners with known positions, else the old
    // weighted centroid. The grid is read inside the room the tracker believes, so the two never disagree.
    let raw: Vec2 | undefined;
    if (this.floor && (gridStep || this.floor.step(f.order, f.rssi, f.online, belief))) {
      const est = this.floor.estimate(this.rooms.room);
      raw = est && { x: est.x, y: est.y };
      this.spreadIn = est?.spreadIn;
    } else if (!this.floor) raw = estimatePosition(f.rssi, f.order, this.anchors);
    this.last = { ...this.last, posterior, belief, raw };
    if (raw) this.pos.setTarget(raw);
    if (!change) return [];

    if (change.prev) this.pos.enterRoom(routeBetween(this.home, change.prev, change.room).slice(1, -1)); // door centers
    const events: InferenceEvent[] = [{
      k: "location",
      d: {
        id: this.opts.newId?.() ?? `loc-${f.ts}-${this.seq++}`,
        householdId: this.home.householdId,
        roomId: change.room,
        prevRoomId: change.prev,
        confidence: round(change.confidence, 3),
        source: this.opts.source ?? "ble",
        ts: new Date(f.ts).toISOString(),
      },
    }];

    // A room with one way out (bedroom > hallway) has nothing worth predicting
    const markov = this.exits[change.room] > 1 ? this.models.markov : undefined;
    const hour = (this.opts.hourOf ?? localHour)(f.ts);
    const next = markov && predictNext(markov, change.prev, change.room, hour);
    if (next && next.probability >= (this.opts.minPrediction ?? 0.5)) {
      const d = { ts: f.ts, fromRoomId: change.room, nextRoomId: next.nextRoomId, probability: round(next.probability, 3) };
      this.last.prediction = d;
      events.push({ k: "prediction", d });
    }
    return events;
  }

  // Call about every 200 ms. Returns nothing until a room is known, or when frames stop.
  tick(ts: number): PositionEstimate | undefined {
    // Live readings: the fast dot, not held to the believed room (the floor grid keeps it out of walls)
    if (this.fast && this.fast.lastReadingTs && ts - this.fast.lastReadingTs <= STALE_MS) {
      const e = this.fast.tick(ts, this.online, this.last.belief);
      // The fast path learns this home's walls; the frame grid uses what it learned
      if (this.floor && this.floor.wallDb !== this.fast.wallDb) this.floor.setWallDb(this.fast.wallDb);
      // No listener with a known position hears the tag: fall through to the frame path below
      if (e) return {
        ts, x: round(e.x, 1), y: round(e.y, 1), roomId: this.rooms.room ?? e.room, confidence: round(this.rooms.confidence, 3),
        source: this.opts.source ?? "ble", velocity: { x: round(e.velocity.x, 1), y: round(e.velocity.y, 1) }, spreadIn: Math.round(e.spreadIn),
      };
    }
    const room = this.rooms.room;
    if (!room || ts - this.lastHeardTs > STALE_MS) return;
    const p = this.pos.step(ts, (q) => clampToRoom(this.home, room, q));
    if (!p) return;
    const v = this.pos.velocity;
    // Walking to the door after a room change, the avatar is still in the old room; say so
    const roomId = this.pos.inTransit ? roomAt(this.home, p)?.id ?? room : room;
    return {
      ts, x: round(p.x, 1), y: round(p.y, 1), roomId, confidence: round(this.rooms.confidence, 3),
      source: this.opts.source ?? "ble", velocity: v && { x: round(v.x, 1), y: round(v.y, 1) },
      spreadIn: this.spreadIn === undefined ? undefined : Math.round(this.spreadIn),
    };
  }

  get room() { return this.rooms.room; }

  // The floor grid's likely cells, for the plan's cloud. Empty with the centroid positioner.
  cloud() {
    return this.floor ? { cellIn: this.floor.cellIn, cells: this.floor.cloud() } : { cellIn: 0, cells: [] };
  }

  describe() {
    const { knn, markov } = this.models;
    return {
      classifier: this.gridRooms ? "floor grid (no model trained for this home)" : knn?.algo === "knn" && knn.vectors.length ? `knn k=${knn.k} (${knn.vectors.length} vectors)` : "strongest receiver",
      positioner: this.floor ? `floor grid (${this.floor.cells.length} cells)` : "weighted centroid",
      accuracy: knn?.accuracy, dataset: knn?.dataset, trainedAt: knn?.createdAt,
      predictor: markov ? `markov (${Object.keys(markov.counts).length} contexts)` : "none",
      hmm: this.opts.useHmm !== false, rooms: this.roomIds, receivers: Object.keys(this.anchors).sort(),
    };
  }

  debug() {
    return {
      ...this.describe(),
      room: this.rooms.room, confidence: this.rooms.confidence, candidate: this.rooms.candidate,
      posterior: roundAll(this.last.posterior), belief: roundAll(this.last.belief),
      raw: this.last.raw && { x: round(this.last.raw.x, 1), y: round(this.last.raw.y, 1) },
      smoothed: this.pos.current && { x: round(this.pos.current.x, 1), y: round(this.pos.current.y, 1) },
      spreadIn: this.spreadIn === undefined ? undefined : Math.round(this.spreadIn),
      lastPrediction: this.last.prediction, lastHeardTs: this.lastHeardTs,
      listeners: this.last.frame && Object.fromEntries(this.last.frame.order.map((id, i) => [id, {
        rssi: this.last.frame!.rssi[i], online: this.last.frame!.online[id] !== false,
      }])),
    };
  }
}

function localHour(ts: number) {
  const d = new Date(ts);
  return d.getHours() + d.getMinutes() / 60;
}

const round = (v: number, dp: number) => Math.round(v * 10 ** dp) / 10 ** dp;
const roundAll = (r?: Record<string, number>) => r && Object.fromEntries(Object.entries(r).map(([k, v]) => [k, round(v, 3)]));

export type InferenceDebug = ReturnType<InferenceEngine["debug"]> & { serverTs?: number };
