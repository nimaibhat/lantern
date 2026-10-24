// Where in the home, not just which room. A grid over the scanned floor is scored each second against what every
// listener hears. The model knows the walls (each one between the tag and a listener costs a few dB) and how far a
// person can walk in a second without passing through one, so "loudest in the bedroom, nearly as loud in the
// living room" lands near the doorway between them instead of on top of the bedroom listener.
//
// It compares listeners with each other rather than trusting absolute levels: a phone in a pocket is quieter at
// every listener at once, which says nothing about where it is.

import type { HomeModel, Vec2 } from "@/lib/types";
import { pointInPolygon } from "@/lib/world/geometry";
import { wallPieces, type Seg } from "@/lib/world/walls";

export interface FloorFilterOptions {
  cellIn?: number; // grid spacing, inches
  txPower?: number; // dBm heard at 1 m
  n?: number; // path-loss exponent
  wallDb?: number; // loss per wall between the tag and a listener
  sigmaDb?: number; // spread of a reading around the model: noise, body and the phone's own bias
  floorDb?: number; // at or below this a listener is not hearing the tag
  walkIn?: number; // how far a person moves between two frames, inches
  roomWeight?: number; // how much the room classifier's belief counts against the signal model (0 ignores it)
  stillIn?: number; // spread of the step kernel: most seconds a person barely moves, so belief can sharpen
  biasDb?: number; // how far a phone's overall level may sit from the model; Infinity compares listeners only
  modeIn?: number; // read the spot from cells this close to the most likely one (Infinity: the whole room), so two candidate areas are not averaged into a wall
}

export const FLOOR_DEFAULTS: Required<FloorFilterOptions> = { cellIn: 12, txPower: -59, n: 2.5, wallDb: 6, sigmaDb: 5, floorDb: -95, walkIn: 48, roomWeight: 0.5, stillIn: 24, biasDb: Infinity, modeIn: Infinity };

export interface Cell { x: number; y: number; room: string }
export interface FloorEstimate { x: number; y: number; spreadIn: number; room: string; share: number } // share: probability inside `room`

const HUBER = 2; // residuals past 2 sigma count linearly, so one bad listener cannot veto the right spot
const UNIFORM = 0.02; // share of belief spread evenly each frame, so a wrong lock can recover

export class FloorFilter {
  readonly cells: Cell[] = [];
  private expected = new Map<string, Float64Array>(); // receiverId -> expected RSSI at each cell
  private open = new Map<string, Float64Array>(); // receiverId -> expected RSSI at each cell before walls
  private wallCount = new Map<string, Uint8Array>(); // receiverId -> walls between it and each cell
  private reach: { to: Int32Array; w: Float64Array }[] = [];
  private near: number[][] = []; // walkable neighbours of each cell
  private p: Float64Array;
  private o: Required<FloorFilterOptions>;
  private walls: Seg[];

