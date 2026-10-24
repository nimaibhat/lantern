// Accessibility checks on the home model, in inches. One pure function per rule: (room, home) => drafts.
// The 2010 ADA Standards are the benchmark. Private homes do not have to comply, so this is a draft for an
// occupational therapist, and results near a limit say to verify with a tape measure.

import type { AuditItem, HomeModel, HomeRoom, RoomObject, Vec2 } from "@/lib/types";
import { bounds, distanceToSegment, edges, pointInPolygon } from "@/lib/world/geometry";
import { blocksFloor, boxEdges, distanceToBox, objectBox, rayDistance, type Seg } from "@/lib/world/walls";

export type AuditDraft = Omit<AuditItem, "id" | "status">;

export const DOOR_MIN = 32; // ADA 404.2.3 clear width
export const DOOR_FRAME_ALLOWANCE = 2; // the scan measures the opening; the door leaf and stops take about 2 in
export const ROUTE_MIN = 36; // ADA 403.5.1
export const TURN_DIAMETER = 60; // ADA 304.3
export const TOILET_WIDTH_MIN = 60; // ADA 604.3.1, clearance measured from the side wall
export const TOILET_DEPTH_MIN = 56; // ADA 604.3.1, clearance measured from the rear wall
export const BED_SIDE_MIN = 36; // OT guideline for a transfer side
const NEAR_LIMIT_IN = 2;

const r = (n: number) => Math.round(n);
const verify = (measured: number, required: number) =>
  Math.abs(measured - required) <= NEAR_LIMIT_IN ? " Close to the limit; verify with a tape measure." : "";

// Walls of this room plus the furniture in it, as segments for ray casting.
function obstacles(room: HomeRoom, except?: RoomObject): Seg[] {
  const furniture = (room.objects ?? []).filter((o) => o !== except && blocksFloor(o)).flatMap((o) => boxEdges(objectBox(o)));
  return [...edges(room.polygon), ...furniture];
}

function clearanceAt(room: HomeRoom, p: Vec2): number {
  const toWalls = Math.min(...edges(room.polygon).map(([a, b]) => distanceToSegment(p, a, b)));
  const toObjects = Math.min(Infinity, ...(room.objects ?? []).filter(blocksFloor).map((o) => distanceToBox(p, objectBox(o))));
  return Math.min(toWalls, toObjects);
}

export function doorWidths(room: HomeRoom, home: HomeModel): AuditDraft[] {
  return home.doors
    .flatMap((d): AuditDraft[] => {
      if (clear >= DOOR_MIN + NEAR_LIMIT_IN) return [];
      const other = home.rooms.find((x) => x.id === d.roomB)?.name ?? "outside";
        return [{
          roomId: room.id, source: "ada-rule", code: "ADA 404.2.3", severity: clear <= DOOR_MIN - 4 ? "high" : "medium", location: d.center,
          measuredIn: r(clear), requiredIn: DOOR_MIN,
        }];
      }
      if (clear >= DOOR_MIN) {
        return [{
          roomId: room.id, source: "ada-rule", code: "ADA 404.2.3", severity: "low", location: d.center,
          measuredIn: r(clear), requiredIn: DOOR_MIN,
        }];
      }
      return [{
        roomId: room.id, source: "ada-rule", code: "ADA 404.2.3", severity: clear <= DOOR_MIN - 4 ? "high" : "medium", location: d.center,
        title: `Door between ${room.name} and ${other} is narrow`,
        detail: `Estimated clear width is ${r(clear)} in, below the ${DOOR_MIN} in a walker or wheelchair needs.${verify(clear, DOOR_MIN)}`,
        fix: "Install offset (swing-clear) hinges, remove the door stop trim, or widen the opening.",
        measuredIn: r(clear), requiredIn: DOOR_MIN,
      }];
    });
}

