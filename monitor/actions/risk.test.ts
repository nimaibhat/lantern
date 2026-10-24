import assert from "node:assert/strict";
import { test } from "node:test";
import type { LocationEvent, RiskEvent, RoomKind, ZoneRule } from "@/lib/types";
import { loadConfig } from "../config";
import { rules } from "./index";
import { ruleFromRow } from "./settings";
import { startMonitor } from "../server";
import { BATHROOM_STAY_MS, NIGHT_WANDER_MS, NO_MOVEMENT_MS, PREDICTION_WINDOW_MS, createRiskEngine, isQuiet, localMinutes, ruleFor, within } from "./risk";

// A winter day in New York (UTC-5), so "03:00" below is 3 AM household time.
const at = (hhmm: string) => Date.parse(`2026-01-15T${hhmm}:00-05:00`);
const MIN = 60_000;

const RULES: ZoneRule[] = [
  { id: "z1", householdId: "h1", roomKind: "front-door", kind: "exit-approach", startHour: 0, endHour: 24, action: "redirect" },
  { id: "z2", householdId: "h1", roomKind: "kitchen", kind: "kitchen-night", startHour: 22, endHour: 6, action: "redirect" },
  { id: "z3", householdId: "h1", roomKind: "bathroom", startHour: 22, endHour: 6, action: "allow" },
  { id: "z4", householdId: "h1", roomKind: "tv-room", startHour: 8, endHour: 20, action: "greet" },
];

// Room ids in the fixture equal their kinds.
function setup(start: string) {
  let clock = at(start);
  let ids = 0;
  const risks: RiskEvent[] = [];
  const engine = createRiskEngine({
    householdId: "h1",
    household: { quietHoursStart: "21:00", quietHoursEnd: "07:00", timezone: "America/New_York" },
    rules: RULES,
    roomKind: (id) => id as RoomKind,
    emit: (r) => risks.push(r),
    now: () => clock,
    newId: () => `k${++ids}`,
  });
  const enter = (roomId: string, ts = clock): void => {
    clock = ts;
    const e: LocationEvent = { id: "l", householdId: "h1", roomId, confidence: 1, source: "sim", ts: new Date(ts).toISOString() };
    engine.onLocation(e);
  };
  const advance = (ms: number) => {
    clock += ms;
    engine.tick();
  };
  return { engine, risks, enter, advance, now: () => clock };
}

test("within wraps past midnight", () => {
  assert.equal(within(23 * 60, 22 * 60, 6 * 60), true);
  assert.equal(within(3 * 60, 22 * 60, 6 * 60), true);
  assert.equal(within(12 * 60, 22 * 60, 6 * 60), false);
  assert.equal(within(12 * 60, 0, 24 * 60), true);
});

test("quiet hours follow the household timezone", () => {
  const h = { quietHoursStart: "21:00", quietHoursEnd: "07:00", timezone: "America/New_York" };
  assert.equal(isQuiet(at("03:00"), h), true);
  assert.equal(isQuiet(at("12:00"), h), false);
});

test("kitchen at 3 AM raises kitchen-night", () => {
  const s = setup("03:00");
  s.enter("hallway");
  s.enter("kitchen");
  assert.deepEqual(s.risks.map((r) => [r.kind, r.roomId, r.state, r.trigger]), [["kitchen-night", "kitchen", "detected", "detected"]]);
});

test("a risk carries when they left the bedroom, for the grace period", () => {
  const s = setup("03:00");
  s.enter("bedroom");
  s.advance(2 * MIN);
  s.enter("hallway");
  const leftBed = s.now();
  s.advance(MIN);
  s.enter("kitchen");
  assert.equal(s.risks[0].upSince, new Date(leftBed).toISOString());
});

test("kitchen at noon raises nothing", () => {
  const s = setup("12:00");
  s.enter("kitchen");
  assert.equal(s.risks.length, 0);
});

test("a bathroom trip at night raises nothing", () => {
  const s = setup("03:00");
  s.enter("bedroom");
  s.enter("bathroom");
  s.advance(5 * MIN);
  s.enter("bedroom");
  assert.equal(s.risks.length, 0);
});

test("the front door raises exit-approach at any time", () => {
  const s = setup("14:00");
  s.enter("front-door");
  assert.equal(s.risks[0]?.kind, "exit-approach");
});

test("the TV room greets instead of raising a risk", () => {
  const s = setup("10:00");
  s.enter("tv-room");
  assert.equal(s.risks.length, 0);
});

test("the monitor greets in a living room as well as a TV room, and the entrance is a front door", () => {
  const rule = (kind: RoomKind) => ruleFor(rules("h1"), kind, at("10:00"), "America/New_York");
  assert.equal(rule("living")?.action, "greet");
  assert.equal(rule("tv-room")?.action, "greet");
  assert.equal(rule("front-door")?.kind, "exit-approach");
});

test("re-entering while a risk is open does not duplicate it; after it resolves it can fire again", () => {
  const s = setup("03:00");
  s.enter("kitchen");
  s.enter("hallway");
  s.enter("kitchen");
  assert.equal(s.risks.length, 1);
  s.engine.track({ ...s.risks[0], state: "resolved" });
  s.enter("hallway");
  s.enter("kitchen");
  assert.equal(s.risks.length, 2);
});

