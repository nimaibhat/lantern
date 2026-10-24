import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { HomeModel } from "@/lib/types";
import { clampToRoom, routeBetween } from "@/lib/world/geometry";
import { baselinePosterior } from "./baseline";
import { InferenceEngine } from "./engine";
import { hourOf } from "./index";
import { RoomHmm, buildTransition } from "./hmm";
import { align, knnPosterior, usable, type KnnModel } from "./knn";
import { PositionFilter, PositionTracker, estimatePosition } from "./position";
import { predictNext, type MarkovModel } from "./predictor";
import { RoomTracker } from "./tracker";

const argmax = (r: Record<string, number>) => Object.entries(r).sort((a, b) => b[1] - a[1])[0][0];
const oneHot = (room: string) => ({ [room]: 1 });
// Every key in `expected` matches; other keys in `actual` are ignored
const like = (actual: unknown, expected: Record<string, unknown>): void => {
  assert.ok(actual && typeof actual === "object", `expected an object, got ${actual}`);
  for (const [k, v] of Object.entries(expected)) {
    const a: unknown = (actual as Record<string, unknown>)[k];
    if (v && typeof v === "object") like(a, v as Record<string, unknown>);
    else assert.equal(a, v, k);
  }
};

// Two 100 x 100 rooms side by side with a 36 in door in the shared wall at x = 100
const rect = (x: number) => [{ x, y: 0 }, { x: x + 100, y: 0 }, { x: x + 100, y: 100 }, { x, y: 100 }];
const twoRooms: HomeModel = {
  householdId: "h1", version: 1, unit: "in", hazards: [],
  rooms: [
    { id: "a", name: "A", kind: "bedroom", polygon: rect(0), centroid: { x: 50, y: 50 }, heightIn: 96 },
    { id: "b", name: "B", kind: "hallway", polygon: rect(100), centroid: { x: 150, y: 50 }, heightIn: 96 },
  ],
  doors: [{ id: "d", roomA: "a", roomB: "b", center: { x: 100, y: 50 }, widthIn: 36, kind: "door" }],
  anchors: [{ receiverId: "a", position: { x: 50, y: 50 }, heightIn: 36 }, { receiverId: "b", position: { x: 150, y: 50 }, heightIn: 36 }],
};

describe("knn", () => {
  const cluster = (c: number[], label: string) => [0, 1, 2, 3].map((i) => ({ v: c.map((x) => x + i - 1.5), label }));
  const pts = [...cluster([-50, -80, -80], "bedroom"), ...cluster([-80, -50, -80], "hallway"), ...cluster([-80, -80, -50], "kitchen")];
  const m: KnnModel = { kind: "knn", algo: "knn", k: 5, order: ["r1", "r2", "r3"], rooms: ["bedroom", "hallway", "kitchen"],
    vectors: pts.map((p) => p.v), labels: pts.map((p) => p.label) };

  test("classifies three clusters", () => {
    assert.equal(argmax(knnPosterior(m, [-52, -79, -81])), "bedroom");
    assert.equal(argmax(knnPosterior(m, [-79, -51, -82])), "hallway");
    assert.equal(argmax(knnPosterior(m, [-81, -78, -49])), "kitchen");
  });

  test("gives a flat posterior when every receiver is missing", () => {
    assert.deepEqual(Object.values(knnPosterior(m, [-100, -100, -100])), [1 / 3, 1 / 3, 1 / 3]);
  });

  test("aligns a frame to the model's receiver order", () => {
    assert.deepEqual(align({ order: ["r3", "r1"], rssi: [-60, -70] }, ["r1", "r2", "r3"]), [-70, -100, -60]);
  });

  test("baseline picks the loudest receiver's room", () => {
    assert.equal(argmax(baselinePosterior(["a", "b"], [-80, -55], ["a", "b"], { a: "a", b: "b" })), "b");
    assert.deepEqual(baselinePosterior(["a", "b"], [-100, -100], ["a", "b"], { a: "a", b: "b" }), { a: 0.5, b: 0.5 });
  });
});

