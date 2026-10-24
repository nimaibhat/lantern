// A pretend person walking through a home model, and what each listener would hear. Shared by
// tools/position-lag.ts (measures lag) and tools/mock-walk.ts (feeds the live monitor), so both use the same
// physics: distance, 6 dB per wall, slow body shadowing, a per-walk phone bias, noise and missed readings.

import { adjacency, edgeDistance, pointInPolygon, routeBetween } from "@/lib/world/geometry";
import { wallPieces } from "@/lib/world/walls";
import type { HomeModel, HomeRoom, Vec2 } from "@/lib/types";
import { crossings } from "../monitor/inference/floor-filter";

export type Rng = () => number;

export function rng(seed: number): Rng {
  let s = seed % 2147483647 || 1;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

export const gauss = (r: Rng) => Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r());
const uni = (r: Rng, a: number, b: number) => a + r() * (b - a);

function randomPoint(r: Rng, room: HomeRoom, margin = 14): Vec2 {
  const xs = room.polygon.map((p) => p.x), ys = room.polygon.map((p) => p.y);
  for (let i = 0; i < 500; i++) {
    const p = { x: uni(r, Math.min(...xs), Math.max(...xs)), y: uni(r, Math.min(...ys), Math.max(...ys)) };
    if (pointInPolygon(p, room.polygon) && edgeDistance(p, room.polygon) >= margin) return p;
  }
  return room.centroid;
}

// A walk sampled every 100 ms: wander inside a room with pauses, or walk through the doors to a neighbouring room.
export function walk(home: HomeModel, seconds: number, r: Rng): { track: Vec2[]; roomAt: string[] } {
  const rooms = home.rooms.filter((x) => !x.virtual && x.polygon.length >= 3);
  const adj = adjacency(home);
  let room = rooms[Math.floor(r() * rooms.length)];
  let at = randomPoint(r, room);
  const track: Vec2[] = [], roomAt: string[] = [];
  const go = (to: Vec2) => {
    const speed = uni(r, 22, 34), steps = Math.max(1, Math.round((Math.hypot(to.x - at.x, to.y - at.y) / speed) * 10));
    for (let i = 1; i <= steps; i++) {
      track.push({ x: at.x + ((to.x - at.x) * i) / steps, y: at.y + ((to.y - at.y) * i) / steps });
      roomAt.push(room.id);
    }
    at = to;
  };
  const wait = (s: number) => {
    for (let i = 0; i < s * 10; i++) { track.push(at); roomAt.push(room.id); }
  };
  while (track.length < seconds * 10) {
    const ids = adj[room.id] ?? [];
    const next = ids.length ? rooms.find((x) => x.id === ids[Math.floor(r() * ids.length)]) : undefined;
    if (r() < 0.55 || !next) {
      go(randomPoint(r, room));
      wait(uni(r, 0, 5));
    } else {
      for (const door of routeBetween(home, room.id, next.id).slice(1, -1)) go(door);
      room = next;
      go(randomPoint(r, room, 18));
    }
  }
  return { track: track.slice(0, seconds * 10), roomAt: roomAt.slice(0, seconds * 10) };
}

// What each listener hears from a spot. One instance per walk: it keeps the phone's bias and each listener's
// slowly drifting body shadowing. hear() returns undefined for a missed advertisement or a signal below the floor.
export class Radio {
  private walls;
  private anchors: Record<string, Vec2>;
  private shadow: Record<string, number> = {};
  private bias: number;

  constructor(home: HomeModel, private r: Rng, private wallDb = 6) {
    this.walls = wallPieces(home);
    this.anchors = Object.fromEntries(home.anchors.map((a) => [a.receiverId, a.position]));
    this.bias = gauss(r) * 3;
  }

  hear(id: string, p: Vec2): number | undefined {
    const a = this.anchors[id];
    if (!a) return;
    this.shadow[id] = 0.95 * (this.shadow[id] ?? 0) + gauss(this.r) * 0.9;
    if (this.r() < 0.15) return;
    const dM = Math.max(Math.hypot(p.x - a.x, p.y - a.y) * 0.0254, 0.3);
    const rssi = Math.round(-59 - 25 * Math.log10(dM) - this.wallDb * crossings(p, a, this.walls) + this.bias + this.shadow[id] + gauss(this.r) * 3);
    return rssi > -95 ? rssi : undefined;
  }
}
