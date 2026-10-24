// Pure floor-plan geometry shared by the web app and the monitor. Inches, shared floor frame.

import type { HomeModel, HomeRoom, Vec2 } from "@/lib/types";

export const IN_TO_M = 0.0254;
export const inToM = (v: number) => v * IN_TO_M;

// Ray casting: count how many polygon edges a ray to the right of p crosses.
export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function roomAt(home: HomeModel, p: Vec2): HomeRoom | undefined {
  return home.rooms.find((r) => pointInPolygon(p, r.polygon));
}

// Closest point to p on the segment a-b.
export function closestOnSegment(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return { x: a.x + t * dx, y: a.y + t * dy };
}

export const distance = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
export const distanceToSegment = (p: Vec2, a: Vec2, b: Vec2) => distance(p, closestOnSegment(p, a, b));

// Every edge of a polygon as [start, end], closing the loop.
export const edges = (poly: Vec2[]): [Vec2, Vec2][] => poly.map((a, i) => [a, poly[(i + 1) % poly.length]]);

export function nearestPointInPolygon(p: Vec2, poly: Vec2[]): Vec2 {
  let best = poly[0], bestD = Infinity;
  for (const [a, b] of edges(poly)) {
    const q = closestOnSegment(p, a, b);
    const d = distance(p, q);
    if (d < bestD) [best, bestD] = [q, d];
  }
  return best;
}

export function clampToRoom(home: HomeModel, roomId: string, p: Vec2): Vec2 {
  const r = home.rooms.find((x) => x.id === roomId);
  if (!r) return p;
  return pointInPolygon(p, r.polygon) ? p : nearestPointInPolygon(p, r.polygon);
}

// Shoelace area (positive for either winding) and area-weighted centroid.
export function polygonArea(poly: Vec2[]): number {
  return Math.abs(edges(poly).reduce((s, [a, b]) => s + a.x * b.y - b.x * a.y, 0)) / 2;
}

export function polygonCentroid(poly: Vec2[]): Vec2 {
  let cx = 0, cy = 0, a2 = 0;
  for (const [a, b] of edges(poly)) {
    const cross = a.x * b.y - b.x * a.y;
    a2 += cross;
    cx += (a.x + b.x) * cross;
    cy += (a.y + b.y) * cross;
  }
  if (Math.abs(a2) < 1e-9) {
    const n = poly.length || 1;
    return { x: poly.reduce((s, p) => s + p.x, 0) / n, y: poly.reduce((s, p) => s + p.y, 0) / n };
  }
  return { x: cx / (3 * a2), y: cy / (3 * a2) };
}

// The point inside the polygon farthest from its edges, on a grid of about 40 steps a side. For an L or T shaped
// room the centroid can fall outside it (a T hallway's centroid can land in the room beside it), so labels and
// the room's centre point use this instead.
export function innerPoint(poly: Vec2[]): Vec2 {
  if (poly.length < 3) return polygonCentroid(poly);
  const b = bounds(poly);
  const step = Math.max(b.width, b.height) / 40 || 1;
  let best = polygonCentroid(poly), bestD = pointInPolygon(best, poly) ? edgeDistance(best, poly) : -1;
  for (let x = b.center.x - b.width / 2 + step / 2; x < b.center.x + b.width / 2; x += step)
    for (let y = b.center.y - b.height / 2 + step / 2; y < b.center.y + b.height / 2; y += step) {
      const p = { x, y };
      if (!pointInPolygon(p, poly)) continue;
      const d = edgeDistance(p, poly);
      if (d > bestD + 0.5) [best, bestD] = [p, d];
    }
  return best;
}

export const edgeDistance = (p: Vec2, poly: Vec2[]) => Math.min(...edges(poly).map(([a, b]) => distanceToSegment(p, a, b)));

