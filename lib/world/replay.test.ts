import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { HomeModel } from "@/lib/types";
import { demoNight, parseSession, stateAt } from "./replay";

const home: HomeModel = JSON.parse(readFileSync("fixtures/home-model.json", "utf8"));

test("recorder lines become frames, rebased to zero; raw RSSI frames and broken lines are skipped", () => {
  const text = [
    JSON.stringify({ k: "frame", ts: 1000, d: { order: ["bedroom"], rssi: [-60] } }),
    JSON.stringify({ k: "position", ts: 1000, d: { x: 72, y: 72, roomId: "bedroom", confidence: 0.9, source: "ble" } }),
    "not json",
    JSON.stringify({ k: "risk", ts: 3000, d: { id: "r1", kind: "kitchen-night", roomId: "kitchen", state: "redirecting", trigger: "detected" } }),
    JSON.stringify({ k: "position", ts: 2000, d: { x: 180, y: 72, roomId: "hallway", confidence: 0.8, source: "ble" } }),
  ].join("\n");
  const frames = parseSession(text);
  assert.deepEqual(frames.map((f) => [f.t, f.ts]), [["position", 0], ["position", 1000], ["risk", 2000]]);
  assert.equal(stateAt(home, frames, 1500).room, "hallway");
  assert.equal(stateAt(home, frames, 500).room, "bedroom");
  assert.equal(Object.keys(stateAt(home, frames, 2500).risks).length, 1);
});

test("the demo night loops the walk twice and ends back in the bedroom", () => {
  const frames = demoNight(home);
  assert.ok(frames.length > 50);
  assert.equal(frames[0].ts, 0);
  const end = stateAt(home, frames, frames[frames.length - 1].ts);
  assert.equal(end.room, "bedroom");
  assert.equal(frames.filter((f) => f.t === "risk" && f.state === "redirecting").length, 2);
});
