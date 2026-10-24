import assert from "node:assert/strict";
import { test } from "node:test";
import { roomsFromStructure, structurePath } from "./structure";

const room = (id: string, x: number) => ({ identifier: id, walls: [{ transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 0, 0, 1], dimensions: [1, 2.4, 0] }] });

test("structure rooms are matched to the upload order by identifier", () => {
  const perRoom = [room("A", 0), room("B", 0)];
  const structure = { rooms: [room("B", 5), room("A", 1)] };
  const rooms = roomsFromStructure(structure, perRoom)!;
  assert.deepEqual(rooms.map((r) => r.identifier), ["A", "B"]);
  assert.equal(rooms[1].walls[0].transform[12], 5); // the merged, aligned position wins
});

test("unmatched ids fall back to structure order only when the counts agree", () => {
  assert.deepEqual(roomsFromStructure({ rooms: [room("X", 0), room("Y", 0)] }, [room("A", 0), room("B", 0)])!.map((r) => r.identifier), ["X", "Y"]);
  assert.equal(roomsFromStructure({ rooms: [room("X", 0)] }, [room("A", 0), room("B", 0)]), undefined);
  assert.equal(roomsFromStructure({}, [room("A", 0)]), undefined);
});

test("rooms without identifiers keep the structure order instead of all matching one room", () => {
  const bare = (x: number) => ({ walls: room("", x).walls });
  const rooms = roomsFromStructure({ rooms: [bare(1), bare(2), bare(3)] }, [bare(0), bare(0), bare(0)])!;
  assert.deepEqual(rooms.map((r) => r.walls[0].transform[12]), [1, 2, 3]);
});

test("structure path", () => {
  assert.equal(structurePath("h1", "s1"), "h1/s1/structure.json");
});
