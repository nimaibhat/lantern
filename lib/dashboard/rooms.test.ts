import assert from "node:assert/strict";
import { test } from "node:test";
import type { Room } from "@/lib/types";
import { resolveRoomId, roomName } from "./rooms";

const rooms = [
  { id: "bedroom", name: "Bedroom" },
  { id: "living", name: "Living room" },
  { id: "entry", name: "Front door" },
] as Room[];

test("live home-model ids find the scanned room", () => {
  assert.equal(resolveRoomId(rooms, "bedroom"), "bedroom");
  assert.equal(resolveRoomId(rooms, "tv-room"), "living"); // alias
  assert.equal(resolveRoomId(rooms, "front-door"), "entry"); // same name, different id
  assert.equal(roomName(rooms, "tv-room"), "Living room");
});

test("a room the scan does not have keeps a readable name", () => {
  assert.equal(resolveRoomId(rooms, "garage"), "garage");
  assert.equal(roomName(rooms, "garage"), "Garage");
  assert.equal(roomName(rooms, undefined), "Unknown");
});
