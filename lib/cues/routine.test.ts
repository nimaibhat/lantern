import assert from "node:assert/strict";
import { test } from "node:test";
import type { RoutineStep } from "@/lib/types";
import { PROMPT_EVERY_MS, PROMPT_MAX, currentStep, duePrompt, friendlyTime, logDone, logPrompt, nextStep, type PromptLog } from "./routine";
import { calmSpeech, pickCalmVoice } from "./voice";

const step = (id: string, time: string, roomId?: string): RoutineStep => ({ id, routineId: "r", order: 0, time, title: id, roomId });
const steps = [step("lunch", "12:30", "kitchen"), step("wake", "07:00", "bedroom"), step("rest", "15:00", "bedroom")];
const MIN = 60_000;

test("current and next steps follow the clock, whatever order they were saved in", () => {
  assert.equal(currentStep(steps, "06:59"), undefined);
  assert.equal(currentStep(steps, "12:45")?.id, "lunch");
  assert.equal(nextStep(steps, "12:45")?.id, "rest");
});

test("a step is said at its time, again every 5 minutes, at most 3 times", () => {
  let log: PromptLog = {};
  let t = 0;
  assert.equal(duePrompt(steps, "12:30", t, log)?.id, "lunch");
  log = logPrompt(log, "lunch", t);
  assert.equal(duePrompt(steps, "12:31", t + MIN, log), undefined);
  for (let i = 1; i < PROMPT_MAX; i++) {
    t += PROMPT_EVERY_MS;
    assert.equal(duePrompt(steps, "12:40", t, log)?.id, "lunch");
    log = logPrompt(log, "lunch", t);
  }
  assert.equal(duePrompt(steps, "12:50", t + PROMPT_EVERY_MS, log), undefined, "three is enough");
});

test("no prompt once they are in the room, after Done, or for an old step", () => {
  assert.equal(duePrompt(steps, "12:30", 0, {}, "kitchen"), undefined);
  assert.equal(duePrompt(steps, "12:30", 0, logDone({}, "lunch")), undefined);
  assert.equal(duePrompt(steps, "13:31", 0, {}), undefined);
});

test("the calmest English voice the browser has", () => {
  const voices = [{ name: "Fred", lang: "en-US" }, { name: "Thomas", lang: "fr-FR" }, { name: "Samantha", lang: "en-US" }];
  assert.equal(pickCalmVoice(voices)?.name, "Samantha");
  assert.equal(pickCalmVoice([{ name: "Fred", lang: "en_US" }])?.name, "Fred");
  assert.equal(pickCalmVoice([{ name: "Thomas", lang: "fr-FR" }]), undefined);
  assert.deepEqual(calmSpeech(true), { rate: 0.85, pitch: 0.95, volume: 0.7 });
});

test("friendly times", () => {
  assert.equal(friendlyTime("15:00"), "3:00 PM");
  assert.equal(friendlyTime("00:05"), "12:05 AM");
  assert.equal(friendlyTime("12:30"), "12:30 PM");
  assert.equal(friendlyTime("bad"), "bad");
});
