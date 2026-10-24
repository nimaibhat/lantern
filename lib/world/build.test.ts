import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { HomeModel } from "@/lib/types";
import { auditHome, largestClearCircle } from "@/lib/audit/ada";
import { buildHomeModel, centreOf, kindFor, normalize, rotateRooms, slug } from "./build";
import { adjacency, bounds, distance, distanceToSegment, edges, roomAt, sharedEdge } from "./geometry";
import { wallPieces } from "./walls";
import { parseCapturedRoom } from "./parse";
import { colMajor, ftIn, metersToInches, toFloor } from "./units";

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

test("build: a scan turned by any angle is squared up and measures exactly the same", () => {
  const rooms = [scan("captured-room-bedroom.json", "Bedroom"), scan("captured-room-hallway.json", "Hallway")];
  const base = buildHomeModel(rooms, { householdId: "h1" });
  const size = (h: HomeModel) => h.rooms.map((r) => { const b = bounds(r.polygon); return [b.width, b.height].sort((p, q) => p - q); });
  const findings = (h: HomeModel) => auditHome(h).map((i) => `${i.title}: ${i.measuredIn}`).sort();
  const turning = (h: HomeModel) => h.rooms.map((r) => largestClearCircle(r).diameter);

  for (const deg of [23, -37, 61, 90, 135, 200]) {
    const turned = buildHomeModel(rotateRooms(rooms, (-deg * Math.PI) / 180), { householdId: "h1" }); // rotateRooms turns by -angle
    for (const r of turned.rooms) {
      for (const [a, b] of edges(r.polygon)) {
        const along = Math.abs(a.x - b.x) < 0.2 || Math.abs(a.y - b.y) < 0.2;
        assert.ok(along, `${deg} deg: ${r.id} has a wall that is not square to the plan`);
      }
    }
    size(turned).forEach((dims, i) => dims.forEach((d, j) => assert.ok(Math.abs(d - size(base)[i][j]) < 0.3, `${deg} deg: room size changed`)));
    assert.deepEqual(turned.doors.map((d) => d.widthIn), base.doors.map((d) => d.widthIn));
    assert.deepEqual(findings(turned), findings(base), `${deg} deg: audit measurements changed`);
    turning(turned).forEach((d, i) => assert.ok(Math.abs(d - turning(base)[i]) < 0.6, `${deg} deg: turning circle changed`));
  }
});

test("feet and inches never print 12 inches", () => {
  assert.equal(ftIn(143.7), "12′");
  assert.equal(ftIn(141.7), "11′10″");
  assert.equal(ftIn(30), "2′6″");
  assert.equal(ftIn(11.6), "1′");
  assert.equal(ftIn(5.2), "5″");
});

test("slug and kind", () => {
  assert.equal(slug("TV room"), "tv-room");
  assert.equal(slug("  Front Door! "), "front-door");
  assert.equal(kindFor("Master Bedroom"), "bedroom");
  assert.equal(kindFor("Front door"), "front-door");
  assert.equal(kindFor("Den"), "tv-room");
});

test("normalize: turnDeg turns the plan clockwise to match a paper floor plan", () => {
  const rooms = [scan("captured-room-bedroom.json", "Bedroom"), scan("captured-room-hallway.json", "Hallway")];
  const box = (rs: ReturnType<typeof normalize>) => bounds(rs.flatMap((r) => r.polygon));
  const flat = box(normalize(rooms)), turned = box(normalize(rooms, 90));
  assert.ok(Math.abs(turned.width - flat.height) < 0.5 && Math.abs(turned.height - flat.width) < 0.5);
  // Clockwise on a y-down plan: the bedroom's centre moves from (x, y) towards (H - y, x).
  const c = (rs: ReturnType<typeof normalize>) => bounds(rs[0].polygon).center;
  const a = c(normalize(rooms)), b = c(normalize(rooms, 90));
  assert.ok(Math.abs(b.x - (flat.height - a.y)) < 0.5 && Math.abs(b.y - a.x) < 0.5);
});

test("a T shaped room's centre is inside it, and a hall closet is not a hallway", () => {
  const t = [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 40 }, { x: 170, y: 40 }, { x: 170, y: 300 }, { x: 130, y: 300 }, { x: 130, y: 40 }, { x: 0, y: 40 }];
  const c = centreOf(t);
  assert.ok(c.x > 130 && c.x < 170 || c.y < 40);
  assert.equal(kindFor("Hall closet"), "other");
  assert.equal(kindFor("Hallway"), "hallway");
});

test("open-plan rooms are joined by an opening as wide as their shared edge, and the wall there is gone", () => {
  const rooms = [scan("captured-room-bedroom.json", "Bedroom"), scan("captured-room-hallway.json", "Hallway")];
  const base = buildHomeModel(rooms, { householdId: "h1" });
  const [a, b] = base.rooms;
  const shared = sharedEdge(a.polygon, b.polygon);
  assert.ok(shared, "the fixture rooms share a wall");
  const open = buildHomeModel(rooms, { householdId: "h1", open: [["Bedroom", "Hallway"]] });
  const joint = open.doors.find((d) => d.id.endsWith("|open"))!;
  assert.equal(joint.kind, "opening");
  assert.equal(joint.widthIn, Math.round(distance(shared![0], shared![1])));
  const mid = { x: (shared![0].x + shared![1].x) / 2, y: (shared![0].y + shared![1].y) / 2 };
  const near = (h: HomeModel) => wallPieces(h).filter(([p, q]) => distanceToSegment(mid, p, q) < 2).length;
  assert.ok(near(base) > 0 && near(open) === 0);
});
