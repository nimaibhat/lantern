import assert from "node:assert/strict";
import { test } from "node:test";
import { roomNamed } from "./names";

const rooms = ["Bedroom 1", "Bedroom 2", "Back hallway", "Hallway", "Hall closet", "Kitchen", "Living room", "Entrance"].map((name) => ({
  id: name.toLowerCase().replace(/ /g, "-"),
  name,
}));
const named = (name: string) => roomNamed(rooms, name)?.id;

test("a device named after a room stands in it", () => {
  assert.equal(named("Kitchen"), "kitchen");
  assert.equal(named("living-room"), "living-room");
  assert.equal(named("Bedroom 2"), "bedroom-2");
});

test("a room named inside a longer device name still counts", () => {
  assert.equal(named("Kitchen laptop"), "kitchen");
  assert.equal(named("esp32-entrance"), "entrance");
  assert.equal(named("Back hallway device"), "back-hallway", "the longer room, not the hallway inside it");
  assert.equal(named("Hall closet laptop"), "hall-closet");
});

test("a name that fits no room, or more than one, is left for the caregiver to place", () => {
  assert.equal(named("Saran Bedroom"), undefined, "which bedroom is a guess");
  assert.equal(named("Mom's room"), undefined);
  assert.equal(named("Kitchen and hallway"), undefined);
  assert.equal(named(""), undefined);
});
