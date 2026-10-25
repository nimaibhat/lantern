import assert from "node:assert/strict";
import { test } from "node:test";
import type { HomeRoom } from "@/lib/types";
import { roomForLaptop } from "./closest";

const room = (id: string, name: string) => ({ id, name, kind: "other", centroid: { x: 0, y: 0 } }) as unknown as HomeRoom;
const rooms = [room("bedroom-2", "Bedroom 2"), room("living-room", "Living room"), room("hallway", "Hallway")];

test("a placed laptop uses its room; otherwise its name finds the room", () => {
  assert.equal(roomForLaptop(rooms, "hallway", "Anything")?.id, "hallway");
  assert.equal(roomForLaptop(rooms, undefined, "Bedroom 2")?.id, "bedroom-2");
  assert.equal(roomForLaptop(rooms, "", " living room ")?.id, "living-room");
  assert.equal(roomForLaptop(rooms, "garage", "Garage"), undefined);
});
