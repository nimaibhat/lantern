import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { HomeModel } from "@/lib/types";
import { roomAt } from "./geometry";
import { applyFrame, initialLive, riskByRoom, TRAIL_MS } from "./live-state";
import { mockWalk } from "./mock-walk";

const home: HomeModel = JSON.parse(readFileSync("fixtures/home-model.json", "utf8"));

test("position frames move the person, keep a 10 s trail and set the room", () => {
  let s = initialLive(home);
  for (let i = 0; i <= 20; i++) s = applyFrame(s, { t: "position", ts: i * 1000, x: 72, y: 72, roomId: "bedroom", confidence: 0.9, source: "ble" });
  assert.equal(s.room, "bedroom");
  assert.equal(s.lastSource, "ble");
  assert.ok(s.trail.every((p) => 20_000 - p.ts <= TRAIL_MS));
  assert.equal(s.trail.length, 11);
});

test("risks color their room until resolved", () => {
  let s = initialLive(home);
  s = applyFrame(s, { t: "risk", ts: 1, riskEventId: "r1", kind: "kitchen-night", roomId: "kitchen", state: "redirecting", trigger: "detected" });
  assert.equal(riskByRoom(s).kitchen, "redirecting");
  s = applyFrame(s, { t: "risk", ts: 2, riskEventId: "r1", kind: "kitchen-night", roomId: "kitchen", state: "escalated", trigger: "detected" });
  assert.equal(riskByRoom(s).kitchen, "escalated");
  s = applyFrame(s, { t: "risk", ts: 3, riskEventId: "r1", kind: "kitchen-night", roomId: "kitchen", state: "resolved", trigger: "detected" });
  assert.equal(riskByRoom(s).kitchen, undefined);
});

test("a prediction is dropped once the person leaves the room it was made in", () => {
  let s = initialLive(home);
  s = applyFrame(s, { t: "prediction", ts: 0, fromRoomId: "hallway", nextRoomId: "kitchen", probability: 0.78 });
  s = applyFrame(s, { t: "position", ts: 100, x: 180, y: 100, roomId: "hallway", confidence: 1, source: "sim" });
  assert.equal(s.prediction?.nextRoomId, "kitchen");
  s = applyFrame(s, { t: "position", ts: 200, x: 300, y: 72, roomId: "kitchen", confidence: 1, source: "sim" });
  assert.equal(s.prediction, undefined);
});

test("mock walk: smooth, inside rooms, predicts and redirects, ends back in bed", () => {
  const frames = mockWalk(home);
  const positions = frames.filter((f) => f.frame.t === "position").map((f) => f.frame as Extract<typeof f.frame, { t: "position" }>);
  assert.ok(positions.length > 20);
  for (let i = 1; i < positions.length; i++) {
    const jump = Math.hypot(positions[i].x - positions[i - 1].x, positions[i].y - positions[i - 1].y);
    assert.ok(jump < 15, `jump of ${jump} in at frame ${i}`); // about 10 in per 200 ms step, never a teleport
    assert.ok(roomAt(home, positions[i]) || positions[i].roomId, "position outside the home");
  }
  assert.ok(frames.some((f) => f.frame.t === "prediction" && f.frame.nextRoomId === "kitchen"));
  assert.ok(frames.some((f) => f.frame.t === "risk" && f.frame.state === "redirecting"));
  assert.ok(frames.some((f) => f.frame.t === "risk" && f.frame.state === "resolved"));
  assert.equal(positions[positions.length - 1].roomId, "bedroom");
  assert.ok(frames.every((f, i) => i === 0 || f.at >= frames[i - 1].at), "frames are in time order");
});

test("the room shown is the live dot's room; a late room change cannot overwrite it", () => {
  let s = initialLive(home);
  s = applyFrame(s, { t: "position", ts: 10_000, x: 180, y: 72, roomId: "hallway", confidence: 0.6, source: "ble" });
  s = applyFrame(s, { t: "location", ts: 10_200, roomId: "bedroom", prevRoomId: "kitchen", source: "ble" });
  assert.equal(s.room, "hallway", "positions are flowing, so the dot's room stays");
  s = applyFrame(s, { t: "location", ts: 20_000, roomId: "bedroom", prevRoomId: "hallway", source: "ble" });
  assert.equal(s.room, "bedroom", "no position for a while, so the room change moves the label");
});