test("night-wandering after 10 minutes out of bed in quiet hours", () => {
  const s = setup("02:00");
  s.enter("bedroom");
  s.enter("hallway", at("03:00"));
  s.advance(NIGHT_WANDER_MS - MIN);
  assert.equal(s.risks.length, 0);
  s.advance(MIN);
  assert.deepEqual(s.risks.map((r) => [r.kind, r.roomId]), [["night-wandering", "hallway"]]);
});

test("no night-wandering while in the bathroom", () => {
  const s = setup("03:00");
  s.enter("bedroom");
  s.enter("bathroom");
  s.advance(NIGHT_WANDER_MS + MIN);
  assert.equal(s.risks.length, 0);
});

test("long-bathroom-stay after 30 minutes", () => {
  const s = setup("14:00");
  s.enter("bathroom");
  s.advance(BATHROOM_STAY_MS - MIN);
  assert.equal(s.risks.length, 0);
  s.advance(MIN);
  assert.equal(s.risks[0]?.kind, "long-bathroom-stay");
});

test("no-movement after 2 hours in the daytime, not at night", () => {
  const day = setup("09:00");
  day.enter("tv-room");
  day.advance(NO_MOVEMENT_MS);
  assert.equal(day.risks[0]?.kind, "no-movement");

  const night = setup("22:00");
  night.enter("bedroom");
  night.advance(NO_MOVEMENT_MS);
  assert.equal(night.risks.length, 0);
});

test("an old event timestamp does not count as hours without moving", () => {
  const s = setup("12:00");
  s.engine.onLocation({ id: "l", householdId: "h1", roomId: "tv-room", confidence: 1, source: "sim", ts: "2025-06-01T12:00:00Z" });
  s.advance(15_000);
  assert.equal(s.risks.length, 0);
});

test("a confident prediction raises a predicted risk, and arriving records the lead time", () => {
  const s = setup("03:00");
  s.enter("hallway");
  s.engine.onPrediction({ ts: s.now(), fromRoomId: "hallway", nextRoomId: "kitchen", probability: 0.7 });
  assert.deepEqual(s.risks.map((r) => [r.kind, r.trigger]), [["kitchen-night", "predicted"]]);

  s.enter("kitchen", s.now() + 20_000);
  assert.equal(s.risks.length, 2, "arrival updates the same risk instead of raising a new one");
  assert.equal(s.risks[1].id, s.risks[0].id);
  assert.equal(s.risks[1].leadTimeS, 20);
  assert.ok(s.risks[1].arrivedAt);
});

test("a prediction that never arrives is cancelled after 60 s as a false redirect", () => {
  const s = setup("03:00");
  s.enter("hallway");
  s.engine.onPrediction({ ts: s.now(), fromRoomId: "hallway", nextRoomId: "kitchen", probability: 0.8 });
  s.advance(PREDICTION_WINDOW_MS);
  const last = s.risks.at(-1)!;
  assert.deepEqual([last.state, last.trigger, last.arrivedAt], ["resolved", "predicted", undefined]);
});

test("a weak prediction raises nothing", () => {
  const s = setup("03:00");
  s.enter("hallway");
  s.engine.onPrediction({ ts: s.now(), fromRoomId: "hallway", nextRoomId: "kitchen", probability: 0.5 });
  assert.equal(s.risks.length, 0);
});

test("through the monitor: /debug/emit of a 3 AM kitchen location puts a risk on the bus", async () => {
  const monitor = await startMonitor({ ...loadConfig({}), port: 0, debug: true });
  try {
    const risks: RiskEvent[] = [];
    monitor.bus.on("risk", (r) => risks.push(r));
    const payload = { id: "l1", householdId: "h1", roomId: "kitchen", confidence: 1, source: "sim", ts: new Date(at("03:00")).toISOString() };
    const res = await fetch(`http://localhost:${monitor.port}/debug/emit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event: "location", payload }),
    });
    assert.equal(res.status, 200);
    // First event per risk: the responder follows up on the same id (its grace period) before any cue.
    const raised = risks.filter((r, i) => risks.findIndex((x) => x.id === r.id) === i);
    assert.deepEqual(raised.map((r) => [r.kind, r.roomId, r.state, r.source]), [["kitchen-night", "kitchen", "detected", "sim"]]);
  } finally {
    await monitor.close();
  }
});

test("DEMO_HOUR pins the hour so an afternoon demo is treated as night", () => {
  const afternoon = Date.parse("2026-10-23T19:07:00Z"); // 3:07 PM in New York
  assert.equal(localMinutes(afternoon, "America/New_York", ""), 15 * 60 + 7);
  assert.equal(localMinutes(afternoon, "America/New_York", "3"), 3 * 60 + 7);
  assert.equal(localMinutes(afternoon, "America/New_York", "99"), 15 * 60 + 7); // out of range is ignored
});

test("zone rules saved in Supabase read back as the monitor's rules", () => {
  const rule = ruleFromRow({ id: "h1-living-greet", household_id: "h1", room_kind: "living", kind: null, start_hour: 8, end_hour: 20, action: "greet" });
  assert.deepEqual(rule, { id: "h1-living-greet", householdId: "h1", roomKind: "living", startHour: 8, endHour: 20, action: "greet" });
  assert.equal(ruleFromRow({ id: "k", household_id: "h1", room_kind: "kitchen", kind: "kitchen-night", start_hour: 22, end_hour: 6, action: "redirect" }).kind, "kitchen-night");
});
