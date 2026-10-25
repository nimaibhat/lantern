import assert from "node:assert/strict";
import { test } from "node:test";
import type { HomeDoor, HomeModel, HomeRoom, RoomKind, Vec2 } from "@/lib/types";
import { polygonCentroid, roomAt } from "@/lib/world/geometry";
import { BetweenSensors } from "./between";
import { namedAnchors } from "./engine";

// An L-shaped living room, kitchen, hallway, bedroom and bathroom, with a laptop named after each room but the hall
const room = (id: string, name: string, kind: RoomKind, pts: number[][]): HomeRoom => {
  const polygon = pts.map(([x, y]) => ({ x, y }));
  return { id, name, kind, polygon, centroid: polygonCentroid(polygon), heightIn: 96 };
};
const door = (roomA: string, roomB: string, x: number, y: number): HomeDoor => ({ id: `${roomA}|${roomB}`, roomA, roomB, center: { x, y }, widthIn: 34, kind: "door" });
const bare: HomeModel = {
  householdId: "h2", version: 1, unit: "in", hazards: [], anchors: [],
  rooms: [
    room("living", "Living room", "living", [[0, 0], [240, 0], [240, 120], [120, 120], [120, 240], [0, 240]]),
    room("kitchen", "Kitchen", "kitchen", [[240, 0], [400, 0], [400, 120], [240, 120]]),
    room("hall", "Hallway", "hallway", [[120, 120], [240, 120], [240, 180], [120, 180]]),
    room("bedroom", "Bedroom", "bedroom", [[240, 120], [400, 120], [400, 300], [240, 300]]),
    room("bath", "Bathroom", "bathroom", [[120, 180], [240, 180], [240, 300], [120, 300]]),
  ],
  doors: [door("living", "kitchen", 240, 60), door("living", "hall", 120, 150), door("hall", "bedroom", 240, 150), door("hall", "bath", 180, 180)],
};
const laptops = ["Living room", "Kitchen", "Bedroom", "Bathroom"];
const house: HomeModel = { ...bare, anchors: namedAnchors(bare, laptops) };

// A seeded wobble, so a noisy signal is the same every run
function rng(seed: number) {
  return () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) * 2 - 1;
}

// Feed every laptop its signal for `ms`, ticking like the monitor does, and return each drawn spot
function run(b: BetweenSensors, t0: number, ms: number, signal: Record<string, number>, noise = 0, wobble = rng(7)) {
  const drawn: { t: number; x: number; y: number; room: string }[] = [];
  for (let t = t0; t <= t0 + ms; t += 100) {
    if ((t - t0) % 1000 === 0) for (const id of laptops) b.push({ receiverId: id, rssi: Math.round(signal[id] + noise * wobble()), ts: t });
    if ((t - t0) % 200 === 0) {
      const e = b.tick(t);
      if (e) drawn.push({ t, x: e.x, y: e.y, room: e.room });
    }
  }
  return drawn;
}

test("as loud at the bedroom as at the living room: the hallway between them", () => {
  const b = new BetweenSensors(house);
  const last = run(b, 0, 8000, { "Living room": -65, Bedroom: -65, Kitchen: -85, Bathroom: -84 }).at(-1)!;
  assert.equal(last.room, "hall", `at ${Math.round(last.x)}, ${Math.round(last.y)}`);
  assert.equal(roomAt(house, last)?.id, "hall");
});

test("a clearly louder sensor puts the person in its room", () => {
  const b = new BetweenSensors(house);
  const last = run(b, 0, 6000, { "Living room": -82, Bedroom: -58, Kitchen: -80, Bathroom: -74 }).at(-1)!;
  assert.equal(last.room, "bedroom");
  const at = house.anchors.find((a) => a.receiverId === "Bedroom")!.position;
  assert.ok(Math.hypot(last.x - at.x, last.y - at.y) < 1, "on the bedroom sensor");
});

test("a noisy signal while they stand still does not move the dot", () => {
  const b = new BetweenSensors(house);
  const drawn = run(b, 0, 30_000, { "Living room": -70, Bedroom: -62, Kitchen: -80, Bathroom: -76 }, 4).slice(10);
  const xs = drawn.map((d) => d.x), ys = drawn.map((d) => d.y);
  const wander = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  assert.ok(wander < 30, `wandered ${Math.round(wander)} in`);
  assert.equal(new Set(drawn.map((d) => d.room)).size, 1, "one room the whole time");
});

test("walking from the bedroom to the living room, the dot goes through the doors at walking pace", () => {
  const b = new BetweenSensors(house);
  run(b, 0, 6000, { "Living room": -84, Bedroom: -56, Kitchen: -82, Bathroom: -76 });
  const drawn = run(b, 6100, 12_000, { "Living room": -56, Bedroom: -84, Kitchen: -78, Bathroom: -80 });
  for (const d of drawn) assert.ok(roomAt(house, d), `off the floor at ${Math.round(d.x)}, ${Math.round(d.y)}`);
  for (let i = 1; i < drawn.length; i++) {
    const step = Math.hypot(drawn[i].x - drawn[i - 1].x, drawn[i].y - drawn[i - 1].y) / ((drawn[i].t - drawn[i - 1].t) / 1000);
    assert.ok(step <= 56, `moved at ${Math.round(step)} in/s`);
  }
  assert.ok(drawn.some((d) => d.room === "hall"), "passed through the hallway");
  assert.equal(drawn.at(-1)!.room, "living");
});
