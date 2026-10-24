import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { HomeDoor, HomeModel, HomeRoom, RoomObject, Vec2 } from "@/lib/types";
import { auditHome, bedClearance, doorWidths, routeWidth, toiletClearance, turningSpace } from "./ada";
import { fixFor } from "./fixes";
import { mobilityItems, planMobility } from "./mobility";

const rect = (x: number, y: number, w: number, h: number): Vec2[] => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
const room = (id: string, kind: HomeRoom["kind"], polygon: Vec2[], objects: RoomObject[] = []): HomeRoom => ({
  id, name: id[0].toUpperCase() + id.slice(1), kind, polygon, centroid: { x: (polygon[0].x + polygon[2].x) / 2, y: (polygon[0].y + polygon[2].y) / 2 }, heightIn: 96, objects,
});
const obj = (category: string, x: number, y: number, w: number, d: number): RoomObject => ({ id: `${category}-${x}`, category, center: { x, y }, widthIn: w, depthIn: d, heightIn: 30, rotationDeg: 0 });
const door = (a: string, b: string, x: number, y: number, widthIn: number): HomeDoor => ({ id: `${a}|${b}`, roomA: a, roomB: b, center: { x, y }, widthIn, kind: "door" });
const home = (rooms: HomeRoom[], doors: HomeDoor[]): HomeModel => ({ householdId: "t", version: 1, unit: "in", rooms, doors, anchors: [], hazards: [] });

// Bedroom (0,0)-(144,144) and a 48 in hallway (144,0)-(192,144), joined by one door.
const twoRooms = (doorWidth: number, hallObjects: RoomObject[] = []) =>
  home([room("bedroom", "bedroom", rect(0, 0, 144, 144)), room("hallway", "hallway", rect(144, 0, 48, 144), hallObjects)], [door("bedroom", "hallway", 144, 72, doorWidth)]);

test("a 28 in door fails and a 36 in door passes", () => {
  const narrow = twoRooms(30); // 30 in opening, about 28 in clear
  const items = doorWidths(narrow.rooms[0], narrow);
  assert.equal(items.length, 1);
  assert.equal(items[0].measuredIn, 28);
  assert.equal(items[0].severity, "high");
  const wide = twoRooms(38);
  assert.equal(doorWidths(wide.rooms[0], wide).length, 0);
});

test("a door just over the limit is flagged low and asks for a tape measure", () => {
  const h = twoRooms(35); // 33 in clear
  const [item] = doorWidths(h.rooms[0], h);
  assert.equal(item.severity, "low");
  assert.match(item.detail, /verify with a tape measure/);
});

test("a shared door is reported once", () => {
  const h = twoRooms(28);
  assert.equal(auditHome(h).filter((i) => i.code === "ADA 404.2.3").length, 1);
});

test("a cluttered hallway fails the route width check", () => {
  const clear = home([room("hallway", "hallway", rect(0, 0, 48, 200))], [door("hallway", "a", 24, 0, 36), door("hallway", "b", 24, 200, 36)]);
  assert.equal(routeWidth(clear.rooms[0], clear).length, 0);
  const cluttered = home([room("hallway", "hallway", rect(0, 0, 48, 200), [obj("storage", 10, 100, 20, 30)])], clear.doors);
  const [item] = routeWidth(cluttered.rooms[0], cluttered);
  assert.ok(item, "expected a narrow path");
  assert.ok(item.measuredIn! < 36);
});

test("turning space: an empty bedroom passes, a crowded bathroom fails", () => {
  assert.equal(turningSpace(room("bedroom", "bedroom", rect(0, 0, 144, 144))).length, 0);
  const bath = room("bathroom", "bathroom", rect(0, 0, 60, 90), [obj("bathtub", 30, 15, 60, 30), obj("toilet", 50, 70, 18, 28)]);
  const [item] = turningSpace(bath);
  assert.ok(item);
  assert.ok(item.measuredIn! < 60);
});

test("toilet and bed clearance", () => {
  const tight = room("bathroom", "bathroom", rect(0, 0, 40, 50), [obj("toilet", 20, 14, 18, 28)]);
  assert.equal(toiletClearance(tight).length, 1);
  const roomy = room("bathroom", "bathroom", rect(0, 0, 100, 100), [obj("toilet", 50, 14, 18, 28)]);
  assert.equal(toiletClearance(roomy).length, 0);
  const againstWall = room("bedroom", "bedroom", rect(0, 0, 90, 120), [obj("bed", 32, 50, 60, 80)]);
  assert.equal(bedClearance(againstWall).length, 1);
  const centered = room("bedroom", "bedroom", rect(0, 0, 160, 120), [obj("bed", 80, 50, 60, 80)]);
  assert.equal(bedClearance(centered).length, 0);
});

test("mobility: a wheelchair cannot use a 30 in door, a walker can", () => {
  const h = twoRooms(30);
  assert.equal(planMobility(h, "walker").every((l) => l.ok), true);
  const [leg] = planMobility(h, "wheelchair");
  assert.equal(leg.ok, false);
  assert.match(leg.reason!, /too narrow/);
  assert.equal(mobilityItems(h, "wheelchair").length, 1);
  assert.equal(planMobility(twoRooms(36), "wheelchair")[0].ok, true);
});

test("mobility: furniture across the hallway blocks a walker", () => {
  const blocked = twoRooms(36, [obj("storage", 168, 72, 48, 40)]);
  const h = home([...blocked.rooms, room("kitchen", "kitchen", rect(192, 0, 100, 144))], [...blocked.doors, door("hallway", "kitchen", 192, 72, 36)]);
  // The cabinet fills the hallway's width right between the two doors.
  assert.equal(planMobility(h, "walker").some((l) => !l.ok), true);
});

test("the demo fixture yields sensible findings and every finding has a location", () => {
  const fixture: HomeModel = JSON.parse(readFileSync("fixtures/home-model.json", "utf8"));
  const items = auditHome(fixture);
  for (const i of items) assert.ok(i.location, `${i.title} has no location`);
  assert.ok(planMobility(fixture, "walker").every((l) => l.ok), "a walker should get around the demo home");
});

test("fixes map findings to products", () => {
  assert.match(fixFor({ title: "Door between Bedroom and Hallway is narrow", detail: "", code: "ADA 404.2.3" })!.product, /hinge/i);
  assert.match(fixFor({ title: "No grab bar beside the toilet", detail: "" })!.product, /grab bar/i);
  assert.equal(fixFor({ title: "Something unrelated", detail: "nothing" }), undefined);
});
