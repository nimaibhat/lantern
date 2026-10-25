import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { HomeDoor, HomeModel, HomeRoom, RoomKind, Vec2 } from "@/lib/types";
import { pointInPolygon, polygonCentroid } from "@/lib/world/geometry";
import { wallPieces } from "@/lib/world/walls";
import { InferenceEngine, namedAnchors } from "./engine";
import { FastPositioner } from "./fast";
import { FloorFilter, crossings } from "./floor-filter";
import type { KnnModel } from "./knn";

// Six rooms: bedroom, hallway, kitchen, bathroom, tv-room, front door; listeners in bedroom, hallway, kitchen, tv-room
const home: HomeModel = JSON.parse(readFileSync("fixtures/home-model.json", "utf8"));
const walls = wallPieces(home);
const order = ["bedroom", "hallway", "kitchen", "tv-room"];
const online = Object.fromEntries(order.map((id) => [id, true]));
const anchor = (id: string) => home.anchors.find((a) => a.receiverId === id)!.position;

// The floor grid's own signal model, without noise
const heard = (p: Vec2) =>
  order.map((id) => Math.round(-59 - 25 * Math.log10(Math.max(Math.hypot(p.x - anchor(id).x, p.y - anchor(id).y) * 0.0254, 0.3)) - 6 * crossings(p, anchor(id), walls)));

test("walls between two points are counted, door openings are not", () => {
  assert.equal(crossings({ x: 40, y: 40 }, { x: 100, y: 100 }, walls), 0, "same room");
  assert.equal(crossings({ x: 72, y: 72 }, { x: 300, y: 72 }, walls), 0, "bedroom to kitchen straight through both hallway doors");
  assert.equal(crossings({ x: 72, y: 30 }, { x: 300, y: 30 }, walls), 2, "the same trip above the doors");
  assert.equal(crossings({ x: 72, y: 72 }, { x: 72, y: 216 }, walls), 1, "bedroom to bathroom");
});

test("the grid settles near where the readings come from", () => {
  for (const p of [{ x: 40, y: 110 }, { x: 330, y: 250 }, { x: 180, y: 40 }]) {
    const f = new FloorFilter(home);
    for (let i = 0; i < 6; i++) f.step(order, heard(p), online);
    const est = f.estimate()!;
    assert.ok(Math.hypot(est.x - p.x, est.y - p.y) < 40, `${JSON.stringify(p)} came out at ${Math.round(est.x)}, ${Math.round(est.y)}`);
    assert.ok(est.spreadIn > 0 && est.spreadIn < 60, `spread ${est.spreadIn}`);
  }
});

test("belief cannot walk through a wall in one step", () => {
  const f = new FloorFilter(home, { walkIn: 48 });
  // Certain the person is just inside the bedroom wall shared with the bathroom, away from any door
  const start = f.cells.findIndex((c) => c.room === "bedroom" && c.x < 100 && c.y > 130);
  const g = f as unknown as { p: Float64Array };
  g.p.fill(0);
  g.p[start] = 1;
  // Readings that scream bathroom: only the bathroom side of the wall would match, but it is not reachable yet
  f.step(order, heard({ x: 60, y: 160 }), online);
  assert.equal(f.estimate()!.room, "bedroom");
});

test("the fast dot follows raw readings and stays quiet without them", () => {
  const fast = new FastPositioner(home);
  assert.equal(fast.tick(1000, online), undefined, "nothing heard yet");
  const p = { x: 320, y: 240 };
  for (let t = 0; t < 3000; t += 100) {
    heard(p).forEach((rssi, i) => fast.push({ receiverId: order[i], rssi, ts: t }));
    fast.tick(t + 50, online);
  }
  const e = fast.tick(3100, online)!;
  assert.equal(e.room, "tv-room");
  assert.ok(Math.hypot(e.x - p.x, e.y - p.y) < 40, `came out at ${Math.round(e.x)}, ${Math.round(e.y)}`);
});