describe("door-graph HMM", () => {
  const rooms = ["bedroom", "hallway", "kitchen"];
  const edges: [string, string][] = [["bedroom", "hallway"], ["hallway", "kitchen"]];

  test("rows of the transition matrix sum to 1", () => {
    for (const row of buildTransition(rooms, edges)) assert.ok(Math.abs(row.reduce((s, v) => s + v, 0) - 1) < 1e-9);
  });

  test("never jumps bedroom > kitchen on one stray frame", () => {
    const hmm = new RoomHmm(rooms, edges);
    const out = ["bedroom", "bedroom", "kitchen", "bedroom"].map((o) => argmax(hmm.step(oneHot(o))));
    assert.deepEqual(out, ["bedroom", "bedroom", "bedroom", "bedroom"]);
  });

  test("reaches the kitchen through the hallway", () => {
    const hmm = new RoomHmm(rooms, edges);
    const out = ["bedroom", "hallway", "hallway", "kitchen"].map((o) => argmax(hmm.step(oneHot(o))));
    assert.equal(out.at(-1), "kitchen");
  });
});

describe("room tracker", () => {
  test("needs two agreeing confident frames", () => {
    const t = new RoomTracker(0.6, 2);
    assert.equal(t.step({ a: 0.9, b: 0.1 }), undefined);
    assert.deepEqual(t.step({ a: 0.9, b: 0.1 }), { room: "a", prev: undefined, confidence: 0.9 });
    assert.equal(t.step({ a: 0.3, b: 0.7 }), undefined);
    assert.equal(t.step({ a: 0.5, b: 0.5 }), undefined); // below threshold resets the streak
    assert.equal(t.step({ a: 0.3, b: 0.7 }), undefined);
    assert.equal(t.step({ a: 0.3, b: 0.7 })?.room, "b");
  });

  test("moves one door at a time", () => {
    const path: Record<string, string> = { bedroom: "hallway", hallway: "kitchen" };
    const t = new RoomTracker(0.6, 2, (from) => path[from]);
    t.step({ bedroom: 1 });
    t.step({ bedroom: 1 });
    assert.equal(t.step({ kitchen: 0.9 }), undefined);
    assert.equal(t.step({ kitchen: 0.9 })?.room, "hallway");
    assert.equal(t.step({ kitchen: 0.9 })?.room, "kitchen");
  });
});

describe("position", () => {
  test("weighted centroid leans toward the loudest anchor", () => {
    const anchors = { a: { x: 0, y: 0 }, b: { x: 100, y: 0 } };
    assert.ok(estimatePosition([-50, -80], ["a", "b"], anchors)!.x < 10);
    assert.equal(estimatePosition([-100, -100], ["a", "b"], anchors), undefined);
  });

  test("filter respects the speed limit and the room clamp", () => {
    const f = new PositionFilter(1, 100);
    const clamp = (p: { x: number; y: number }) => clampToRoom(twoRooms, "a", p);
    f.step({ x: 50, y: 50 }, 0, clamp);
    assert.ok(Math.abs(f.step({ x: 90, y: 50 }, 200, clamp).x - 70) < 0.01); // 100 in/s * 0.2 s
    assert.equal(f.step({ x: 300, y: 50 }, 1200, clamp).x, 100); // pulled back onto the wall of room a
  });

  test("walks through the door, not the wall, after a room change", () => {
    const t = new PositionTracker(0.35, 100);
    t.setTarget({ x: 50, y: 10 });
    t.step(0, (p) => clampToRoom(twoRooms, "a", p));
    t.enterRoom(routeBetween(twoRooms, "a", "b").slice(1, -1));
    t.setTarget({ x: 150, y: 90 });
    let prev = t.current!;
    for (let ts = 200; ts < 10000; ts += 200) {
      const p = t.step(ts, (q) => clampToRoom(twoRooms, "b", q))!;
      if ((prev.x - 100) * (p.x - 100) < 0) assert.ok(Math.abs((prev.y + p.y) / 2 - 50) < 18, "crossed x = 100 outside the door");
      prev = p;
    }
    assert.ok(Math.hypot(prev.x - 150, prev.y - 90) < 2);
  });
});

