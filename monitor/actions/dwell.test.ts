import assert from "node:assert/strict";
import { test } from "node:test";
import type { RoomKind } from "@/lib/types";
import { createDwell } from "./dwell";

const MIN = 60_000;
const at = (local: string) => Date.parse(`2026-01-15T${local}:00-05:00`); // New York

function setup(start: string, quiet = true) {
  let clock = at(start);
  const dwell = createDwell({ timeZone: "America/New_York", quiet: () => quiet, roomKind: (id) => id as RoomKind, now: () => clock });
  return { dwell, go: (ms: number) => (clock += ms), set: (ts: number) => (clock = ts) };
}

test("time in the current room and out of bed at night", () => {
  const s = setup("03:00");
  s.dwell.onLocation("bedroom");
  s.go(5 * MIN);
  s.dwell.onLocation("hallway");
  s.go(2 * MIN);
  s.dwell.onLocation("kitchen");
  s.go(3 * MIN);
  assert.deepEqual(s.dwell.state(), { roomId: "kitchen", inRoomS: 180, outOfBedS: 300, todayS: { bedroom: 300, hallway: 120, kitchen: 180 } });
  s.dwell.onLocation("bedroom");
  assert.equal(s.dwell.state().outOfBedS, undefined, "back in bed clears it");
});

test("out of bed is only reported during quiet hours", () => {
  const s = setup("14:00", false);
  s.dwell.onLocation("kitchen");
  s.go(MIN);
  assert.equal(s.dwell.state().outOfBedS, undefined);
});

test("a repeated location for the same room keeps the time in the room", () => {
  const s = setup("03:00");
  s.dwell.onLocation("kitchen");
  s.go(2 * MIN);
  s.dwell.onLocation("kitchen");
  s.go(MIN);
  assert.equal(s.dwell.state().inRoomS, 180);
});

test("a new day starts the totals again", () => {
  const s = setup("23:50");
  s.dwell.onLocation("tv-room");
  s.go(5 * MIN);
  assert.equal(s.dwell.state().todayS["tv-room"], 300);
  s.set(at("23:59") + 2 * MIN); // 00:01 the next day
  assert.deepEqual(s.dwell.state().todayS, { "tv-room": 0 });
});
