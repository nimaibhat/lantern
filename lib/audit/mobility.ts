// Mobility planner: can a walker or wheelchair get from room to room?
// The plan is rasterized into 2 in cells. A cell is free when it is inside a room and at least the device's
// half-width away from every wall piece and piece of furniture (door gaps are open). A* then searches
// between room centroids through the doors and reports the first door or spot that blocks the way.

import type { HomeModel, Vec2 } from "@/lib/types";
import { bounds, distance, distanceToSegment, doorBetween, pointInPolygon } from "@/lib/world/geometry";
import { blocksFloor, distanceToBox, doorAxis, objectBox, wallPieces } from "@/lib/world/walls";
import type { AuditDraft } from "./ada";

export const CELL_IN = 2;

// Half-widths: a standard walker is about 24 in wide; a wheelchair needs the 32 in ADA clear width.
export const PROFILES = {
  walker: { label: "walker", radiusIn: 12 },
  wheelchair: { label: "wheelchair", radiusIn: 16 },
} as const;
export type Profile = keyof typeof PROFILES;

export interface Grid {
  x0: number;
  y0: number;
  cols: number;
  rows: number;
  free: Uint8Array; // 1 = passable
}

export function rasterize(home: HomeModel, radiusIn: number): Grid {
  const b = bounds(home.rooms.flatMap((r) => r.polygon));
  const x0 = b.minX, y0 = b.minY;
  const cols = Math.ceil(b.width / CELL_IN), rows = Math.ceil(b.height / CELL_IN);
  const walls = wallPieces(home);
  const boxes = home.rooms.flatMap((r) => (r.objects ?? []).filter(blocksFloor).map(objectBox));
  const free = new Uint8Array(cols * rows);

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const p = { x: x0 + (col + 0.5) * CELL_IN, y: y0 + (row + 0.5) * CELL_IN };
      if (!home.rooms.some((r) => pointInPolygon(p, r.polygon))) continue;
      if (walls.some(([a, c]) => distanceToSegment(p, a, c) < radiusIn)) continue;
      if (boxes.some((bx) => distanceToBox(p, bx) < radiusIn)) continue;
      free[row * cols + col] = 1;
    }
  }

  // Cell centers rarely sit on a door's center line, so a door exactly as wide as the device would pass or
  // fail depending on where it falls on the grid. Test the true center line through each door instead and open
  // the cells it crosses wherever that line itself is clear.
  const clear = (p: Vec2) => walls.every(([a, c]) => distanceToSegment(p, a, c) >= radiusIn) && boxes.every((bx) => distanceToBox(p, bx) >= radiusIn);
  for (const d of home.doors) {
    if (d.widthIn < radiusIn * 2) continue;
    const ax = doorAxis(home, d);
    for (let t = -(radiusIn + 2 * CELL_IN); t <= radiusIn + 2 * CELL_IN; t += CELL_IN / 4) {
      const p = { x: d.center.x - ax.y * t, y: d.center.y + ax.x * t }; // along the door's normal
      const col = Math.floor((p.x - x0) / CELL_IN), row = Math.floor((p.y - y0) / CELL_IN);
      if (col < 0 || row < 0 || col >= cols || row >= rows || !clear(p)) continue;
      free[row * cols + col] = 1;
    }
  }
  return { x0, y0, cols, rows, free };
}

const cellOf = (g: Grid, p: Vec2) => ({
  col: Math.min(g.cols - 1, Math.max(0, Math.floor((p.x - g.x0) / CELL_IN))),
  row: Math.min(g.rows - 1, Math.max(0, Math.floor((p.y - g.y0) / CELL_IN))),
});
const centerOf = (g: Grid, i: number): Vec2 => ({ x: g.x0 + ((i % g.cols) + 0.5) * CELL_IN, y: g.y0 + (Math.floor(i / g.cols) + 0.5) * CELL_IN });

// Nearest free cell to p within a few feet (a centroid can sit inside furniture).
function nearestFree(g: Grid, p: Vec2, maxIn = 48): number | undefined {
  const { col, row } = cellOf(g, p);
  const reach = Math.ceil(maxIn / CELL_IN);
  let best: number | undefined, bestD = Infinity;
  for (let dr = -reach; dr <= reach; dr++) {
    for (let dc = -reach; dc <= reach; dc++) {
      const c = col + dc, r = row + dr;
      if (c < 0 || r < 0 || c >= g.cols || r >= g.rows || !g.free[r * g.cols + c]) continue;
      const d = dc * dc + dr * dr;
      if (d < bestD) [best, bestD] = [r * g.cols + c, d];
    }
  }
  return best;
}