describe("predictor", () => {
  const m: MarkovModel = { kind: "markov", counts: {
    "bedroom>hallway|1": { kitchen: 7, bathroom: 3 },
    "hallway|1": { bedroom: 2 },
    hallway: { bedroom: 10, kitchen: 5 },
  } };

  test("uses the most specific context with enough counts", () => {
    like(predictNext(m, "bedroom", "hallway", 3.2), { nextRoomId: "kitchen", probability: 0.7 });
  });

  test("backs off when a context is too thin", () => {
    like(predictNext(m, "kitchen", "hallway", 4), { nextRoomId: "bedroom", key: "hallway" });
    assert.equal(predictNext(m, undefined, "garage", 4), undefined);
  });
});

describe("engine", () => {
  test("runs on the strongest receiver with no trained model", () => {
    const e = new InferenceEngine(twoRooms, {});
    const frame = (ts: number, rssi: number[]) => ({ ts, order: ["a", "b"], rssi, online: {} });
    assert.deepEqual(e.onFrame(frame(0, [-50, -80])), []);
    const [loc] = e.onFrame(frame(1000, [-50, -80]));
    like(loc, { k: "location", d: { roomId: "a", householdId: "h1", source: "ble" } });
    like(e.tick(1200), { roomId: "a" });
    assert.equal(e.tick(9000), undefined); // frames stopped
  });

  test("holds through silence, stops the avatar, and starts fresh after a long gap", () => {
    const e = new InferenceEngine(twoRooms, {});
    const frame = (ts: number, rssi: number[]) => ({ ts, order: ["a", "b"], rssi, online: { a: true, b: true } });
    e.onFrame(frame(0, [-50, -80]));
    e.onFrame(frame(1000, [-50, -80]));
    for (let ts = 2000; ts <= 20000; ts += 1000) assert.deepEqual(e.onFrame(frame(ts, [-100, -100])), []);
    assert.equal(e.room, "a"); // silence is not evidence
    assert.equal(e.tick(20000), undefined); // but the avatar stops
    e.onFrame(frame(21000, [-80, -50]));
    const [loc] = e.onFrame(frame(22000, [-80, -50]));
    like(loc, { k: "location", d: { roomId: "b", prevRoomId: undefined } }); // re-acquired, not "walked"
  });
});

describe("unplugged listener", () => {
  // Bedroom is loud on r1; with r1 unplugged the other two still tell the rooms apart
  const m: KnnModel = { kind: "knn", algo: "knn", k: 3, order: ["r1", "r2", "r3"], rooms: ["bedroom", "kitchen"],
    vectors: [[-50, -80, -90], [-52, -82, -88], [-51, -79, -91], [-90, -60, -55], [-88, -62, -57], [-91, -61, -54]],
    labels: ["bedroom", "bedroom", "bedroom", "kitchen", "kitchen", "kitchen"] };

  test("leaves the unplugged receiver out instead of reading it as far away", () => {
    const frame = { order: ["r1", "r2", "r3"], rssi: [-100, -80, -90], online: { r1: false, r2: true, r3: true } };
    const vec = align(frame, m.order);
    assert.equal(argmax(knnPosterior(m, vec)), "kitchen"); // -100 on r1 looks like "far from the bedroom"
    assert.equal(argmax(knnPosterior(m, vec, usable(frame, m.order))), "bedroom");
  });

  test("still treats an online listener that hears nothing as evidence", () => {
    assert.deepEqual(usable({ order: ["r1", "r2"], online: { r1: true, r2: true } }, ["r1", "r2", "r3"]), [true, true, false]);
  });
});

describe("predictor clock", () => {
  test("reads the household's timezone, and only a valid DEMO_HOUR", () => {
    const ts = Date.UTC(2026, 0, 15, 8, 30); // 3:30 AM in New York, whatever the laptop's timezone
    const saved = process.env.DEMO_HOUR;
    try {
      delete process.env.DEMO_HOUR;
      assert.equal(hourOf(ts), 3.5);
      process.env.DEMO_HOUR = "15";
      assert.equal(hourOf(ts), 15.5);
      process.env.DEMO_HOUR = "3am"; // a typo is ignored instead of making every prediction NaN
      assert.equal(hourOf(ts), 3.5);
    } finally {
      if (saved === undefined) delete process.env.DEMO_HOUR;
      else process.env.DEMO_HOUR = saved;
    }
  });
});
