// Frame in, room / position / prediction out. No timers or I/O here, so tests and replays drive it directly;
// index.ts wires it to the monitor bus.

import type { HomeModel, LocationEvent, LocationSource, PositionEstimate, Prediction, SensorFrame, Vec2 } from "@/lib/types";
import { adjacency, clampToRoom, roomAt, roomPath, routeBetween } from "@/lib/world/geometry";
import { baselinePosterior } from "./baseline";
import { RoomHmm } from "./hmm";
import { MISSING, align, knnPosterior, usable, type KnnModel } from "./knn";
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
  stay?: number; // HMM self-transition per 1 s frame
  eps?: number; // HMM probability of a move the doors do not allow
  newId?: () => string;
}

const STALE_MS = 5000; // tag not heard for this long: stop moving the avatar
const GAP_MS = 15000; // tag silent this long: the person could be anywhere when it comes back

export class InferenceEngine {
  private hmm!: RoomHmm;
  private rooms: RoomTracker;
  private pos!: PositionTracker;
  private roomIds: string[] = [];
  private anchors: Record<string, Vec2> = {};
  private receiverRoom: Record<string, string> = {};
  private exits: Record<string, number> = {};
  private lastHeardTs = 0;
  private seq = 0;
  private last: { frame?: SensorFrame; posterior?: Record<string, number>; belief?: Record<string, number>; raw?: Vec2; prediction?: Prediction } = {};

  constructor(private home: HomeModel, private models: Models, private opts: EngineOptions = {}) {
    const hop = opts.useHmm === false ? undefined : (a: string, b: string) => roomPath(this.home, a, b)[1] ?? b;
    this.rooms = new RoomTracker(opts.threshold ?? 0.7, opts.steps ?? 2, hop, opts.fast ?? 0.95);
    this.setHome(home);
  }

  setHome(home: HomeModel) {
    this.home = home;
    this.roomIds = home.rooms.map((r) => r.id);
    this.anchors = Object.fromEntries(home.anchors.map((a) => [a.receiverId, a.position]));
    this.exits = Object.fromEntries(Object.entries(adjacency(home)).map(([r, n]) => [r, new Set(n).size]));
    this.receiverRoom = Object.fromEntries(home.anchors.map((a) => [a.receiverId, roomAt(home, a.position)?.id ?? a.receiverId]));
    this.restart();
  }

  // Forget where the person was: after a home model change, or when the tag comes back from a long silence
  private restart() {
    this.hmm = new RoomHmm(this.roomIds, this.home.doors.map((d) => [d.roomA, d.roomB]), this.opts.stay ?? 0.95, this.opts.eps ?? 1e-6);
    this.rooms.reset();
    this.pos = new PositionTracker(this.opts.smoothing ?? 0.5, this.opts.maxSpeed ?? 100);
  }

  setModels(models: Models) {
    this.models = models;
  }

  onFrame(f: SensorFrame): InferenceEvent[] {
    this.last.frame = f;
    // Nobody hears the tag (out of range, or the tag app closed): hold the last belief rather than learn from silence
    if (!f.rssi.some((v) => v > MISSING)) return [];
    if (this.lastHeardTs && f.ts - this.lastHeardTs > GAP_MS) this.restart();
    this.lastHeardTs = f.ts;

    const knn = this.models.knn;
    const posterior = knn?.algo === "knn" && knn.vectors.length
      ? knnPosterior(knn, align(f, knn.order), this.opts.maskOffline === false ? undefined : usable(f, knn.order))
      : baselinePosterior(f.order, f.rssi, this.roomIds, this.receiverRoom);
    const belief = this.opts.useHmm === false ? posterior : this.hmm.step(posterior);

    const raw = estimatePosition(f.rssi, f.order, this.anchors);
    this.last = { ...this.last, posterior, belief, raw };

    const change = this.rooms.step(belief);
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
    };
  }

  get room() { return this.rooms.room; }

  describe() {
    const { knn, markov } = this.models;
    return {
      classifier: knn?.algo === "knn" && knn.vectors.length ? `knn k=${knn.k} (${knn.vectors.length} vectors)` : "strongest receiver",
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