test("the engine draws the fast dot from live readings, with how sure it is", () => {
  const engine = new InferenceEngine(home, {}, { hourOf: () => 12 });
  const p = { x: 300, y: 72 }, t0 = 1_000_000;
  for (let t = 0; t <= 4000; t += 100) {
    heard(p).forEach((rssi, i) => engine.onReading({ receiverId: order[i], rssi, ts: t0 + t }));
    if (t % 1000 === 0) engine.onFrame({ ts: t0 + t, order, rssi: heard(p), online });
  }
  const pos = engine.tick(t0 + 4050)!;
  assert.ok(pos, "a position");
  assert.equal(pos.roomId, "kitchen");
  assert.ok(Math.hypot(pos.x - p.x, pos.y - p.y) < 40, `came out at ${pos.x}, ${pos.y}`);
  assert.equal(typeof pos.spreadIn, "number");
});

test("alerts and cues hear the room the live dot is in, once it has stayed there a moment", () => {
  const engine = new InferenceEngine(home, {}, { hourOf: () => 12 });
  const t0 = 2_000_000, said: string[] = [];
  const walk = (p: Vec2, from: number, to: number) => {
    for (let t = from; t <= to; t += 100) {
      heard(p).forEach((rssi, i) => engine.onReading({ receiverId: order[i], rssi, ts: t0 + t }));
      if (t % 1000 === 0) {
        const fromFrames = engine.onFrame({ ts: t0 + t, order, rssi: heard(p), online }).filter((e) => e.k === "location");
        if (t >= 1000) assert.deepEqual(fromFrames, [], "the frame tracker stays quiet while the live dot runs");
      }
      engine.tick(t0 + t + 50);
      for (const e of engine.drain()) if (e.k === "location") said.push(e.d.roomId);
    }
  };
  walk({ x: 300, y: 72 }, 0, 4000);
  assert.deepEqual(said, ["kitchen"]);
  walk({ x: 320, y: 240 }, 4100, 10000);
  assert.equal(said.at(-1), "tv-room");
  assert.equal(engine.tick(t0 + 10050)?.roomId, "tv-room", "the plan and the cues agree");
  assert.equal(engine.room, "tv-room");

  // A sensor placed while they sit there rebuilds the home model; that is not a move, so nothing new is said
  const before = said.length;
  engine.setHome({ ...home, version: home.version + 1 });
  walk({ x: 320, y: 240 }, 10100, 14000);
  assert.equal(said.length, before, `said ${said.slice(before).join(", ")}`);
  assert.equal(engine.room, "tv-room");
});

test("a model trained on another home hands the room decision to the floor grid", () => {
  const elsewhere: KnnModel = { kind: "knn", algo: "knn", k: 3, order: ["den", "porch"], rooms: ["den", "porch"], vectors: [[-50, -80], [-80, -50]], labels: ["den", "porch"] };
  const engine = new InferenceEngine(home, { knn: elsewhere }, { hourOf: () => 12, live: false });
  assert.match(engine.describe().classifier, /floor grid/);
  const p = { x: 330, y: 240 };
  for (let t = 0; t < 8; t++) engine.onFrame({ ts: 1_000_000 + t * 1000, order, rssi: heard(p), online });
  assert.equal(engine.room, "tv-room");
});