// Clear width along the walking line between each pair of doors, measured across the line by ray casting.
export function routeWidth(room: HomeRoom, home: HomeModel): AuditDraft[] {
  const doors = home.doors.filter((d) => d.roomA === room.id || d.roomB === room.id);
  const segs = obstacles(room);
  const b = bounds(room.polygon);
  const passage = room.kind === "hallway" || room.kind === "front-door" || Math.max(b.width, b.height) > Math.min(b.width, b.height) * 2.5;

  // Walking lines: door to door; with fewer than two doors, the room's long axis.
  const lines: [Vec2, Vec2][] = [];
  for (let i = 0; i < doors.length; i++) for (let j = i + 1; j < doors.length; j++) lines.push([doors[i].center, doors[j].center]);
  if (lines.length === 0 && passage) {
    lines.push(b.width >= b.height
      ? [{ x: b.minX, y: b.center.y }, { x: b.maxX, y: b.center.y }]
      : [{ x: b.center.x, y: b.minY }, { x: b.center.x, y: b.maxY }]);
  }
  if (!passage && lines.length === 0) return [];

  let narrowest = Infinity, at: Vec2 | undefined;
  for (const [a, c] of lines) {
    const len = Math.hypot(c.x - a.x, c.y - a.y);
    if (len < 1) continue;
    const ux = (c.x - a.x) / len, uy = (c.y - a.y) / len;
    for (let t = 18; t <= len - 18; t += 4) {
      const p = { x: a.x + ux * t, y: a.y + uy * t };
      if (!pointInPolygon(p, room.polygon)) continue;
      const w = rayDistance(p, -uy, ux, segs) + rayDistance(p, uy, -ux, segs);
      if (w < narrowest) [narrowest, at] = [w, p];
    }
  }
  if (!at || !Number.isFinite(narrowest) || narrowest >= ROUTE_MIN) return [];
  return [{
    roomId: room.id, source: "ada-rule", code: "ADA 403.5.1", severity: narrowest < ROUTE_MIN - 6 ? "high" : "medium", location: at,
    title: `${room.name} walking path is narrow`,
    detail: `The path narrows to ${r(narrowest)} in. An accessible route is at least ${ROUTE_MIN} in.${verify(narrowest, ROUTE_MIN)}`,
    fix: "Move furniture off the path, or keep the walls clear and add a handrail on one side.",
    measuredIn: r(narrowest), requiredIn: ROUTE_MIN,
  }];
}

export function largestClearCircle(room: HomeRoom): { diameter: number; at: Vec2 } {
  const b = bounds(room.polygon);
  let best = { diameter: 0, at: b.center };
        const p = { x, y };
        if (!pointInPolygon(p, room.polygon)) continue;
        const d = clearanceAt(room, p) * 2;
        if (d > best.diameter) best = { diameter: d, at: p };
      }
    }
  return best;
}

export function turningSpace(room: HomeRoom): AuditDraft[] {
  if (room.kind !== "bathroom" && room.kind !== "bedroom") return [];
  const { diameter, at } = largestClearCircle(room);
  if (diameter >= TURN_DIAMETER) return [];
  return [{
    roomId: room.id, source: "ada-rule", code: "ADA 304.3", severity: "medium", location: at,
    title: `Not enough turning space in the ${room.name.toLowerCase()}`,
    detail: `The largest clear circle is about ${r(diameter)} in. A walker or wheelchair needs ${TURN_DIAMETER} in to turn.${verify(diameter, TURN_DIAMETER)}`,
    fix: "Move or remove a piece of furniture to open up floor space.",
    measuredIn: r(diameter), requiredIn: TURN_DIAMETER,
  }];
}

