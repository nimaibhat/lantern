// The live dot from the sensors themselves. Each sensor stands where it was placed: in the room it is named after,
// the room picked for it on Tracking, or its pinned spot. Its signal says roughly how far away the tag is (the same
// "about N ft" Tracking shows), and the person goes on the walking route between the two nearest sensors, closer
// to the louder one. Equally loud at Bedroom 2 and the living room: halfway along the route between them, which is
// the hallway. Once the quieter one is twice as far, they are in the louder one's room.
//
// Steady on purpose: each sensor's signal is the median of its last few seconds, and the spot only changes when the
// sensors agree on a real change. The dot then glides there along the walking route, through the doorways and never
// through a wall, no faster than a brisk walk. The room changes once the dot has stayed in the new one a moment.

import { feetRatio } from "@/lib/sensing/feet";
import type { HomeModel, Vec2 } from "@/lib/types";
import { pathLength, pointAlong, polygonArea, roomAt, routeBetween } from "@/lib/world/geometry";
import type { FastEstimate } from "./fast";

const WINDOW_MS = 5000; // each sensor's signal: the median of its readings this recent
const LEVEL_S = 2; // and that median eased over about this long, so one odd reading cannot swing the dot
const LEAVE_T = 0.15; // in a sensor's room, the person leaves it only once the next sensor is this close to as loud
const RETURN_T = 0.06; // and between two sensors, goes back into the louder one's room once it is clearly louder
const SETTLE_S = 1.2; // the dot covers most of the way to a new spot in about this long
const STILL_IN = 12; // a new spot closer than this to the last one is noise, so the spot stays
const WALK_IN_S = 55; // no faster than a brisk walk (about 3 mph)
const ROOM_HOLD_MS = 1200; // the dot stays in a new room this long before the room changes