  constructor(home: HomeModel, opts: FloorFilterOptions = {}) {
    this.o = { ...FLOOR_DEFAULTS, ...opts };
    const { cellIn } = this.o;
    const rooms = home.rooms.filter((r) => !r.virtual && r.polygon.length >= 3);
    const pts = rooms.flatMap((r) => r.polygon);
    const index = new Map<string, number>();
    if (pts.length) {
      const x0 = Math.min(...pts.map((p) => p.x)), x1 = Math.max(...pts.map((p) => p.x));
      const y0 = Math.min(...pts.map((p) => p.y)), y1 = Math.max(...pts.map((p) => p.y));
      for (let gy = 0, y = y0 + cellIn / 2; y < y1; gy++, y += cellIn) {
        for (let gx = 0, x = x0 + cellIn / 2; x < x1; gx++, x += cellIn) {
          const room = rooms.find((r) => pointInPolygon({ x, y }, r.polygon));
          if (!room) continue;
          index.set(`${gx},${gy}`, this.cells.length);
          this.cells.push({ x, y, room: room.id });
        }
      }
    }
    const walls = (this.walls = wallPieces(home));

    // What each listener should hear from each cell: distance plus the walls in between. The two parts are kept apart
    // so the loss per wall can be relearned for this home without walking the walls again.
    for (const a of home.anchors) {
      const open = new Float64Array(this.cells.length), count = new Uint8Array(this.cells.length);
      this.cells.forEach((c, i) => {
        const dM = Math.max(Math.hypot(c.x - a.position.x, c.y - a.position.y) * 0.0254, 0.3);
        open[i] = this.o.txPower - 10 * this.o.n * Math.log10(dM);
        count[i] = crossings(c, a.position, walls);
      });
      this.open.set(a.receiverId, open);
      this.wallCount.set(a.receiverId, count);
    }
    this.setWallDb(this.o.wallDb);

    // Where a person in each cell could be one frame later: a short walk on the grid that never crosses a wall.
    const keys = [...index.keys()].map((k) => k.split(",").map(Number));
    const near: number[][] = (this.near = this.cells.map(() => []));
    keys.forEach(([gx, gy], i) => {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const j = index.get(`${gx + dx},${gy + dy}`);
        if (j !== undefined && !blocked(this.cells[i], this.cells[j], walls)) near[i].push(j);
      }
    });
    const depth = Math.max(1, Math.ceil(this.o.walkIn / cellIn)), s2 = 2 * this.o.stillIn ** 2;
    this.reach = this.cells.map((_, i) => {
      const dist = new Map<number, number>([[i, 0]]);
      let frontier = [i];
      for (let step = 0; step < depth && frontier.length; step++) {
        const next: number[] = [];
        for (const a of frontier)
          for (const b of near[a]) {
            const d = dist.get(a)! + Math.hypot(this.cells[a].x - this.cells[b].x, this.cells[a].y - this.cells[b].y);
            if (d <= this.o.walkIn && (!dist.has(b) || d < dist.get(b)!)) {
              if (!dist.has(b)) next.push(b);
              dist.set(b, d);
            }
          }
        frontier = next;
      }
      const to = Int32Array.from(dist.keys()), w = Float64Array.from([...dist.values()].map((d) => Math.exp(-(d * d) / s2)));
      const z = w.reduce((s, v) => s + v, 0);
      return { to, w: w.map((v) => v / z) };
    });
    this.p = new Float64Array(this.cells.length).fill(this.cells.length ? 1 / this.cells.length : 0);
  }

  get ready() { return this.cells.length > 0 && this.expected.size > 0; }

  reset() { this.p.fill(this.cells.length ? 1 / this.cells.length : 0); }

  // One frame of readings. roomBelief (from the room classifier and door graph) nudges the grid toward rooms the
  // rest of the pipeline agrees with. weight below 1 counts the readings as partial evidence, for a fast loop that
  // sees the same smoothed levels several times a second. Returns false when no listener with a known position
  // hears the tag.
  step(order: string[], rssi: number[], online: Record<string, boolean>, roomBelief?: Record<string, number>, weight = 1): boolean {
    const heard: { e: Float64Array; v: number }[] = [], silent: Float64Array[] = [];
    order.forEach((id, k) => {
      const e = this.expected.get(id);
      if (!e || online[id] === false) return;
      if (rssi[k] > this.o.floorDb) heard.push({ e, v: rssi[k] });
      else silent.push(e);
    });
    if (!heard.length) return false;

    const n = this.cells.length, q = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const pi = this.p[i];
      if (pi < 1e-12) continue;
      const { to, w } = this.reach[i];
      for (let k = 0; k < to.length; k++) q[to[k]] += pi * w[k];
    }

    const { sigmaDb, floorDb, roomWeight, biasDb } = this.o;
    const shrink = (sigmaDb / biasDb) ** 2;
    const ll = new Float64Array(n);
    let best = -Infinity;
    for (let j = 0; j < n; j++) {
      // The phone's overall offset at this cell, shrunk toward zero by how large an offset is plausible
      let mean = 0;
      for (const h of heard) mean += h.v - h.e[j];
      mean /= heard.length + shrink;
      let s = 0;
      for (const h of heard) s += huber((h.v - h.e[j] - mean) / sigmaDb);
      // A listener that is on but silent is evidence against cells it should hear clearly
      for (const e of silent) if (e[j] + mean > floorDb) s += huber((e[j] + mean - floorDb) / sigmaDb);
      ll[j] = weight * (-0.5 * s + (roomBelief && roomWeight ? roomWeight * Math.log((roomBelief[this.cells[j].room] ?? 0) + 0.02) : 0));
      if (ll[j] > best) best = ll[j];
    }
    let z = 0;
    for (let j = 0; j < n; j++) {
      this.p[j] = ((1 - UNIFORM) * q[j] + UNIFORM / n) * Math.exp(ll[j] - best);
      z += this.p[j];
    }
    for (let j = 0; j < n; j++) this.p[j] /= z || 1;
    return true;
  }

  // The most likely spot, as the probability-weighted mean of the cells, and how spread out they are. With `room`,
  // only that room's cells count, so the dot agrees with the room the rest of the pipeline reports.
  estimate(room?: string): FloorEstimate | undefined {
    let w = 0, sx = 0, sy = 0, total = 0;
    const byRoom: Record<string, number> = {};
    this.cells.forEach((c, i) => {
      total += this.p[i];
      byRoom[c.room] = (byRoom[c.room] ?? 0) + this.p[i];
    });
    const target = room && byRoom[room] !== undefined ? room : Object.entries(byRoom).sort((a, b) => b[1] - a[1])[0]?.[0];
    if (!target) return;
    let top = -1;
    this.cells.forEach((c, i) => { if (c.room === target && (top < 0 || this.p[i] > this.p[top])) top = i; });
    const near = (c: Cell) => c.room === target && Math.hypot(c.x - this.cells[top].x, c.y - this.cells[top].y) <= this.o.modeIn;
    this.cells.forEach((c, i) => {
      if (!near(c)) return;
      w += this.p[i];
      sx += this.p[i] * c.x;
      sy += this.p[i] * c.y;
    });
    if (!w) return;
    const mx = sx / w, my = sy / w;
    // Spread over every cell, not just this room's: belief split between two rooms is a wide halo, honestly
    let v = 0;
    this.cells.forEach((c, i) => (v += this.p[i] * ((c.x - mx) ** 2 + (c.y - my) ** 2)));
    return { x: mx, y: my, spreadIn: Math.sqrt(v / (total || 1)), room: target, share: total ? byRoom[target] / total : 0 };
  }

  // Each room's share of the belief: a room classifier of its own, for homes without a trained model.
  rooms(): Record<string, number> {
    const out: Record<string, number> = {};
    this.cells.forEach((c, i) => (out[c.room] = (out[c.room] ?? 0) + this.p[i]));
    return out;
  }

  // The likely cells, for drawing a cloud on the plan: each cell's share of the most likely one, above `min`.
  cloud(min = 0.04): { x: number; y: number; p: number }[] {
    const top = this.p.reduce((m, v) => Math.max(m, v), 0) || 1;
    const out: { x: number; y: number; p: number }[] = [];
    this.cells.forEach((c, i) => {
      const p = this.p[i] / top;
      if (p >= min) out.push({ x: c.x, y: c.y, p: Math.round(p * 100) / 100 });
    });
    return out;
  }

  get cellIn() { return this.o.cellIn; }
  get wallDb() { return this.o.wallDb; }

  setWallDb(db: number) {
    this.o.wallDb = db;
    for (const [id, open] of this.open) {
      const count = this.wallCount.get(id)!, e = new Float64Array(open.length);
      for (let i = 0; i < open.length; i++) e[i] = open[i] - db * count[i];
      this.expected.set(id, e);
    }
  }

  // How well each candidate loss per wall explains one set of readings: the cost at the cell that fits it best.
  // Summed over minutes, the lowest is this home's walls (thin partitions, plaster, brick).
  wallCosts(order: string[], rssi: number[], online: Record<string, boolean>, candidates: number[]): number[] | undefined {
    const heard: { open: Float64Array; count: Uint8Array; v: number }[] = [];
    order.forEach((id, k) => {
      const open = this.open.get(id);
      if (open && online[id] !== false && rssi[k] > this.o.floorDb) heard.push({ open, count: this.wallCount.get(id)!, v: rssi[k] });
    });
    if (heard.length < 3) return; // two listeners can always be matched by some spot; it takes three to judge
    return candidates.map((db) => {
      let best = Infinity;
      for (let j = 0; j < this.cells.length; j++) {
        let mean = 0;
        for (const h of heard) mean += h.v - (h.open[j] - db * h.count[j]);
        mean /= heard.length;
        let s = 0;
        for (const h of heard) s += huber((h.v - (h.open[j] - db * h.count[j]) - mean) / this.o.sigmaDb);
        if (s < best) best = s;
      }
      return best;
    });
  }

  // A walkable way from a to b along the grid, never through a wall: cell centres from a's cell to b's.
  // Undefined when the scan has no way through (a missed door).
  route(a: Vec2, b: Vec2): Vec2[] | undefined {
    const from = this.nearest(a), to = this.nearest(b);
    if (from < 0 || to < 0) return;
    const prev = new Int32Array(this.cells.length).fill(-1);
    prev[from] = from;
    const queue = [from];
    for (let q = 0; q < queue.length && prev[to] < 0; q++)
      for (const n of this.near[queue[q]]) if (prev[n] < 0) { prev[n] = queue[q]; queue.push(n); }
    if (prev[to] < 0) return;
    const path: Vec2[] = [];
    for (let i = to; i !== from; i = prev[i]) path.push(this.cells[i]);
    return path.reverse();
  }

  private nearest(p: Vec2): number {
    let best = -1, d = Infinity;
    this.cells.forEach((c, i) => {
      const e = (c.x - p.x) ** 2 + (c.y - p.y) ** 2;
      if (e < d) { d = e; best = i; }
    });
    return best;
  }

  // Can a person get from a to b in a straight line without walking through a wall?
  clear(a: Vec2, b: Vec2) { return !blocked(a, b, this.walls); }
}

