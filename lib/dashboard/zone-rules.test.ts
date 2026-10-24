import assert from "node:assert/strict";
import { test } from "node:test";
import { checkRules, hourLabel, hoursCovered, riskKindFor, toRows } from "./zone-rules";

const kitchenNight = { roomKind: "kitchen" as const, action: "redirect" as const, startHour: 22, endHour: 6 };

test("hours wrap past midnight the way the risk engine reads them", () => {
  assert.deepEqual(hoursCovered({ startHour: 22, endHour: 6 }), [0, 1, 2, 3, 4, 5, 22, 23]);
  assert.deepEqual(hoursCovered({ startHour: 8, endHour: 20 }).length, 12);
  assert.equal(hoursCovered({ startHour: 0, endHour: 24 }).length, 24); // any time
  assert.equal(hourLabel(0), "12 AM");
  assert.equal(hourLabel(13), "1 PM");
});

test("a sensible set of rules passes", () => {
  assert.equal(checkRules([kitchenNight, { roomKind: "front-door", action: "redirect", startHour: 0, endHour: 24 }, { roomKind: "living", action: "greet", startHour: 8, endHour: 20 }]), null);
  assert.equal(checkRules([kitchenNight, { roomKind: "kitchen", action: "greet", startHour: 8, endHour: 20 }]), null); // same room, different hours
});

test("problems come back in plain words", () => {
  assert.match(checkRules([])!, /at least one rule/);
  assert.match(checkRules([{ ...kitchenNight, roomKind: "garage" }])!, /Pick a room/);
  assert.match(checkRules([{ ...kitchenNight, action: "shout" }])!, /what Lantern does in the kitchen/);
  assert.match(checkRules([{ ...kitchenNight, startHour: 25 }])!, /Check the hours/);
  assert.match(checkRules([kitchenNight, { roomKind: "kitchen", action: "allow", startHour: 4, endHour: 8 }])!, /Two kitchen rules both cover 4 AM/);
});

test("a redirect gets its risk kind: the front door is urgent, any other room a night redirect", () => {
  assert.equal(riskKindFor("front-door"), "exit-approach");
  assert.equal(riskKindFor("hallway"), "kitchen-night");
  assert.deepEqual(toRows("h1", [kitchenNight, { roomKind: "bathroom", action: "allow", startHour: 22, endHour: 6 }]), [
    { household_id: "h1", room_kind: "kitchen", kind: "kitchen-night", start_hour: 22, end_hour: 6, action: "redirect" },
    { household_id: "h1", room_kind: "bathroom", kind: null, start_hour: 22, end_hour: 6, action: "allow" },
  ]);
});
