import assert from "node:assert/strict";
import { test } from "node:test";
import type { RiskEvent } from "@/lib/types";
import { createOutcomeLog, nightSummary, summarize } from "./analytics";

const risk = (id: string, patch: Partial<RiskEvent>): RiskEvent => ({
  id, householdId: "h1", kind: "kitchen-night", roomId: "kitchen", trigger: "detected", state: "detected", source: "ble",
  startedAt: "2026-10-23T07:07:00.000Z", ...patch,
});

test("outcomes: a redirect that worked, one that escalated, and a prediction that never came", () => {
  const log = createOutcomeLog();
  log.onRisk(risk("a", {}));
  log.onRisk(risk("a", { state: "redirecting" }));
  log.onRisk(risk("a", { state: "resolved", resolvedAt: "2026-10-23T07:07:48.000Z" })); // back in 48 s

  log.onRisk(risk("b", { kind: "exit-approach", roomId: "front-door" }));
  log.onRisk(risk("b", { kind: "exit-approach", roomId: "front-door", state: "escalated" }));
  log.onRisk(risk("b", { kind: "exit-approach", roomId: "front-door", state: "resolved", resolvedAt: "2026-10-23T07:09:00.000Z" }));

  log.onRisk(risk("c", { trigger: "predicted", predictedAt: "2026-10-23T07:20:00.000Z" }));
  log.onRisk(risk("c", { trigger: "predicted", state: "resolved", resolvedAt: "2026-10-23T07:21:00.000Z" })); // never arrived

  log.onRisk(risk("d", { trigger: "predicted" }));
  log.onRisk(risk("d", { trigger: "predicted", arrivedAt: "2026-10-23T07:30:12.000Z", leadTimeS: 12 }));

  const s = summarize(log.list());
  assert.equal(s.responses, 3); // a, b and d happened; c was only a prediction
  assert.equal(s.workedWithoutMessage, 1);
  assert.equal(s.escalated, 1);
  assert.equal(s.falseRedirects, 1);
  assert.equal(s.medianReturnS, 48);
  assert.deepEqual(s.leadTimesS, [12]);
  assert.equal(s.open, 1);
  assert.equal(s.recent[0].id, "d");
});

test("which reminder worked, and last night in one paragraph", () => {
  const log = createOutcomeLog();
  log.onRisk(risk("a", { cues: 1 }));
  log.onRisk(risk("a", { state: "resolved", resolvedAt: "2026-10-23T07:08:00.000Z" }));
  log.onRisk(risk("b", { kind: "night-wandering", roomId: "hallway", startedAt: "2026-10-23T09:22:00.000Z" }));
  log.onRisk(risk("b", { kind: "night-wandering", roomId: "hallway", startedAt: "2026-10-23T09:22:00.000Z", cues: 3, state: "escalated" }));
  log.onRisk(risk("b", { kind: "night-wandering", roomId: "hallway", startedAt: "2026-10-23T09:22:00.000Z", state: "resolved", resolvedAt: "2026-10-23T09:40:00.000Z" }));

  assert.deepEqual(summarize(log.list()).workedAfterCue, { 1: 1 });
  const clock = (iso: string) => new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(Date.parse(iso));
  assert.equal(
    nightSummary(log.list(), "Rosa", () => true, clock),
    "Rosa was up twice last night. 3:07 AM, kitchen: back after 1 reminder; 5:22 AM, up and about: family was texted.",
  );
  assert.equal(nightSummary([], "Rosa", () => true, clock), "Quiet night. Rosa did not need any reminders.");
});