const huber = (z: number) => (Math.abs(z) <= HUBER ? z * z : 2 * HUBER * Math.abs(z) - HUBER * HUBER);

// Do segments pq and ab cross? Touching at an end does not count.
function cross(p: Vec2, q: Vec2, a: Vec2, b: Vec2): boolean {
  const d = (q.x - p.x) * (b.y - a.y) - (q.y - p.y) * (b.x - a.x);
  if (Math.abs(d) < 1e-9) return false;
  const t = ((a.x - p.x) * (b.y - a.y) - (a.y - p.y) * (b.x - a.x)) / d;
  const u = ((a.x - p.x) * (q.y - p.y) - (a.y - p.y) * (q.x - p.x)) / d;
  return t > 1e-6 && t < 1 - 1e-6 && u >= 0 && u <= 1;
}

// Walls between two points. Hits within a few inches of each other are one wall (a corner, or two rooms' edges).
export function crossings(p: Vec2, q: Vec2, walls: Seg[]): number {
  const hits: number[] = [];
  const len = Math.hypot(q.x - p.x, q.y - p.y) || 1;
  for (const [a, b] of walls) {
    if (!cross(p, q, a, b)) continue;
    const d = (q.x - p.x) * (b.y - a.y) - (q.y - p.y) * (b.x - a.x);
    const t = ((a.x - p.x) * (b.y - a.y) - (a.y - p.y) * (b.x - a.x)) / d;
    hits.push(t * len);
  }
  hits.sort((a, b) => a - b);
  return hits.filter((h, i) => i === 0 || h - hits[i - 1] > 6).length;
}

const blocked = (a: Vec2, b: Vec2, walls: Seg[]) => walls.some(([p, q]) => cross(a, b, p, q));
