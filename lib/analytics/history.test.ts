import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { destination, kitchenAtNight, roomByHour, tripsByWeek, type Walk } from "./history";

const walk = (day: number, kind: Walk["kind"], steps: [string, number, number][]): Walk => ({
  id: `w${day}${kind}${steps.length}`, day, kind, steps: steps.map(([room, hour, dwellS]) => ({ room, hour, dwellS })),
});

test("a night trip goes where they stayed longest, not the bedroom or hallway", () => {
  assert.equal(destination(walk(0, "night", [["bedroom", 3, 30], ["hallway", 3.01, 10], ["kitchen", 3.02, 200], ["hallway", 3.1, 10]])), "kitchen");
  assert.equal(destination(walk(0, "night", [["bedroom", 3, 30], ["hallway", 3.01, 10], ["bedroom", 3.02, 30]])), "other"); // turned back
});

test("trips by week and the kitchen-at-night comparison", () => {
  const walks = [
    walk(1, "night", [["bedroom", 3, 30], ["bathroom", 3.1, 200]]),
    walk(20, "night", [["bedroom", 3, 30], ["kitchen", 3.1, 200]]),
    walk(25, "night", [["bedroom", 2, 30], ["kitchen", 2.1, 200]]),
    walk(27, "night", [["bedroom", 22, 30], ["kitchen", 22.1, 200]]), // 10 PM: not a small-hours trip
    walk(27, "day", [["kitchen", 8, 600]]),
  ];
  const weeks = tripsByWeek(walks);
  assert.deepEqual(weeks.map((w) => [w.kitchen, w.bathroom, w.total]), [[0, 1, 1], [0, 0, 0], [1, 0, 1], [2, 0, 2]]);
  assert.deepEqual(kitchenAtNight(walks), { recent: 2, baseline: 0, ratio: Infinity, days: 14 });
});

test("room by hour splits a stay across the hours it covers", () => {
  const { rooms, minutes } = roomByHour([walk(0, "day", [["kitchen", 7.5, 3600]])]);
  const k = rooms.indexOf("kitchen");
  assert.equal(Math.round(minutes[k][7]), 30);
  assert.equal(Math.round(minutes[k][8]), 30);
});

test("the demo history shows the rising 3 AM kitchen trend", () => {
  const { walks } = JSON.parse(readFileSync("fixtures/walks.json", "utf8")) as { walks: Walk[] };
  const k = kitchenAtNight(walks);
  assert.ok(k.recent >= 3 * k.baseline, `recent ${k.recent} vs baseline ${k.baseline}`);
});