type Heard = { id: string; at: Vec2; rssi: number };
type Spot = { at: Vec2; spreadIn: number; share: number };

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export class BetweenSensors {
  readonly ready: boolean;
  lastReadingTs = 0;
  private anchors: Record<string, Vec2>;
  private readings = new Map<string, { rssi: number; ts: number }[]>();
  private levels = new Map<string, { rssi: number; ts: number }>();
  private between = false; // between two sensors' rooms, rather than in the louder one's
  private cur?: Vec2;
  private goal?: Spot;
  private path: Vec2[] = []; // from the dot to the goal, through doors
  private vel: Vec2 = { x: 0, y: 0 };
  private lastTs = 0;
  private room?: string;
  private next?: { room: string; since: number };
  private last?: FastEstimate;

  constructor(private home: HomeModel) {
    this.anchors = Object.fromEntries(home.anchors.map((a) => [a.receiverId, a.position]));
    this.ready = home.anchors.length > 0;
  }

  // One reading as it arrives. A sensor nobody has placed cannot say where anyone is, so it waits until it is.
  push(r: { receiverId: string; rssi: number; ts: number }) {
    if (!this.anchors[r.receiverId] || r.rssi <= -100) return;
    const list = this.readings.get(r.receiverId) ?? [];
    list.push({ rssi: r.rssi, ts: r.ts });
    this.readings.set(r.receiverId, list);
    this.lastReadingTs = Math.max(this.lastReadingTs, r.ts);
  }

  // The sensors that heard the tag lately, loudest first, each by the median of its recent signal
  nearest(ts: number, online: Record<string, boolean> = {}): Heard[] {
    const out: Heard[] = [];
    for (const [id, list] of this.readings) {
      const recent = list.filter((x) => ts - x.ts <= WINDOW_MS);
      this.readings.set(id, recent);
      if (!recent.length || online[id] === false) {
        this.levels.delete(id);
        continue;
      }
      const m = median(recent.map((x) => x.rssi)), prev = this.levels.get(id);
      const rssi = prev ? prev.rssi + (m - prev.rssi) * (1 - Math.exp(-Math.max(0, ts - prev.ts) / 1000 / LEVEL_S)) : m;
      this.levels.set(id, { rssi, ts });
      out.push({ id, at: this.anchors[id], rssi });
    }
    return out.sort((a, b) => b.rssi - a.rssi);
  }

  tick(ts: number, online: Record<string, boolean> = {}): FastEstimate | undefined {
    const heard = this.nearest(ts, online);
    if (!heard.length) return undefined;
    const spot = this.spot(heard);
    const dt = this.lastTs ? Math.min(1, Math.max(0, (ts - this.lastTs) / 1000)) : 0;
    this.lastTs = ts;

    if (!this.cur) {
      this.cur = { ...spot.at };
      this.goal = spot;
      this.path = [];
    } else if (!this.goal || Math.hypot(spot.at.x - this.goal.at.x, spot.at.y - this.goal.at.y) > STILL_IN) {
      this.goal = spot;
      this.path = this.route(this.cur, spot.at);
    } else this.goal = { ...this.goal, spreadIn: spot.spreadIn, share: spot.share };

    // Glide along the route: most of the way in SETTLE_S, never faster than a walk, and land exactly on the spot
    const left = pathLength(this.path);
    if (left > 0.5) {
      if (dt > 0) {
        const step = Math.min(left * (1 - Math.exp(-dt / SETTLE_S)), WALK_IN_S * dt);
        const next = pointAlong(this.path, step);
        this.vel = { x: (next.x - this.cur.x) / dt, y: (next.y - this.cur.y) / dt };
        this.cur = next;
        this.path = this.trim(this.path, step);
      }
    } else {
      if (this.path.length && this.goal) this.cur = { ...this.goal.at };
      this.path = [];
      this.vel = { x: 0, y: 0 };
    }
    const goal = this.goal!;

    // The room the dot is in, changed only once it has stayed in the new one. A dot in a doorway keeps its room.
    const here = roomAt(this.home, this.cur!)?.id;
    if (!this.room) this.room = here ?? roomAt(this.home, heard[0].at)?.id;
    else if (here && here !== this.room) {
      if (this.next?.room !== here) this.next = { room: here, since: ts };
      else if (ts - this.next.since >= ROOM_HOLD_MS) (this.room = here), (this.next = undefined);
    } else this.next = undefined;
    if (!this.room) return undefined;

    this.last = { x: this.cur!.x, y: this.cur!.y, spreadIn: goal.spreadIn, room: this.room, share: goal.share, velocity: this.vel };
    return this.last;
  }

  // Readings paused for a moment: stay where they were
  hold(): FastEstimate | undefined {
    return this.last && { ...this.last, velocity: { x: 0, y: 0 } };
  }

  reset() {
    this.readings.clear();
    this.levels.clear();
    this.between = false;
    this.cur = this.goal = this.room = this.next = this.last = undefined;
    this.path = [];
    this.vel = { x: 0, y: 0 };
    this.lastTs = this.lastReadingTs = 0;
  }

  // Where the two nearest sensors put the person
  private spot([a, b]: Heard[]): Spot {
    const inRoom = { at: a.at, spreadIn: this.radius(a.at), share: 0.9 };
    if (!b) return inRoom;
    // Equally far: halfway. The quieter one twice as far (about 8 dB quieter): at the louder one.
    const t = 0.5 * Math.max(0, Math.min(1, 1 - Math.log2(feetRatio(a.rssi, b.rssi))));
    // Hysteresis: a signal hovering near the line does not flick the person in and out of the room
    if (this.between ? t < RETURN_T : t <= LEAVE_T) {
      this.between = false;
      return inRoom;
    }
    this.between = true;
    const route = this.route(a.at, b.at);
    return { at: pointAlong(route, t * pathLength(route)), spreadIn: 36, share: 0.75 };
  }

  // What is left of a route after walking `d` along it
  private trim(points: Vec2[], d: number): Vec2[] {
    let left = d;
    for (let i = 1; i < points.length; i++) {
      const seg = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
      if (left < seg) return [pointAlong([points[i - 1], points[i]], left), ...points.slice(i)];
      left -= seg;
    }
    return [points[points.length - 1]];
  }

  // The walking route between two spots, through the doors between their rooms
  private route(from: Vec2, to: Vec2): Vec2[] {
    const ra = roomAt(this.home, from)?.id, rb = roomAt(this.home, to)?.id;
    if (!ra || !rb || ra === rb) return [from, to];
    const doors = routeBetween(this.home, ra, rb).slice(1, -1);
    return doors.length ? [from, ...doors, to] : [from, to];
  }

  // About how far across the sensor's room is: how unsure "in that room" is
  private radius(at: Vec2): number {
    const room = roomAt(this.home, at);
    return room ? Math.max(24, Math.min(120, Math.sqrt(polygonArea(room.polygon) / Math.PI))) : 48;
  }
}
