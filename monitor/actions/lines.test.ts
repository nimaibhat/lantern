import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_LINE_CHARS, parseLines } from "@/lib/dashboard/redirect-media";
import { loadConfig } from "../config";
import { startMonitor } from "../server";
import { createLines } from "./lines";

test("parseLines keeps known slots with text and drops the rest", () => {
  const long = "x".repeat(MAX_LINE_CHARS + 50);
  assert.deepEqual(parseLines({ kitchen: "  Back to bed, Mom.  ", bedtime: "", oven: "hi", greeting: 3, "front-door": long }), {
    kitchen: "Back to bed, Mom.",
    "front-door": "x".repeat(MAX_LINE_CHARS),
  });
  assert.deepEqual(parseLines(null), {});
  assert.deepEqual(parseLines("kitchen"), {});
});

test("a save from Settings wins over a slower startup read", () => {
  const lines = createLines();
  lines.set({ kitchen: "New words" });
  lines.load({ kitchen: "Old words" });
  assert.equal(lines.get("kitchen"), "New words");
  assert.equal(lines.get("bedtime"), undefined);
});

test("the startup read applies when nothing was saved yet", () => {
  const lines = createLines();
  lines.load({ bedtime: "Saved earlier" });
  assert.equal(lines.get("bedtime"), "Saved earlier");
});

test("through the monitor: POST /voice-lines replaces the set and returns what it kept", async () => {
  const monitor = await startMonitor({ ...loadConfig({}), port: 0, debug: true });
  try {
    const res = await fetch(`http://localhost:${monitor.port}/voice-lines`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lines: { kitchen: "It's late, Rosa. Your bed is warm.", nonsense: "x" } }),
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { lines: { kitchen: "It's late, Rosa. Your bed is warm." } });
  } finally {
    await monitor.close();
  }
});