// A house this code has never seen: an L-shaped living room, kitchen, hallway, bedroom and bathroom. Nothing is
// placed; the laptops are only named after their rooms, as the Tracking page asks.
const room = (id: string, name: string, kind: RoomKind, pts: number[][]): HomeRoom => {
  const polygon = pts.map(([x, y]) => ({ x, y }));
  return { id, name, kind, polygon, centroid: polygonCentroid(polygon), heightIn: 96 };
};
const door = (roomA: string, roomB: string, x: number, y: number): HomeDoor => ({ id: `${roomA}|${roomB}`, roomA, roomB, center: { x, y }, widthIn: 34, kind: "door" });
const house: HomeModel = {
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
const laptops = ["living-room", "Kitchen", "bedroom", "bathroom"];

// What each named laptop hears from a spot in a home, through its walls
function hearIn(h: HomeModel, p: Vec2) {
  const w = wallPieces(h), at = Object.fromEntries(namedAnchors(h, laptops).map((a) => [a.receiverId, a.position]));
  return laptops.map((id) => Math.round(-59 - 25 * Math.log10(Math.max(Math.hypot(p.x - at[id].x, p.y - at[id].y) * 0.0254, 0.3)) - 6 * crossings(p, at[id], w)));
}

test("laptops named after rooms are placed in them; other names wait to be placed", () => {
  const placed = namedAnchors(house, [...laptops, "aarnav"]);
  assert.deepEqual(placed.map((a) => a.receiverId).sort(), ["Kitchen", "bathroom", "bedroom", "living-room"]);
  const living = placed.find((a) => a.receiverId === "living-room")!;
  assert.ok(pointInPolygon(living.position, house.rooms[0].polygon), "inside the L, not at its empty corner");
});

test("a newly scanned house pinpoints from named laptops alone, with no trained model", () => {
  const engine = new InferenceEngine(house, {}, { hourOf: () => 12 });
  const p = { x: 340, y: 250 }, t0 = 5_000_000, live = Object.fromEntries(laptops.map((id) => [id, true]));
  for (let t = 0; t <= 6000; t += 100) {
    hearIn(house, p).forEach((rssi, i) => engine.onReading({ receiverId: laptops[i], rssi, ts: t0 + t }));
    if (t % 1000 === 0) engine.onFrame({ ts: t0 + t, order: laptops, rssi: hearIn(house, p), online: live });
  }
  assert.equal(engine.room, "bedroom");
  const pos = engine.tick(t0 + 6050)!;
  assert.ok(Math.hypot(pos.x - p.x, pos.y - p.y) < 48, `came out at ${pos.x}, ${pos.y}`);
});

test("a scan that missed a door still lets belief reach the room behind it", () => {
  const missing = { ...house, doors: house.doors.filter((d) => d.roomB !== "bedroom") };
  const withLaptops = { ...missing, anchors: namedAnchors(missing, laptops) };
  const f = new FloorFilter(withLaptops);
  const live = Object.fromEntries(laptops.map((id) => [id, true]));
  for (let i = 0; i < 5; i++) f.step(laptops, hearIn(missing, { x: 180, y: 150 }), live);
  assert.equal(f.estimate()!.room, "hall");
  let steps = 0;
  while (f.estimate()!.room !== "bedroom" && steps < 30) {
    f.step(laptops, hearIn(missing, { x: 330, y: 220 }), live);
    steps++;
  }
  assert.ok(steps < 30, "never reached the bedroom");
});

test("the drawn dot walks around through the doors, never through a wall", () => {
  // Bedroom and bathroom share a wall; the only way between them is out through the hallway
  const fast = new FastPositioner(home);
  const shown: Vec2[] = [];
  const at = (p: Vec2, from: number, to: number) => {
    for (let t = from; t < to; t += 100) {
      heard(p).forEach((rssi, i) => fast.push({ receiverId: order[i], rssi, ts: t }));
      const e = fast.tick(t + 50, online);
      if (e) shown.push(e);
    }
  };
  at({ x: 60, y: 110 }, 0, 4000);
  at({ x: 60, y: 200 }, 4000, 14000);
  assert.ok(shown.length > 100);
  for (let i = 1; i < shown.length; i++) assert.equal(crossings(shown[i - 1], shown[i], walls), 0, `step ${i} crossed a wall`);
  assert.ok(shown[shown.length - 1].y > 150, "reached the bathroom");
});

test("as loud at the bedroom as at the kitchen: the person is in the hallway between them, and it says so", () => {
  // Only two listeners, in the bedroom and the kitchen; the hallway between them has none
  const two = { ...home, anchors: home.anchors.filter((a) => a.receiverId === "bedroom" || a.receiverId === "kitchen") };
  const ids = ["bedroom", "kitchen"], live = { bedroom: true, kitchen: true };
  const fast = new FastPositioner(two);
  const p = { x: 180, y: 72 }; // in the hallway, between the two doors
  const levels = heard(p).filter((_, i) => order[i] === "bedroom" || order[i] === "kitchen");
  let e;
  for (let t = 0; t < 6000; t += 100) {
    levels.forEach((rssi, i) => fast.push({ receiverId: ids[i], rssi, ts: t }));
    e = fast.tick(t + 50, live);
  }
  assert.equal(e!.room, "hallway");
  assert.ok(e!.x > 144 && e!.x < 216, `the dot sits in the hallway, at x ${Math.round(e!.x)}`);
});
