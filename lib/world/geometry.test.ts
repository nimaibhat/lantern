import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { HomeModel } from "@/lib/types";
import {
  adjacency,
  clampToRoom,
  nearestPointInPolygon,
  pointAlong,
  pointInPolygon,
  polygonArea,
  polygonCentroid,
  roomAt,
  roomPath,
  routeBetween,
} from "./geometry";

const home: HomeModel = JSON.parse(readFileSync("fixtures/home-model.json", "utf8"));
const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];

test("roomAt finds every room from its centroid", () => {
  for (const r of home.rooms) assert.equal(roomAt(home, r.centroid)?.id, r.id);
});

test("roomAt is undefined outside the home", () => {
  assert.equal(roomAt(home, { x: -10, y: -10 }), undefined);
  assert.equal(roomAt(home, { x: 500, y: 100 }), undefined);
});

test("the fixture has no isolated room", () => {
  for (const [room, next] of Object.entries(adjacency(home))) assert.ok(next.length > 0, `${room} has no door`);
});

test("every room can reach every other room", () => {
  for (const a of home.rooms) for (const b of home.rooms) assert.ok(roomPath(home, a.id, b.id).length > 0, `${a.id} -> ${b.id}`);
});

test("routeBetween bedroom and kitchen goes through the hallway doors", () => {
  assert.deepEqual(roomPath(home, "bedroom", "kitchen"), ["bedroom", "hallway", "kitchen"]);
  const route = routeBetween(home, "bedroom", "kitchen");
  assert.deepEqual(route, [{ x: 72, y: 72 }, { x: 144, y: 72 }, { x: 216, y: 72 }, { x: 300, y: 72 }]);
});

test("routeBetween within one room is just its centroid", () => {
  assert.deepEqual(routeBetween(home, "kitchen", "kitchen"), [home.rooms.find((r) => r.id === "kitchen")!.centroid]);
});

test("routeBetween is empty for unknown rooms", () => {
  assert.deepEqual(routeBetween(home, "bedroom", "garage"), []);
});

test("clampToRoom keeps inside points and moves outside points to the boundary", () => {
  assert.deepEqual(clampToRoom(home, "bedroom", { x: 20, y: 20 }), { x: 20, y: 20 });
  const p = clampToRoom(home, "bedroom", { x: 200, y: 72 });
  assert.deepEqual(p, { x: 144, y: 72 });
  assert.deepEqual(clampToRoom(home, "bedroom", { x: -30, y: -30 }), { x: 0, y: 0 });
});

test("nearestPointInPolygon lands on the closest edge", () => {
  assert.deepEqual(nearestPointInPolygon({ x: 5, y: 15 }, square), { x: 5, y: 10 });
});

test("polygon area, centroid and inside test", () => {
  assert.equal(polygonArea(square), 100);
  assert.deepEqual(polygonCentroid(square), { x: 5, y: 5 });
  assert.ok(pointInPolygon({ x: 5, y: 5 }, square));
  assert.ok(!pointInPolygon({ x: 15, y: 5 }, square));
});

test("pointAlong walks a polyline and clamps at the ends", () => {
  const line = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
  assert.deepEqual(pointAlong(line, 15), { x: 10, y: 5 });
  assert.deepEqual(pointAlong(line, 99), { x: 10, y: 10 });
  assert.deepEqual(pointAlong(line, -5), { x: 0, y: 0 });
});
