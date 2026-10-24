// Parsed scan rooms to the shared HomeModel every part of the system codes against.
// Rooms get slug ids, doors are matched to the two rooms they connect, and listener anchors carry over
// from the previous model so a re-scan does not undo where the laptops were placed.

import type { Anchor, Hazard, HomeDoor, HomeModel, HomeRoom, RoomKind, Vec2 } from "@/lib/types";
import { distance, edgeDistance, innerPoint, sharedEdge, nearestPointInPolygon, pointInPolygon, polygonCentroid } from "./geometry";
import type { ParsedRoom } from "./parse";

const DOOR_MATCH_IN = 18; // a door belongs to a room if its center is this close to the room's outline
const DOOR_MERGE_IN = 18; // two rooms see the same door; merge detections this close together
const ANCHOR_HEIGHT_IN = 36;

export const slug = (name: string) =>
  name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "room";

export function kindFor(name: string): RoomKind {
  const n = name.toLowerCase();
  if (/closet|pantry|storage/.test(n)) return "other"; // before "hall": a hall closet is not a hallway
  if (/bed/.test(n)) return "bedroom";
  if (/bath|toilet|restroom|wc/.test(n)) return "bathroom";
  if (/hall|corridor/.test(n)) return "hallway";
  if (/kitchen/.test(n)) return "kitchen";
  if (/tv|den|family/.test(n)) return "tv-room";
  if (/door|entry|entrance|foyer|exit/.test(n)) return "front-door";
  if (/living|lounge/.test(n)) return "living";
  return "other";
}

// Clockwise on the plan (y down) means a positive shoelace sum.
function clockwise(poly: Vec2[]): Vec2[] {
  const signed = poly.reduce((s, a, i) => {
    const b = poly[(i + 1) % poly.length];
    return s + a.x * b.y - b.x * a.y;
  }, 0);
  return signed < 0 ? [...poly].reverse() : poly;
}

// RoomPlan's world axes follow the phone at the start of the scan, not the house, so a real scan is usually
// turned by some angle. The wall direction (length-weighted, modulo 90 degrees) tells us by how much.
// Radians in (-45, 45] degrees; 0 when there is nothing to measure.
export function wallAngle(rooms: ParsedRoom[]): number {
  let sx = 0, sy = 0;
  for (const r of rooms) {
    const segs: [Vec2, Vec2][] = r.walls.length
      ? r.walls.map((w) => [w.start, w.end])
      : r.polygon.map((p, i) => [p, r.polygon[(i + 1) % r.polygon.length]]);
    for (const [a, b] of segs) {
      const len = distance(a, b);
      if (len < 1) continue;
      const k = 4 * Math.atan2(b.y - a.y, b.x - a.x); // x4 folds the four wall directions onto one
      sx += len * Math.cos(k);
      sy += len * Math.sin(k);
    }
  }
  return Math.hypot(sx, sy) < 1e-6 ? 0 : Math.atan2(sy, sx) / 4;
}

// Turn every room by -angle about the origin. Rigid, so every length and width is unchanged.
export function rotateRooms(rooms: ParsedRoom[], angle: number): ParsedRoom[] {
  if (angle === 0) return rooms;
  const c = Math.cos(-angle), s = Math.sin(-angle), deg = (angle * 180) / Math.PI;
  const rt = (p: Vec2) => ({ x: p.x * c - p.y * s, y: p.x * s + p.y * c });
  const rtSeg = <T extends { start: Vec2; end: Vec2 }>(seg: T): T => ({ ...seg, start: rt(seg.start), end: rt(seg.end) });
  return rooms.map((r) => ({
    ...r,
    polygon: r.polygon.map(rt),
    walls: r.walls.map(rtSeg),
    openings: r.openings.map(rtSeg),
    windows: r.windows.map(rtSeg),
    objects: r.objects.map((o) => ({ ...o, center: rt(o.center), rotationDeg: o.rotationDeg - deg })),
  }));
}