export interface PlanResult {
  ok: boolean;
  path: Vec2[]; // the route when ok, otherwise the route to the closest point reached
  blockedAt?: Vec2;
}

// 8-connected A* on the grid.
export function planRoute(g: Grid, from: Vec2, to: Vec2): PlanResult {
  const start = nearestFree(g, from), goal = nearestFree(g, to);
  if (start === undefined) return { ok: false, path: [], blockedAt: from };
  if (goal === undefined) return { ok: false, path: [], blockedAt: to };

  const n = g.cols * g.rows;
  const cost = new Float64Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const goalP = centerOf(g, goal);
  const h = (i: number) => distance(centerOf(g, i), goalP);
  const open: [number, number][] = [[h(start), start]]; // [estimate, cell]; small grids, so a sorted array is enough
  cost[start] = 0;
  let closest = start;

  while (open.length) {
    open.sort((a, b) => a[0] - b[0]);
    const [, cur] = open.shift()!;
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (h(cur) < h(closest)) closest = cur;
    if (cur === goal) break;
    const c = cur % g.cols, r = Math.floor(cur / g.cols);
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const nc = c + dc, nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= g.cols || nr >= g.rows) continue;
        const ni = nr * g.cols + nc;
        if (!g.free[ni] || closed[ni]) continue;
        if (dr && dc && (!g.free[r * g.cols + nc] || !g.free[nr * g.cols + c])) continue; // no corner cutting
        const step = dr && dc ? Math.SQRT2 : 1;
        if (cost[cur] + step < cost[ni]) {
          cost[ni] = cost[cur] + step;
          came[ni] = cur;
          open.push([cost[ni] + h(ni) / CELL_IN, ni]);
        }
      }
    }
  }

  const end = closed[goal] ? goal : closest;
  const path: Vec2[] = [];
  for (let at = end; at !== -1; at = came[at]) path.unshift(centerOf(g, at));
  return closed[goal] ? { ok: true, path } : { ok: false, path, blockedAt: centerOf(g, closest) };
}

export interface MobilityLeg {
  from: string;
  to: string;
  ok: boolean;
  path: Vec2[];
  blockedAt?: Vec2;
  reason?: string;
}

// Every door-connected pair of rooms, for one mobility device.
export function planMobility(home: HomeModel, profile: Profile): MobilityLeg[] {
  const { radiusIn, label } = PROFILES[profile];
  const grid = rasterize(home, radiusIn);
  const byId = new Map(home.rooms.map((r) => [r.id, r]));
  const legs: MobilityLeg[] = [];

  for (const door of home.doors) {
    const a = byId.get(door.roomA), b = byId.get(door.roomB);
    if (!a || !b) continue;
    const result = planRoute(grid, a.centroid, b.centroid);
    let reason: string | undefined;
    if (!result.ok) {
      const d = doorBetween(home, a.id, b.id)!;
      reason = d.widthIn < radiusIn * 2
        ? `the ${d.widthIn} in door is too narrow for a ${label} (needs about ${radiusIn * 2} in)`
        : `furniture or a tight turn blocks a ${label}`;
      if (d.widthIn < radiusIn * 2) result.blockedAt = d.center;
    }
    legs.push({ from: a.id, to: b.id, ...result, reason });
  }
  return legs;
}

export function mobilityItems(home: HomeModel, profile: Profile): AuditDraft[] {
  const names = new Map(home.rooms.map((r) => [r.id, r.name]));
  return planMobility(home, profile)
    .filter((leg) => !leg.ok)
    .map((leg) => ({
      roomId: leg.from,
      source: "ada-rule" as const,
      code: "ADA 402",
      severity: profile === "walker" ? ("high" as const) : ("medium" as const),
      title: `A ${PROFILES[profile].label} cannot get from ${names.get(leg.from)} to ${names.get(leg.to)}`,
      detail: `The route is blocked: ${leg.reason}.`,
      fix: "Widen the opening or clear the path; the red line in the 3D view shows where it stops.",
      location: leg.blockedAt,
    }));
}
