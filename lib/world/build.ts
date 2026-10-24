// Parsed scan rooms to the shared HomeModel every part of the system codes against.
// Rooms get slug ids, doors are matched to the two rooms they connect, and listener anchors carry over
// from the previous model so a re-scan does not undo where the laptops were placed.

import type { Anchor, Hazard, HomeDoor, HomeModel, HomeRoom, RoomKind, Vec2 } from "@/lib/types";
import { distance, nearestPointInPolygon, pointInPolygon, polygonCentroid } from "./geometry";
import type { ParsedRoom } from "./parse";

const DOOR_MATCH_IN = 18; // a door belongs to a room if its center is this close to the room's outline
const DOOR_MERGE_IN = 18; // two rooms see the same door; merge detections this close together
const ANCHOR_HEIGHT_IN = 36;

export const slug = (name: string) =>
  name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "room";

export function kindFor(name: string): RoomKind {
  const n = name.toLowerCase();
  if (/bed/.test(n)) return "bedroom";
  if (/bath|toilet|restroom|wc/.test(n)) return "bathroom";
  if (/hall|corridor/.test(n)) return "hallway";
  if (/kitchen/.test(n)) return "kitchen";
  if (/tv|den|family/.test(n)) return "tv-room";
  if (/door|entry|foyer|exit/.test(n)) return "front-door";
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

export function matchDoors(rooms: HomeRoom[], openings: { center: Vec2; widthIn: number; kind: "door" | "opening" }[]): HomeDoor[] {
  for (const o of openings) {
    const same = merged.find((m) => distance(m.center, o.center) < DOOR_MERGE_IN);
  }

  const doors: HomeDoor[] = [];
  for (const o of merged) {
    const near = rooms
      .filter((x) => x.d < DOOR_MATCH_IN)
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
}

export function buildHomeModel(parsed: ParsedRoom[], opts: BuildOptions): HomeModel {
  const rooms0 = normalize(parsed);
  const ids = opts.ids ?? uniqueIds(rooms0.map((r) => r.name));

  const rooms: HomeRoom[] = rooms0.map((r, i) => {
    const polygon = clockwise(r.polygon);
    return {
      id: ids[i],
      name: r.name,
      kind: kindFor(r.name),
      polygon,
      centroid: roundPoint(polygonCentroid(polygon)),
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

const midpoint = (a: Vec2, b: Vec2) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const roundPoint = (p: Vec2) => ({ x: round(p.x), y: round(p.y) });
