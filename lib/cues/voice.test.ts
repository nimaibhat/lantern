import assert from "node:assert/strict";
import { test } from "node:test";
import { pickCalmVoice } from "./voice";

const v = (name: string, lang = "en-US") => ({ name, lang });

test("Windows Chrome picks a female voice, not the default David", () => {
  const voices = [v("Microsoft David - English (United States)"), v("Microsoft Mark - English (United States)"), v("Microsoft Zira - English (United States)"), v("Google US English")];
  assert.equal(pickCalmVoice(voices)?.name, "Google US English");
  assert.equal(pickCalmVoice(voices.slice(0, 3))?.name, "Microsoft Zira - English (United States)");
});

test("a male natural voice is skipped for a female one", () => {
  const voices = [v("Microsoft Guy Online (Natural) - English (United States)"), v("Microsoft Aria Online (Natural) - English (United States)")];
  assert.equal(pickCalmVoice(voices)?.name, "Microsoft Aria Online (Natural) - English (United States)");
});

test("Google's UK male voice is never chosen over another English voice", () => {
  assert.equal(pickCalmVoice([v("Google UK English Male", "en-GB"), v("Some Voice", "en-GB")])?.name, "Some Voice");
});

test("with only male English voices it still speaks, and other languages are ignored", () => {
  assert.equal(pickCalmVoice([v("Google Deutsch", "de-DE"), v("Microsoft David - English (United States)")])?.name, "Microsoft David - English (United States)");
  assert.equal(pickCalmVoice([]), undefined);
});
