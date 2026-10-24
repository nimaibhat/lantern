import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { WebSocket } from "ws";
import type { LiveFrame } from "@/lib/types";
import { loadConfig } from "./config";
import { startMonitor } from "./server";

let monitor: Awaited<ReturnType<typeof startMonitor>>;
let base = "";

before(async () => {
  // Noon, so night rules never add risk frames and these tests pass at any hour.
  process.env.DEMO_HOUR = "12";
  monitor = await startMonitor({ ...loadConfig({}), port: 0, debug: true });
  base = `http://localhost:${monitor.port}`;
});
after(() => monitor.close());

const post = (path: string, body: unknown) =>
  fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

// Opens /ws/live and collects frames until `count` have arrived (the snapshot counts as one).
async function live(count: number, act: () => Promise<unknown>): Promise<LiveFrame[]> {
  const ws = new WebSocket(`ws://localhost:${monitor.port}/ws/live`);
  const frames: LiveFrame[] = [];
  const done = new Promise<void>((resolve, reject) => {
    setTimeout(() => reject(new Error(`timed out with ${frames.length} frames`)), 2000);
    ws.on("message", (m) => {
      frames.push(JSON.parse(String(m)));
      if (frames.length === 1) act().catch(reject);
      if (frames.length === count) resolve();
    });
  });
  try {
    await done;
  } finally {
    ws.close();
  }
  return frames;
}

test("GET /health answers", async () => {
  const res = await fetch(`${base}/health`);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ok, true);
});

test("/ws/live sends a snapshot, then /debug/emit events", async () => {
  const frames = await live(2, () =>
    post("/debug/emit", { event: "patient", payload: { householdId: "h1", mode: "glow", updatedAt: new Date().toISOString() } }),
  );
  assert.equal(frames[0].t, "snapshot");
  assert.ok(frames[0].t === "snapshot" && frames[0].home.rooms.length > 0);
  assert.deepEqual({ t: frames[1].t, mode: frames[1].t === "patient" && frames[1].mode }, { t: "patient", mode: "glow" });
});

test("POST /sim/room emits position and location with source sim", async () => {
  const frames = await live(3, () => post("/sim/room", { roomId: "kitchen" }));
  assert.deepEqual(
    frames.slice(1).map((f) => [f.t, "roomId" in f && f.roomId, "source" in f && f.source]),
    [
      ["position", "kitchen", "sim"],
      ["location", "kitchen", "sim"],
    ],
  );
});

test("BLE location is dropped while the sim lock is on", async () => {
  await post("/sim/room", { roomId: "bedroom" });
  const res = await post("/debug/emit", {
    event: "location",
    payload: { id: "x", householdId: "h1", roomId: "hallway", confidence: 1, source: "ble", ts: new Date().toISOString() },
  });
  assert.equal((await res.json()).emitted, false);
  assert.equal(monitor.store.room, "bedroom");
});

test("/health reports the tag once a listener hears it", async () => {
  const health = async () => (await (await fetch(`${base}/health`)).json()) as { tagOnline: boolean };
  assert.equal((await health()).tagOnline, false);
  const ws = new WebSocket(`ws://localhost:${monitor.port}/ws/listener?token=change-me`);
  await new Promise((resolve) => ws.on("open", resolve));
  ws.send(JSON.stringify({ type: "hello", receiverId: "bedroom", kind: "mac-bleak" }));
  ws.send(JSON.stringify({ type: "rssi", receiverId: "bedroom", tagId: "tag-1", rssi: -55, ts: Date.now() }));
  // tagOnline is refreshed on the 1 s frame tick
  for (let i = 0; i < 30 && !(await health()).tagOnline; i++) await new Promise((r) => setTimeout(r, 100));
  ws.close();
  assert.equal((await health()).tagOnline, true);
});

test("bad sim input is a 400, not a crash", async () => {
  assert.equal((await post("/sim/position", { x: -500, y: 0 })).status, 400);
  assert.equal((await post("/sim/room", { roomId: "garage" })).status, 400);
  assert.equal((await post("/debug/emit", { event: "nope", payload: {} })).status, 400);
});
