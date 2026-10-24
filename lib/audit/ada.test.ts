import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { HomeDoor, HomeModel, HomeRoom, RoomObject, Vec2 } from "@/lib/types";
import { auditHome, bedClearance, doorWidths, routeWidth, toiletClearance, turningSpace } from "./ada";
import { fixFor } from "./fixes";
import { mobilityItems, planMobility, ruleItems } from "./mobility";

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

test("a usual 30 in door is fine for a walker but flagged for a wheelchair", () => {
  const usual = twoRooms(30); // 30 in opening, about 28 in clear
  assert.equal(doorWidths(usual.rooms[0], usual).length, 0);
  const [item] = doorWidths(usual.rooms[0], usual, "wheelchair");
  assert.equal(item.measuredIn, 28);
  assert.equal(item.severity, "high");
  assert.equal(doorWidths(twoRooms(38).rooms[0], twoRooms(38), "wheelchair").length, 0);
});

test("a door a walker barely fits is medium and asks for a tape measure", () => {
  const h = twoRooms(29); // 27 in clear
  const [item] = doorWidths(h.rooms[0], h);
  assert.equal(item.severity, "medium");
  assert.match(item.title, /narrow for a walker/);
  assert.match(item.detail, /verify with a tape measure/);
  const tight = twoRooms(25); // 23 in clear
  assert.equal(doorWidths(tight.rooms[0], tight)[0].severity, "high");
});

test("open-plan walls and bedroom closet doors are not checked", () => {
  const h = twoRooms(20);
  h.doors.push({ ...h.doors[0], id: "bedroom|hallway|open", kind: "opening", widthIn: 100 });
  assert.equal(doorWidths(h.rooms[0], h).length, 0);
  const closet = home([room("bedroom", "bedroom", rect(0, 0, 144, 144))], [door("bedroom", "outside", 0, 72, 20)]);
  assert.equal(doorWidths(closet.rooms[0], closet).length, 0);
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
  assert.equal(mobilityItems(h, "wheelchair").length, 0); // the door rule already reports this door
  assert.equal(doorWidths(h.rooms[0], h, "wheelchair").length, 1);
  assert.equal(planMobility(twoRooms(36), "wheelchair")[0].ok, true);
});

test("mobility: a door exactly as wide as the device passes wherever it falls on the grid", () => {
  for (let y = 66; y <= 78; y += 0.25) {
    const at = (w: number) => home(twoRooms(w).rooms, [door("bedroom", "hallway", 144, y, w)]);
    assert.equal(planMobility(at(32), "wheelchair")[0].ok, true, `32 in door at y=${y}`);
    assert.equal(planMobility(at(31), "wheelchair")[0].ok, false, `31 in door at y=${y}`);
    assert.equal(planMobility(at(24), "walker")[0].ok, true, `24 in door at y=${y}`);
    assert.equal(planMobility(at(23), "walker")[0].ok, false, `23 in door at y=${y}`);
  }
});

test("a narrow doorless opening is flagged at its full measured width", () => {
  const h = twoRooms(26);
  h.doors[0].kind = "opening";
  const [item] = doorWidths(h.rooms[0], h);
  assert.equal(item.measuredIn, 26); // no door leaf to subtract
  assert.match(item.title, /^Opening between/);
  h.doors[0].widthIn = 40;
  assert.equal(doorWidths(h.rooms[0], h).length, 0);
});

test("mobility: furniture across the hallway blocks a walker", () => {
  const blocked = twoRooms(36, [obj("storage", 168, 72, 48, 40)]);
  const h = home([...blocked.rooms, room("kitchen", "kitchen", rect(192, 0, 100, 144))], [...blocked.doors, door("hallway", "kitchen", 192, 72, 36)]);
  // The cabinet fills the hallway's width right between the two doors.
  assert.equal(planMobility(h, "walker").some((l) => !l.ok && l.cause === "furniture"), true);
  assert.ok(mobilityItems(h, "walker").some((i) => /Move the furniture/.test(i.fix)));
});

test("mobility: a route the scanned walls block is not reported as something to fix", () => {
  const h = twoRooms(36);
  h.doors[0].center = { x: 144, y: 400 }; // the door sits off the wall, so the wall has no gap
  const [leg] = planMobility(h, "walker");
  assert.equal(leg.cause, "walls");
  assert.equal(mobilityItems(h, "walker").length, 0);
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

test("the checks follow how the person gets around", () => {
  const h = twoRooms(30); // about 28 in clear: fine for a walker, narrow for a wheelchair
  h.rooms[0].objects = [obj("bed", 40, 72, 60, 80), obj("storage", 110, 30, 60, 40)];
  const doors = (m: Parameters<typeof ruleItems>[1]) => ruleItems(h, m).filter((i) => i.code === "ADA 404.2.3").length;
  assert.equal(doors("wheelchair"), 1);
  assert.equal(doors("walker"), 0);
  for (const m of ["none", "cane"] as const) {
    const items = ruleItems(h, m);
    assert.ok(!items.some((i) => i.code === "ADA 404.2.3" || i.code === "ADA 304.3" || i.code === "ADA 604.3"), `${m} gets no door, turning, or toilet checks`);
    assert.equal(mobilityItems(h, m).length, 0);
  }
});
