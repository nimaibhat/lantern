// RoomPlan to floor-plan conversion, in one place.
// RoomPlan is meters, y up. The floor plan is RoomPlan (x, z) in inches, so plan y = world z.
// A simd_float4x4 encodes as 16 numbers or 4 columns of 4, column-major: translation is at 12 and 14,
// and the first column (0, 2) is the surface's width direction.

import type { Vec2 } from "@/lib/types";

export const IN_PER_M = 39.3701;
export const metersToInches = (m: number) => m * IN_PER_M;

export function colMajor(t: unknown): number[] {
  const m = (Array.isArray(t) ? (Array.isArray(t[0]) ? (t as number[][]).flat() : t) : []) as number[];
  if (m.length !== 16) throw new Error("Unexpected transform shape in RoomPlan JSON");
  return m;
}

// Center, direction and end points of a surface of the given width (meters) on the floor plan.
export function toFloor(t: unknown, widthM: number) {
  const m = colMajor(t);
  const cx = m[12], cz = m[14];
  const len = Math.hypot(m[0], m[2]) || 1;
  const ux = m[0] / len, uz = m[2] / len, h = widthM / 2;
  return {
    center: { x: metersToInches(cx), y: metersToInches(cz) },
    start: { x: metersToInches(cx - ux * h), y: metersToInches(cz - uz * h) },
    end: { x: metersToInches(cx + ux * h), y: metersToInches(cz + uz * h) },
    rotationDeg: (Math.atan2(uz, ux) * 180) / Math.PI,
  };
}

// A point given in a surface's local frame, moved into the floor plan.
export function localToFloor(t: unknown, [px, py, pz]: number[]): Vec2 {
  const m = colMajor(t);
  return {
    x: metersToInches(m[0] * px + m[4] * py + m[8] * pz + m[12]),
    y: metersToInches(m[2] * px + m[6] * py + m[10] * pz + m[14]),
  };
}
