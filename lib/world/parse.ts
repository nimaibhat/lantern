// RoomPlan CapturedRoom JSON (what JSONEncoder produces on the phone) to one parsed room in inches.
// Enum categories encode as { "door": { "isOpen": true } } or { "bed": {} }, so we read the first key.
// The real file wins over these assumptions; check a real scan with `npx tsx lib/world/cli.ts <file>`.

import type { Opening, RoomObject, Segment, Vec2 } from "@/lib/types";
import { localToFloor, metersToInches, toFloor } from "./units";

type Json = Record<string, any>;

export interface ParsedRoom {
  name: string;
  polygon: Vec2[];
  walls: Segment[];
  openings: Opening[]; // doors and doorless openings
  windows: Opening[];
  objects: RoomObject[];
  heightIn: number;
}

function categoryOf(c: unknown): { name: string; value: Json } {
  if (typeof c === "string") return { name: c, value: {} };
  if (c && typeof c === "object") {
    const [name] = Object.keys(c);
    return { name, value: (c as Json)[name] ?? {} };
  }
  return { name: "unknown", value: {} };
}

const idOf = (s: Json) => String(s.identifier ?? crypto.randomUUID());

function segment(s: Json): Segment {
  const f = toFloor(s.transform, s.dimensions?.[0] ?? 0);
  return { id: idOf(s), start: f.start, end: f.end, heightIn: metersToInches(s.dimensions?.[1] ?? 0) };
}

function opening(s: Json, kind: Opening["kind"]): Opening {
  return { ...segment(s), kind, widthIn: metersToInches(s.dimensions?.[0] ?? 0), isOpen: categoryOf(s.category).value.isOpen };
}

function object(o: Json): RoomObject {
  const [w = 0, h = 0, d = 0] = o.dimensions ?? [];
  const f = toFloor(o.transform, 0);
  return {
    id: idOf(o),
    category: categoryOf(o.category).name,
    center: f.center,
    widthIn: metersToInches(w),
    depthIn: metersToInches(d),
    heightIn: metersToInches(h),
    rotationDeg: f.rotationDeg,
  };
}

// Floor polygon if RoomPlan gave one (iOS 17), otherwise the bounding box of the walls.
function polygonOf(room: Json, walls: Segment[]): Vec2[] {
  const floor = room.floors?.[0];
  if (floor?.polygonCorners?.length >= 3) return floor.polygonCorners.map((p: number[]) => localToFloor(floor.transform, p));
  const pts = walls.flatMap((w) => [w.start, w.end]);
  if (pts.length === 0) return [];
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  return [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
}

export function parseCapturedRoom(json: Json, name: string): ParsedRoom {
  const walls: Segment[] = (json.walls ?? []).map(segment);
  return {
    name,
    polygon: polygonOf(json, walls),
    walls,
    openings: [
      ...(json.doors ?? []).map((d: Json) => opening(d, "door")),
      ...(json.openings ?? []).map((o: Json) => opening(o, "opening")),
    ],
    windows: (json.windows ?? []).map((w: Json) => opening(w, "window")),
    objects: (json.objects ?? []).map(object),
    heightIn: Math.max(0, ...walls.map((w) => w.heightIn)) || 96,
  };
}
