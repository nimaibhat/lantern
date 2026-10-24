// Walls and obstacles derived from the home model, shared by the 3D view, the audit and the mobility planner.

import type { HomeDoor, HomeModel, RoomObject, Vec2 } from "@/lib/types";
import { distance, distanceToSegment, edges } from "./geometry";

const ON_EDGE_IN = 4; // a door sits on an edge if its center is this close to it

export type Seg = [Vec2, Vec2];
export type Box = { x0: number; y0: number; x1: number; y1: number };

// Cut door gaps out of one edge. Returns the solid pieces that remain.
export function subtractDoors(a: Vec2, b: Vec2, doors: HomeDoor[]): Seg[] {
  const len = distance(a, b);
  if (len === 0) return [];
  const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
  const gaps = doors
    .filter((d) => distanceToSegment(d.center, a, b) < ON_EDGE_IN)
    .map((d) => {
      const t = (d.center.x - a.x) * ux + (d.center.y - a.y) * uy;
      return [Math.max(0, t - d.widthIn / 2), Math.min(len, t + d.widthIn / 2)] as const;
    })
    .filter(([s, e]) => e > s)
    .sort((p, q) => p[0] - q[0]);

  const pieces: Seg[] = [];
  let at = 0;
  for (const [s, e] of gaps) {
    if (s > at) pieces.push([point(a, ux, uy, at), point(a, ux, uy, s)]);
    at = Math.max(at, e);
  }
  if (at < len) pieces.push([point(a, ux, uy, at), b]);
  return pieces;
}

const point = (a: Vec2, ux: number, uy: number, t: number): Vec2 => ({ x: a.x + ux * t, y: a.y + uy * t });

const key = ([a, b]: Seg) => {
  const r = (p: Vec2) => `${Math.round(p.x)},${Math.round(p.y)}`;
  return [r(a), r(b)].sort().join("|");
};

// Every solid wall piece in the home, with shared walls between two rooms counted once.
export function wallPieces(home: HomeModel): Seg[] {
  const seen = new Set<string>();
  const out: Seg[] = [];
  for (const room of home.rooms) {
    for (const [a, b] of edges(room.polygon)) {
      if (seen.has(key([a, b]))) continue;
      seen.add(key([a, b]));
      out.push(...subtractDoors(a, b, home.doors));
    }
  }
  return out;
}

// Footprint of an object, widened to cover its rotation.
export function objectBox(o: RoomObject): Box {
  const a = (o.rotationDeg * Math.PI) / 180;
  const w = Math.abs(o.widthIn * Math.cos(a)) + Math.abs(o.depthIn * Math.sin(a));
  const d = Math.abs(o.widthIn * Math.sin(a)) + Math.abs(o.depthIn * Math.cos(a));
  return { x0: o.center.x - w / 2, y0: o.center.y - d / 2, x1: o.center.x + w / 2, y1: o.center.y + d / 2 };
}

export const boxEdges = (b: Box): Seg[] => {
  const p = [{ x: b.x0, y: b.y0 }, { x: b.x1, y: b.y0 }, { x: b.x1, y: b.y1 }, { x: b.x0, y: b.y1 }];
  return edges(p);
};

export function distanceToBox(p: Vec2, b: Box): number {
  const dx = Math.max(b.x0 - p.x, 0, p.x - b.x1);
  const dy = Math.max(b.y0 - p.y, 0, p.y - b.y1);
  return Math.hypot(dx, dy);
}

// Wall-mounted or flat things that do not block walking.
const NOT_OBSTACLES = new Set(["television", "fireplace", "unknown"]);
export const blocksFloor = (o: RoomObject) => !NOT_OBSTACLES.has(o.category);

// Distance from p along direction (dx, dy) to the first segment hit, or Infinity.
export function rayDistance(p: Vec2, dx: number, dy: number, segs: Seg[]): number {
  let best = Infinity;
  for (const [a, b] of segs) {
    const ex = b.x - a.x, ey = b.y - a.y;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((a.x - p.x) * ey - (a.y - p.y) * ex) / den; // along the ray
    const u = ((a.x - p.x) * dy - (a.y - p.y) * dx) / den; // along the segment
    if (t > 1e-6 && u >= 0 && u <= 1) best = Math.min(best, t);
  }
  return best;
}

// Unit direction of the wall a door sits in (for drawing the lintel and frame).
export function doorAxis(home: HomeModel, door: HomeDoor): Vec2 {
  let best: Seg | undefined, bestD = Infinity;
  for (const room of home.rooms) {
    for (const [a, b] of edges(room.polygon)) {
      const d = distanceToSegment(door.center, a, b);
      if (d < bestD) [best, bestD] = [[a, b], d];
    }
  }
  if (!best) return { x: 1, y: 0 };
  const len = distance(best[0], best[1]) || 1;
  return { x: (best[1].x - best[0].x) / len, y: (best[1].y - best[0].y) / len };
}
