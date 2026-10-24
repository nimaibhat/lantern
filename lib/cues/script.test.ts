import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { HomeModel } from "@/lib/types";
import { cleanNote, closingLine, cueScript, greetingLine, inSentence, routinePrompt } from "./script";

// Fixture rooms: bedroom, bathroom, kitchen, tv-room and front-door, each one door off the hallway.
const home = JSON.parse(readFileSync("fixtures/home-model.json", "utf8")) as HomeModel;
const cue = (kind: Parameters<typeof cueScript>[0]["kind"], roomId: string, extra: { confident?: boolean; night?: boolean } = {}) =>
  cueScript({ kind, name: "Rosa", home, roomId, confident: extra.confident ?? true, night: extra.night ?? true });

test("kitchen at night: where they are and the way back through the scan's doors", () => {
  assert.deepEqual(cue("kitchen-night", "kitchen"), {
    message: "Rosa, it's still nighttime. Let's go back to bed.",
    detail: "You're in the kitchen. Your bed is back through the hallway.",
    route: ["Kitchen", "Hallway", "Bedroom"],
  });
});

test("one door away says next door", () => {
  assert.equal(cue("night-wandering", "hallway").detail, "You're in the hallway. Your bed is just next door.");
  assert.deepEqual(cue("night-wandering", "hallway").route, ["Hallway", "Bedroom"]);
});

test("an unsure room says the message only, never a wrong room", () => {
  assert.deepEqual(cue("kitchen-night", "kitchen", { confident: false }), { message: "Rosa, it's still nighttime. Let's go back to bed.", route: [] });
  assert.deepEqual(cue("kitchen-night", "garage"), { message: "Rosa, it's still nighttime. Let's go back to bed.", route: [] });
});

test("the front door leads to the bedroom at night and the TV room by day", () => {
  assert.equal(cue("exit-approach", "front-door").detail, "You're at the front door. Your bed is back through the hallway.");
  assert.equal(cue("exit-approach", "front-door", { night: false }).detail, "You're at the front door. The TV room is through the hallway.");
});

test("a long bathroom stay checks in without directions", () => {
  assert.deepEqual(cue("long-bathroom-stay", "bathroom"), { message: "Rosa, are you all right?", detail: "Take your time.", route: [] });
});

test("no movement suggests water in the kitchen", () => {
  const s = cue("no-movement", "bedroom", { night: false });
  assert.equal(s.message, "Rosa, how about a glass of water?");
  assert.equal(s.detail, "You're in the bedroom. The kitchen is through the hallway.");
});

test("already in the target room names the room only", () => {
  assert.deepEqual(cue("no-movement", "kitchen", { night: false }), { message: "Rosa, how about a glass of water?", detail: "You're in the kitchen.", route: [] });
});

test("room names read naturally inside a sentence", () => {
  assert.equal(inSentence("TV room"), "TV room");
  assert.equal(inSentence("Front door"), "front door");
  assert.equal(cue("night-wandering", "tv-room").detail, "You're in the TV room. Your bed is back through the hallway.");
});

test("closing line and routine prompts", () => {
  assert.equal(closingLine("Rosa", true), "Rosa, good night. Sleep well.");
  assert.equal(closingLine("Rosa", false), "Rosa, thank you.");
  assert.equal(greetingLine("Rosa", 9), "Rosa, good morning.");
  assert.equal(greetingLine("Rosa", 19), "Rosa, good evening.");
  assert.equal(routinePrompt("Rosa", "Breakfast is in the kitchen."), "Rosa, breakfast is in the kitchen.");
  assert.equal(routinePrompt("Rosa", "Good morning, Rosa. Time to get up."), "Rosa, good morning. Time to get up.");
  assert.equal(routinePrompt("Rosa", "Goodnight, Rosa. Time to sleep."), "Rosa, goodnight. Time to sleep.");
  assert.equal(routinePrompt("Rosa", "Rosa, lunch is ready."), "Rosa, lunch is ready.");
  assert.equal(routinePrompt("Rosa", "TV time."), "Rosa, TV time.");
});

test("routine prompts keep I and acronyms capitalized", () => {
  assert.equal(routinePrompt("Rosa", "I'll be there at 9."), "Rosa, I'll be there at 9.");
});

test("a typed note is one clean line, capped in length", () => {
  assert.equal(cleanNote("  Maria is coming\n at  9. "), "Maria is coming at 9.");
  assert.equal(cleanNote("   "), undefined);
  assert.equal(cleanNote(42), undefined);
  assert.equal(cleanNote("x".repeat(500))?.length, 200);
});
