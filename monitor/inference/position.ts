// Coarse in-room position for the 3D avatar. The room is reliable; the exact spot is an estimate (about 2 to 3 m).

import type { Vec2 } from "@/lib/types";

export interface PathLoss { txPower: number; n: number; floor: number }
export const DEFAULT_PATH_LOSS: PathLoss = { txPower: -59, n: 2.5, floor: -95 };

// Weighted centroid of the listener anchors, weights from a path-loss distance estimate
export function estimatePosition(vec: number[], order: string[], anchors: Record<string, Vec2>, p = DEFAULT_PATH_LOSS): Vec2 | undefined {
  let sx = 0, sy = 0, sw = 0;
  order.forEach((id, i) => {
    const rssi = vec[i];
    if (rssi <= p.floor || !anchors[id]) return; // ignore missing readings
    const dIn = Math.pow(10, (p.txPower - rssi) / (10 * p.n)) * 39.37; // metres -> inches
    const w = 1 / Math.max(dIn * dIn, 1);
    sx += w * anchors[id].x;
    sy += w * anchors[id].y;
    sw += w;
  });
  return sw ? { x: sx / sw, y: sy / sw } : undefined;
}

export class PositionFilter {
  cur?: Vec2;
  private last = 0;

  constructor(private alpha = 0.35, private maxSpeed = 100 /* in/s */) {}

  step(raw: Vec2, ts: number, clamp: (p: Vec2) => Vec2): Vec2 {
    if (!this.cur) {
      this.cur = clamp(raw);
      this.last = ts;
      return this.cur;
    }
    const dt = Math.max((ts - this.last) / 1000, 0.05);
    this.last = ts;
    let nx = this.cur.x + this.alpha * (raw.x - this.cur.x);
    let ny = this.cur.y + this.alpha * (raw.y - this.cur.y);
    const dx = nx - this.cur.x, dy = ny - this.cur.y, d = Math.hypot(dx, dy), max = this.maxSpeed * dt;
    if (d > max) { nx = this.cur.x + (dx / d) * max; ny = this.cur.y + (dy / d) * max; }
    this.cur = clamp({ x: nx, y: ny }); // never leave the believed room
    return this.cur;
  }
}

// Runs the filter at about 5 Hz on the latest 1 Hz estimate. After a room change it walks the avatar
// through the shared door(s) first, so it never cuts through a wall.
export class PositionTracker {
  velocity?: Vec2;
  private filter: PositionFilter;
  private target?: Vec2;
  private route: Vec2[] = [];
  private prev?: { p: Vec2; ts: number };

  constructor(alpha = 0.35, maxSpeed = 100) {
    this.filter = new PositionFilter(alpha, maxSpeed);
  }

  get current() { return this.filter.cur; }
  get inTransit() { return this.route.length > 0; }

  setTarget(raw: Vec2) {
    this.target = raw;
  }

  enterRoom(doorCenters: Vec2[]) {
    this.route = this.filter.cur ? doorCenters.slice() : [];
  }

  step(ts: number, clamp: (p: Vec2) => Vec2): Vec2 | undefined {
    const cur = this.filter.cur;
    while (cur && this.route.length && Math.hypot(cur.x - this.route[0].x, cur.y - this.route[0].y) < 8) this.route.shift();
    const goal = this.route[0] ?? this.target;
    if (!goal) return cur;
    const p = this.filter.step(goal, ts, this.route.length ? (q) => q : clamp);

    if (this.prev && ts > this.prev.ts) {
      const dt = (ts - this.prev.ts) / 1000, vx = (p.x - this.prev.p.x) / dt, vy = (p.y - this.prev.p.y) / dt;
      this.velocity = this.velocity ? { x: 0.5 * this.velocity.x + 0.5 * vx, y: 0.5 * this.velocity.y + 0.5 * vy } : { x: vx, y: vy };
    }
    this.prev = { p: { ...p }, ts };
    return p;
  }
}