// Rooms scanned in one session share a world origin. Square them to the plan axes (so clearances measured
// along x and y are true), then shift them together so the plan starts at (0, 0).
// turnDeg turns the squared plan clockwise in 90 degree steps, so it can match the home's paper floor plan.
export function normalize(parsed: ParsedRoom[], turnDeg = 0): ParsedRoom[] {
  const rooms = rotateRooms(parsed, wallAngle(parsed) - (turnDeg * Math.PI) / 180);
  const pts = rooms.flatMap((r) => [...r.polygon, ...r.walls.flatMap((w) => [w.start, w.end])]);
  if (pts.length === 0) return rooms;
  const dx = Math.min(...pts.map((p) => p.x)), dy = Math.min(...pts.map((p) => p.y));
  const mv = (p: Vec2) => ({ x: round(p.x - dx), y: round(p.y - dy) });
  const mvSeg = <T extends { start: Vec2; end: Vec2 }>(s: T): T => ({ ...s, start: mv(s.start), end: mv(s.end) });
  return rooms.map((r) => ({
    ...r,
    polygon: r.polygon.map(mv),
    walls: r.walls.map(mvSeg),
    openings: r.openings.map(mvSeg),
    windows: r.windows.map(mvSeg),
    objects: r.objects.map((o) => ({ ...o, center: mv(o.center) })),
  }));
}

const round = (n: number) => Math.round(n * 10) / 10;

function uniqueIds(names: string[], taken: Set<string> = new Set()): string[] {
  return names.map((name) => {
    let id = slug(name), n = 2;
    while (taken.has(id)) id = `${slug(name)}-${n++}`;
    taken.add(id);
    return id;
  });
}

// Doors seen from either side are merged, then matched to the nearest one or two rooms. Two detections of one
// door are two measurements of the same opening, so the width is their mean (the larger could hide a narrow door).
export function matchDoors(rooms: HomeRoom[], openings: { center: Vec2; widthIn: number; kind: "door" | "opening" }[]): HomeDoor[] {
  const merged: ((typeof openings)[number] & { n: number })[] = [];
  for (const o of openings) {
    const same = merged.find((m) => distance(m.center, o.center) < DOOR_MERGE_IN);
    if (!same) merged.push({ ...o, n: 1 });
    else {
      same.widthIn = (same.widthIn * same.n + o.widthIn) / (same.n + 1);
      same.n++;
      if (o.kind === "door") same.kind = "door"; // a leaf seen from either side means there is a door
    }
  }

  const doors: HomeDoor[] = [];
  for (const o of merged) {
    // A door in a shared wall is about 0 in from both rooms; break near-ties by scan order so roomA is stable
    const near = rooms
      .map((r, i) => ({ id: r.id, i, d: pointInPolygon(o.center, r.polygon) ? 0 : distance(o.center, nearestPointInPolygon(o.center, r.polygon)) }))
      .filter((x) => x.d < DOOR_MATCH_IN)
      .sort((a, b) => (Math.abs(a.d - b.d) < 0.5 ? a.i - b.i : a.d - b.d));
    if (near.length === 0) continue;
    const roomA = near[0].id, roomB = near[1]?.id ?? "outside";
    let id = `${roomA}|${roomB}`, n = 2;
    while (doors.some((d) => d.id === id)) id = `${roomA}|${roomB}-${n++}`;
    doors.push({ id, roomA, roomB, center: o.center, widthIn: Math.round(o.widthIn), kind: o.kind });
  }
  return doors;
}

// Listeners sit in these rooms first when there is no previous placement.
const ANCHOR_ORDER: RoomKind[] = ["bedroom", "hallway", "kitchen", "tv-room", "living", "bathroom", "front-door", "other"];

function defaultAnchors(rooms: HomeRoom[]): Anchor[] {
  return [...rooms]
    .sort((a, b) => ANCHOR_ORDER.indexOf(a.kind) - ANCHOR_ORDER.indexOf(b.kind))
    .slice(0, 4)
    .map((r) => ({ receiverId: r.id, position: r.centroid, heightIn: ANCHOR_HEIGHT_IN }));
}

