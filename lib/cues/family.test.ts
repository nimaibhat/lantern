import assert from "node:assert/strict";
import { test } from "node:test";
import { alertText, allClearText, backupText, callScript, handoffText, movedOnText, situation, type FamilyFacts } from "./family";

const night: FamilyFacts = { name: "Patient", kind: "kitchen-night", room: "Kitchen", since: "3:04 AM", reminders: 3 };

test("the text says what happened, what Lantern did, and one next step", () => {
  assert.equal(
    alertText(night, "http://x/ack/a1"),
    "Lantern: Patient has been up since 3:04 AM and is in the kitchen. Lantern played 3 gentle reminders and Patient has not gone back to bed yet. Could you check on Patient? Tap when you are on it: http://x/ack/a1",
  );
});

test("each kind has its own plain sentence, with no pronouns", () => {
  assert.equal(situation({ ...night, reminders: 1 }), "Patient has been up since 3:04 AM and is in the kitchen. Lantern played 1 gentle reminder and Patient has not gone back to bed yet.");
  assert.equal(situation({ ...night, kind: "exit-approach", room: "Front door" }), "Patient is at the front door (3:04 AM). A gentle reminder is playing.");
  assert.equal(situation({ ...night, kind: "long-bathroom-stay" }), "Patient has been in the bathroom since 3:04 AM.");
  assert.equal(situation({ ...night, kind: "no-movement", room: "TV room" }), "Patient has not moved from the TV room since 3:04 AM.");
  for (const kind of ["kitchen-night", "night-wandering", "exit-approach", "long-bathroom-stay", "no-movement"] as const) {
    assert.doesNotMatch(alertText({ ...night, kind }, "u"), /\b(she|her|he|him|his)\b/i);
  }
});

test("the front door asks for a check now", () => {
  assert.match(alertText({ ...night, kind: "exit-approach" }, "u"), /Please check on Patient now\./);
});

test("backup, call, all clear and handoff wording", () => {
  assert.match(backupText(night, "u"), /The first contact has not been able to check\./);
  assert.match(callScript(night), /^This is Lantern\. Patient has been up since 3:04 AM/);
  assert.equal(allClearText("Patient", "Bedroom", "3:12 AM"), "Lantern update: Patient is back in the bedroom (3:12 AM). No need to check.");
  assert.equal(handoffText("Patient", "Caregiver"), "Lantern update: Caregiver is checking on Patient now. No need to go.");
});

test("moving on without settling does not say no need to check", () => {
  assert.equal(movedOnText("Patient", "Kitchen", "TV room", "3:12 AM"), "Lantern update: Patient has left the kitchen and is in the TV room now (3:12 AM). Lantern is still watching.");
});
