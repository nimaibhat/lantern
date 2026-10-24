import { BATHROOM_STAY_MS, NIGHT_WANDER_MS, NO_MOVEMENT_MS, PREDICTION_WINDOW_MS, createRiskEngine, isQuiet, localMinutes, within } from "./risk";

test("DEMO_HOUR pins the hour so an afternoon demo is treated as night", () => {
  const afternoon = Date.parse("2026-10-23T19:07:00Z"); // 3:07 PM in New York
  assert.equal(localMinutes(afternoon, "America/New_York", ""), 15 * 60 + 7);
  assert.equal(localMinutes(afternoon, "America/New_York", "3"), 3 * 60 + 7);
  assert.equal(localMinutes(afternoon, "America/New_York", "99"), 15 * 60 + 7); // out of range is ignored
});