// Clear floor around a toilet. The open side with the most room is taken as its front.
export function toiletClearance(room: HomeRoom): AuditDraft[] {
  return (room.objects ?? []).filter((o) => o.category === "toilet").flatMap((toilet): AuditDraft[] => {
    const segs = obstacles(room, toilet);
    const c = toilet.center;
    const reach = { left: rayDistance(c, -1, 0, segs), right: rayDistance(c, 1, 0, segs), up: rayDistance(c, 0, -1, segs), down: rayDistance(c, 0, 1, segs) };
    const front = (Object.keys(reach) as (keyof typeof reach)[]).sort((a, b) => reach[b] - reach[a])[0];
    const alongX = front === "left" || front === "right";
    const depth = alongX ? reach.left + reach.right : reach.up + reach.down; // rear wall to the far side
    const width = alongX ? reach.up + reach.down : reach.left + reach.right;
    const tooShallow = depth < TOILET_DEPTH_MIN, tooNarrow = width < TOILET_WIDTH_MIN;
    if (!tooShallow && !tooNarrow) return [];
    return [{
      roomId: room.id, source: "ada-rule", code: "ADA 604.3", severity: "medium", location: c,
      title: "Tight clear space around the toilet",
      detail: `About ${r(width)} in wide and ${r(depth)} in deep; the benchmark is ${TOILET_WIDTH_MIN} by ${TOILET_DEPTH_MIN} in. A caregiver may not have room to help with transfers.`,
      fix: "Clear the floor beside the toilet and add a toilet safety frame or grab bar.",
      measuredIn: r(Math.min(width, depth)), requiredIn: tooNarrow ? TOILET_WIDTH_MIN : TOILET_DEPTH_MIN,
    }];
  });
}

// The patient needs one clear side of the bed to get in and out.
export function bedClearance(room: HomeRoom): AuditDraft[] {
  return (room.objects ?? []).filter((o) => o.category === "bed").flatMap((bed): AuditDraft[] => {
    const segs = obstacles(room, bed);
    const b = objectBox(bed);
    const sidesAlongX = b.x1 - b.x0 < b.y1 - b.y0; // long sides run along y, so the free sides are left and right
    const sides = sidesAlongX
      ? [rayDistance({ x: b.x0, y: bed.center.y }, -1, 0, segs), rayDistance({ x: b.x1, y: bed.center.y }, 1, 0, segs)]
      : [rayDistance({ x: bed.center.x, y: b.y0 }, 0, -1, segs), rayDistance({ x: bed.center.x, y: b.y1 }, 0, 1, segs)];
    const best = Math.max(...sides.map((s) => (Number.isFinite(s) ? s : 0)));
    if (best >= BED_SIDE_MIN) return [];
    return [{
      roomId: room.id, source: "ada-rule", severity: "medium", location: bed.center,
      title: "Tight space beside the bed",
      detail: `The widest side of the bed has about ${r(best)} in of floor, less than ${BED_SIDE_MIN} in for a safe transfer.${verify(best, BED_SIDE_MIN)}`,
      fix: "Move the bed away from the wall on the side the patient gets out.",
      measuredIn: r(best), requiredIn: BED_SIDE_MIN,
    }];
  });
}

// Things RoomPlan recognizes that always deserve a closer look.
export function fixturesToCheck(room: HomeRoom): AuditDraft[] {
  return (room.objects ?? []).flatMap((o): AuditDraft[] => {
    if (o.category === "stairs") {
      return [{
        roomId: room.id, source: "ada-rule", code: "ADA 505", severity: "high", location: o.center,
        title: "Stairs: check handrails and lighting",
        detail: "Stairs are the most common place for serious falls at home. Handrails belong on both sides at 34 to 38 in.",
        fix: "Add handrails on both sides, light switches at the top and bottom, and contrasting tape on step edges.",
      }];
    }
    if (o.category === "bathtub") {
      return [{
        roomId: room.id, source: "ada-rule", code: "ADA 607, 609", severity: "medium", location: o.center,
        title: "Bathtub: check grab bars and the floor",
        detail: "Stepping over a tub wall is a frequent fall point. Grab bars belong at 33 to 36 in above the floor.",
        fix: "Add grab bars, a non-slip mat, and consider a tub transfer bench.",
      }];
    }
    return [];
  });
}

export function auditRoom(room: HomeRoom, home: HomeModel): AuditDraft[] {
  return [
    ...doorWidths(room, home),
    ...routeWidth(room, home),
    ...turningSpace(room),
    ...toiletClearance(room),
    ...bedClearance(room),
    ...fixturesToCheck(room),
  ];
}

export const auditHome = (home: HomeModel): AuditDraft[] => home.rooms.flatMap((room) => auditRoom(room, home));
