import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseCapturedRoom } from "./parse";

const scan = (file: string, name: string) => parseCapturedRoom(JSON.parse(readFileSync(`fixtures/${file}`, "utf8")), name);

test("units: column-major matrices in either encoding, meters to inches", () => {
  const flat = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 2, 0, 3, 1];
  assert.deepEqual(colMajor([[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [2, 0, 3, 1]]), flat);
  assert.equal(Math.round(metersToInches(1) * 100) / 100, 39.37);
  const f = toFloor(flat, 1);
  assert.equal(Math.round(f.center.x), 79); // 2 m
  assert.equal(Math.round(f.center.y), 118); // world z = 3 m becomes plan y
  assert.equal(Math.round(f.end.x - f.start.x), 39); // 1 m wide along x
});

test("parse: synthetic RoomPlan bedroom has 4 walls, a door and a bed", () => {
  const room = scan("captured-room-bedroom.json", "Bedroom");
  assert.equal(room.walls.length, 4);
  assert.equal(room.openings.length, 1);
  assert.equal(Math.round(room.openings[0].widthIn), 30); // 0.76 m
  assert.deepEqual(room.objects.map((o) => o.category).sort(), ["bed", "storage"]);
  assert.equal(room.polygon.length, 4);
});

test("build: slug ids, kinds, clockwise polygons, matched doors and default anchors", () => {
  const home = buildHomeModel([scan("captured-room-bedroom.json", "Bedroom"), scan("captured-room-hallway.json", "Hallway")], { householdId: "h1" });
  assert.deepEqual(home.rooms.map((r) => r.id), ["bedroom", "hallway"]);
  assert.deepEqual(home.rooms.map((r) => r.kind), ["bedroom", "hallway"]);
  assert.equal(home.version, 1);
  const door = home.doors.find((d) => d.kind === "door")!;
  assert.deepEqual([door.roomA, door.roomB].sort(), ["bedroom", "hallway"]);
  assert.ok(adjacency(home).bedroom.includes("hallway"));
  for (const r of home.rooms) assert.equal(roomAt(home, r.centroid)?.id, r.id);
  assert.deepEqual(home.anchors.map((a) => a.receiverId), ["bedroom", "hallway"]);
  const minX = Math.min(...home.rooms.flatMap((r) => r.polygon.map((p) => p.x)));
  assert.equal(minX, 0); // normalized to the origin
});

test("build: a rebuild keeps anchors and bumps the version", () => {
  const rooms = [scan("captured-room-bedroom.json", "Bedroom"), scan("captured-room-hallway.json", "Hallway")];
  const first = buildHomeModel(rooms, { householdId: "h1" });
  first.anchors[0].position = { x: 10, y: 10 };
  const second = buildHomeModel(rooms, { householdId: "h1", prev: first });
  assert.equal(second.version, 2);
  assert.deepEqual(second.anchors[0].position, { x: 10, y: 10 });
});

  const rooms = [scan("captured-room-bedroom.json", "Bedroom"), scan("captured-room-hallway.json", "Hallway")];
test("slug and kind", () => {
  assert.equal(slug("TV room"), "tv-room");
  assert.equal(slug("  Front Door! "), "front-door");
  assert.equal(kindFor("Master Bedroom"), "bedroom");
  assert.equal(kindFor("Front door"), "front-door");
  assert.equal(kindFor("Den"), "tv-room");
});
