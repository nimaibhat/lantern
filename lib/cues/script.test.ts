import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { HomeModel } from "@/lib/types";
import { cleanNote, closingLine, cueScript, greetingLine, inSentence, routinePrompt } from "./script";

// Fixture rooms: bedroom, bathroom, kitchen, tv-room and front-door, each one door off the hallway.
const home = JSON.parse(readFileSync("fixtures/home-model.json", "utf8")) as HomeModel;
const cue = (kind: Parameters<typeof cueScript>[0]["kind"], roomId: string, extra: { confident?: boolean; night?: boolean } = {}) =>
  cueScript({ kind, name: "Patient", home, roomId, confident: extra.confident ?? true, night: extra.night ?? true });

test("back to bed at night: the one line, with the way back through the scan's doors shown only", () => {
  assert.deepEqual(cue("kitchen-night", "kitchen"), {
    message: "Patient, please go to your bedroom and sleep.",
    route: ["Kitchen", "Hallway", "Bedroom"],
  });
  assert.deepEqual(cue("night-wandering", "hallway"), { message: "Patient, please go to your bedroom and sleep.", route: ["Hallway", "Bedroom"] });
});

test("one door away says next door", () => {
  assert.equal(cue("exit-approach", "hallway").detail, "You're in the hallway. Your bed is just next door.");
  assert.deepEqual(cue("exit-approach", "hallway").route, ["Hallway", "Bedroom"]);
});

test("an unsure room says the message only, never a wrong room", () => {
  assert.deepEqual(cue("kitchen-night", "kitchen", { confident: false }), { message: "Patient, please go to your bedroom and sleep.", route: [] });
  assert.deepEqual(cue("kitchen-night", "garage"), { message: "Patient, please go to your bedroom and sleep.", route: [] });
});

test("the front door leads to the bedroom at night and the TV room by day", () => {
  assert.equal(cue("exit-approach", "front-door").detail, "You're at the front door. Your bed is back through the hallway.");
  assert.equal(cue("exit-approach", "front-door", { night: false }).detail, "You're at the front door. The TV room is through the hallway.");
});

test("a long bathroom stay checks in without directions", () => {
  assert.deepEqual(cue("long-bathroom-stay", "bathroom"), { message: "Patient, are you all right?", detail: "Take your time.", route: [] });
});

test("no movement suggests water in the kitchen", () => {
  const s = cue("no-movement", "bedroom", { night: false });
  assert.equal(s.message, "Patient, how about a glass of water?");
  assert.equal(s.detail, "You're in the bedroom. The kitchen is through the hallway.");
});

test("already in the target room names the room only", () => {
  assert.deepEqual(cue("no-movement", "kitchen", { night: false }), { message: "Patient, how about a glass of water?", detail: "You're in the kitchen.", route: [] });
});

test("room names read naturally inside a sentence", () => {
  assert.equal(inSentence("TV room"), "TV room");
  assert.equal(inSentence("Front door"), "front door");
  assert.equal(cue("exit-approach", "tv-room").detail, "You're in the TV room. Your bed is back through the hallway.");
});

test("closing line and routine prompts", () => {
  assert.equal(closingLine("Patient", true), "Patient, good night. Sleep well.");
  assert.equal(closingLine("Patient", false), "Patient, thank you.");
  assert.equal(greetingLine("Patient", 9), "Patient, good morning.");
  assert.equal(greetingLine("Patient", 19), "Patient, good evening.");
  assert.equal(routinePrompt("Patient", "Breakfast is in the kitchen."), "Patient, breakfast is in the kitchen.");
  assert.equal(routinePrompt("Patient", "Good morning, Patient. Time to get up."), "Patient, good morning. Time to get up.");
  assert.equal(routinePrompt("Patient", "Goodnight, Patient. Time to sleep."), "Patient, goodnight. Time to sleep.");
  assert.equal(routinePrompt("Patient", "Patient, lunch is ready."), "Patient, lunch is ready.");
  assert.equal(routinePrompt("Patient", "TV time."), "Patient, TV time.");
});

test("routine prompts keep I and acronyms capitalized", () => {
  assert.equal(routinePrompt("Patient", "I'll be there at 9."), "Patient, I'll be there at 9.");
});

test("a typed note is one clean line, capped in length", () => {
  assert.equal(cleanNote("  Your caregiver is coming\n at  9. "), "Your caregiver is coming at 9.");
  assert.equal(cleanNote("   "), undefined);
  assert.equal(cleanNote(42), undefined);
  assert.equal(cleanNote("x".repeat(500))?.length, 200);
});
