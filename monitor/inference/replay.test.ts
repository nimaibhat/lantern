// Replays the fake test route (bedroom > hallway > kitchen > hallway > bedroom at 3 AM) through the engine with
// the committed models. A smoke test: the shipped kNN saw this session in training.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import type { HomeModel } from "@/lib/types";
import { clampToRoom } from "@/lib/world/geometry";
import { InferenceEngine } from "./engine";
import { bySession, parseRssiCsv, replay } from "./replay";

const json = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const home: HomeModel = json("fixtures/home-model.json");
const models = { knn: json("ml/out/knn.json"), markov: json("ml/out/markov.json") };
const { order, rows } = parseRssiCsv(readFileSync("fixtures/rssi-samples.fake.csv", "utf8"));
const route = bySession(rows).get("route-test")!;
const hourOf = (ts: number) => new Date(ts).getUTCHours(); // synthetic timestamps are UTC

describe("replay of the fake test route", () => {
  const r = replay(new InferenceEngine(home, models, { hourOf }), order, route);
  const kinds = r.lines.filter((l) => l.k === "location" || l.k === "prediction");

  test("emits exactly bedroom, hallway, kitchen, hallway, bedroom", () => {
    const rooms = kinds.filter((l) => l.k === "location").map((l) => (l.d as { roomId: string }).roomId);
    assert.deepEqual(rooms, ["bedroom", "hallway", "kitchen", "hallway", "bedroom"]);
  });

  test("predicts the kitchen from the hallway before arriving", () => {
    const i = kinds.findIndex((l) => l.k === "prediction" && (l.d as { nextRoomId: string }).nextRoomId === "kitchen");
    const arrive = kinds.findIndex((l) => l.k === "location" && (l.d as { roomId: string }).roomId === "kitchen");
    assert.ok(i >= 0, "no kitchen prediction");
    assert.ok(i < arrive, "prediction came after arriving");
  });

  test("keeps every position inside the room it reports", () => {
    assert.ok(r.positions.length > route.length * 4);
    for (const { p } of r.positions) {
      const q = clampToRoom(home, p.roomId, p); // unchanged when p is inside or on the room's edge
      assert.ok(Math.hypot(q.x - p.x, q.y - p.y) < 0.1, `(${p.x}, ${p.y}) is outside ${p.roomId}`);
    }
  });
});