// Where two rooms meet along a straight, axis-aligned edge (within tol inches): the longest overlap of facing
// edges, on the line halfway between them. Used for rooms that are open to each other with no wall between.
export function sharedEdge(a: Vec2[], b: Vec2[], tol = 3): [Vec2, Vec2] | undefined {
  let best: [Vec2, Vec2] | undefined, bestLen = 6; // shorter than 6 in is a corner touch, not a shared edge
  for (const [p, q] of edges(a))
    for (const [r, t] of edges(b)) {
      for (const horizontal of [true, false]) {
        const [u, v] = horizontal ? ["y", "x"] as const : ["x", "y"] as const;
        if (Math.abs(p[u] - q[u]) > tol || Math.abs(r[u] - t[u]) > tol || Math.abs(p[u] - r[u]) > tol) continue;
        const lo = Math.max(Math.min(p[v], q[v]), Math.min(r[v], t[v])), hi = Math.min(Math.max(p[v], q[v]), Math.max(r[v], t[v]));
        if (hi - lo <= bestLen) continue;
        const line = (p[u] + q[u] + r[u] + t[u]) / 4;
        best = horizontal ? [{ x: lo, y: line }, { x: hi, y: line }] : [{ x: line, y: lo }, { x: line, y: hi }];
        bestLen = hi - lo;
      }
    }
  return best;
}

export function bounds(points: Vec2[]) {
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  const minX = Math.min(...xs), minY = Math.min(...ys), maxX = Math.max(...xs), maxY = Math.max(...ys);
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY, center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 } };
}

// Room graph from the doors. Doors to unknown rooms (for example "outside") are ignored.
export function adjacency(home: HomeModel): Record<string, string[]> {
  const graph: Record<string, string[]> = Object.fromEntries(home.rooms.map((r) => [r.id, []]));
  for (const d of home.doors) {
    if (!(d.roomA in graph) || !(d.roomB in graph) || d.roomA === d.roomB) continue;
    if (!graph[d.roomA].includes(d.roomB)) graph[d.roomA].push(d.roomB);
    if (!graph[d.roomB].includes(d.roomA)) graph[d.roomB].push(d.roomA);
  }
  return graph;
}

// Shortest room sequence by breadth-first search, or [] if unreachable.
export function roomPath(home: HomeModel, fromRoomId: string, toRoomId: string): string[] {
  const graph = adjacency(home);
  if (!(fromRoomId in graph) || !(toRoomId in graph)) return [];
  const prev = new Map<string, string | null>([[fromRoomId, null]]);
  const queue = [fromRoomId];
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur === toRoomId) break;
    for (const next of graph[cur]) if (!prev.has(next)) (prev.set(next, cur), queue.push(next));
  }
  if (!prev.has(toRoomId)) return [];
  const path: string[] = [];
  for (let at: string | null = toRoomId; at !== null; at = prev.get(at) ?? null) path.unshift(at);
  return path;
}

export const doorBetween = (home: HomeModel, a: string, b: string) =>
  home.doors.find((d) => (d.roomA === a && d.roomB === b) || (d.roomA === b && d.roomB === a));

// Walking route: centroid(from) > door > ... > centroid(to). [] if there is no way through.
export function routeBetween(home: HomeModel, fromRoomId: string, toRoomId: string): Vec2[] {
  const rooms = roomPath(home, fromRoomId, toRoomId);
  if (rooms.length === 0) return [];
  const centroid = (id: string) => home.rooms.find((r) => r.id === id)!.centroid;
  const points: Vec2[] = [centroid(rooms[0])];
  for (let i = 1; i < rooms.length; i++) points.push(doorBetween(home, rooms[i - 1], rooms[i])!.center);
  if (rooms.length > 1) points.push(centroid(rooms[rooms.length - 1]));
  return points;
}

export const pathLength = (points: Vec2[]) => points.slice(1).reduce((s, p, i) => s + distance(points[i], p), 0);

// Point at a given distance along a polyline (clamped to its ends).
export function pointAlong(points: Vec2[], d: number): Vec2 {
  if (points.length === 0) return { x: 0, y: 0 };
  let left = Math.max(0, d);
  for (let i = 1; i < points.length; i++) {
    const seg = distance(points[i - 1], points[i]);
    if (left <= seg && seg > 0) {
      const t = left / seg;
      return { x: points[i - 1].x + t * (points[i].x - points[i - 1].x), y: points[i - 1].y + t * (points[i].y - points[i - 1].y) };
    }
    left -= seg;
  }
  return points[points.length - 1];
}