export interface BuildOptions {
  householdId: string;
  prev?: HomeModel; // newest saved model; its version, anchors and hazards carry over
  hazards?: Hazard[];
  photoPaths?: string[][]; // per parsed room, same order
  ids?: string[]; // force room ids (for example to avoid ids used by another household)
  drawn?: { name: string; polygon: Vec2[] }[]; // rooms the scan missed, drawn by hand in plan inches (closets)
  outlines?: Record<string, Vec2[]>; // by room name: a hand-corrected outline in plan inches
  open?: [string, string][]; // by room name: rooms with no wall between them, joined along their shared edge
}

export function buildHomeModel(parsed: ParsedRoom[], opts: BuildOptions): HomeModel {
  const rooms0 = normalize(parsed);
  const ids = opts.ids ?? uniqueIds(rooms0.map((r) => r.name));

  const rooms: HomeRoom[] = rooms0.map((r, i) => {
    const polygon = clockwise(opts.outlines?.[r.name] ?? r.polygon);
    return {
      id: ids[i],
      name: r.name,
      kind: kindFor(r.name),
      polygon,
      centroid: roundPoint(centreOf(polygon)),
      heightIn: Math.round(r.heightIn),
      walls: r.walls,
      objects: r.objects,
      photoPaths: opts.photoPaths?.[i] ?? [],
    };
  });

  const doors = matchDoors(
    rooms,
    rooms0.flatMap((r) => r.openings.map((o) => ({ center: midpoint(o.start, o.end), widthIn: o.widthIn, kind: o.kind === "door" ? ("door" as const) : ("opening" as const) }))),
  );

  // Hand-drawn rooms come after door matching, so a scanned door is never pinned to a closet drawn beside it.
  const taken = new Set(ids);
  for (const d of opts.drawn ?? []) {
    const polygon = clockwise(d.polygon);
    rooms.push({ id: uniqueIds([d.name], taken)[0], name: d.name, kind: kindFor(d.name), polygon, centroid: roundPoint(centreOf(polygon)), heightIn: rooms[0]?.heightIn ?? 96, objects: [], photoPaths: [] });
  }

  // An open plan has no wall to scan, so join those rooms with an opening as wide as the edge they share.
  for (const [nameA, nameB] of opts.open ?? []) {
    const a = rooms.find((r) => r.name === nameA), b = rooms.find((r) => r.name === nameB);
    const edge = a && b && sharedEdge(a.polygon, b.polygon);
    if (!edge) continue;
    doors.push({ id: `${a.id}|${b.id}|open`, roomA: a.id, roomB: b.id, center: roundPoint(midpoint(edge[0], edge[1])), widthIn: Math.round(distance(edge[0], edge[1])), kind: "opening" });
  }

  // Keep the old anchors for receivers whose room still exists; otherwise place new ones.
  const roomIds = new Set(rooms.map((r) => r.id));
  const kept = (opts.prev?.anchors ?? []).filter((a) => roomIds.has(a.receiverId) || !opts.prev?.rooms.some((r) => r.id === a.receiverId));

  return {
    householdId: opts.householdId,
    version: (opts.prev?.version ?? 0) + 1,
    unit: "in",
    rooms,
    doors,
    anchors: kept.length ? kept : defaultAnchors(rooms),
    hazards: opts.hazards ?? opts.prev?.hazards ?? [],
    assets: opts.prev?.assets,
  };
}

// The centroid when it is well inside the room, otherwise the most open point inside it (L and T shaped rooms).
const CENTRE_CLEARANCE_IN = 12;
export function centreOf(polygon: Vec2[]): Vec2 {
  const c = polygonCentroid(polygon);
  return pointInPolygon(c, polygon) && edgeDistance(c, polygon) >= CENTRE_CLEARANCE_IN ? c : innerPoint(polygon);
}

const midpoint = (a: Vec2, b: Vec2) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const roundPoint = (p: Vec2) => ({ x: round(p.x), y: round(p.y) });
