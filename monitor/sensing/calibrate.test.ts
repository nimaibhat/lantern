import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { SensorFrame } from "@/lib/types";
import { loadConfig } from "../config";
import { startMonitor } from "../server";
import { csvHeader, csvLine, csvPathFor, heardAnything } from "./calibrate";
import { rebasePayload } from "./replay";

const dir = mkdtempSync(join(tmpdir(), "lantern-cal-"));
let monitor: Awaited<ReturnType<typeof startMonitor>>;
let base = "";

before(async () => {
  // Write to a temp CSV and session folder, and keep the test away from Supabase.
  process.env.RSSI_CSV_PATH = join(dir, "rssi-samples.csv");
  process.env.SESSIONS_DIR = dir;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "";
  process.env.SUPABASE_URL = "";
  monitor = await startMonitor({ ...loadConfig({}), port: 0, debug: true });
  base = `http://localhost:${monitor.port}`;
});
after(() => monitor.close());

const post = (path: string, body: unknown = {}) =>
  fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const frame = (rssi: number[], ts = Date.now()): SensorFrame => ({
  ts,
  order: ["bedroom", "hallway", "kitchen", "tv-room"],
  rssi,
  online: { bedroom: true, hallway: true, kitchen: true, "tv-room": true },
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("csv helpers: plan 1.5 format, silent frames skipped, a changed header starts a new file", () => {
  assert.equal(csvHeader(["bedroom", "kitchen"]), "session,ts,roomId,x,y,bedroom,kitchen");
  assert.equal(csvLine("s1", "kitchen", { ...frame([-78, -66, -52, -80], 5) }), "s1,5,kitchen,,,-78,-66,-52,-80");
  assert.equal(csvLine("s1", "kitchen", frame([-70, -60, -50, -90], 5), 12, 30), "s1,5,kitchen,12,30,-70,-60,-50,-90");
  assert.equal(heardAnything(frame([-100, -100, -100, -100])), false);
  const f = join(dir, "other.csv");
  writeFileSync(f, "session,ts,roomId,x,y,a\n");
  assert.equal(csvPathFor(f, "session,ts,roomId,x,y,a", "s2"), f);
  assert.equal(csvPathFor(f, "session,ts,roomId,x,y,b", "s2"), f.replace(".csv", "-s2.csv"));
});

test("calibration labels frames with the room the person is in and writes them to the CSV", async () => {
  assert.equal((await post("/calibrate/start", { roomId: "garage" })).status, 400);
  const start = await (await post("/calibrate/start", { roomId: "kitchen", session: "kitchen-test" })).json();
  assert.equal(start.session, "kitchen-test");

  for (const rssi of [[-80, -70, -50, -85], [-81, -69, -52, -84], [-100, -100, -100, -100]]) {
    await post("/debug/emit", { event: "frame", payload: frame(rssi) });
  }
  // A test route relabels within the same session.
  await post("/calibrate/start", { roomId: "hallway" });
  await post("/debug/emit", { event: "frame", payload: frame([-70, -48, -70, -75]) });

  const status = await (await fetch(base + "/calibrate/status")).json();
  assert.deepEqual(status.windowsPerRoom, { kitchen: 2, hallway: 1 });
  const stop = await (await post("/calibrate/stop")).json();
  assert.equal(stop.session, "kitchen-test");
  assert.equal((await post("/calibrate/stop")).status, 409);

  const lines = readFileSync(join(dir, "rssi-samples.csv"), "utf8").trim().split("\n");
  assert.match(lines[0], /^session,ts,roomId,x,y,/);
  assert.equal(lines.length, 4); // header, two kitchen rows (the silent frame is skipped), one hallway row
  assert.ok(lines[1].startsWith("kitchen-test,") && lines[1].includes(",kitchen,"));
  assert.ok(lines[3].includes(",hallway,"));
});

test("replay re-emits a recorded night at speed, rebased to now and marked simulated", async () => {
  const t0 = 1_700_000_000_000;
  const rec = [
    { k: "frame", ts: t0, d: frame([-50, -70, -85, -90], t0) },
    { k: "location", ts: t0 + 100, d: { id: "l1", householdId: "h1", roomId: "hallway", prevRoomId: "bedroom", confidence: 0.9, source: "ble", ts: new Date(t0 + 100).toISOString() } },
    { k: "position", ts: t0 + 200, d: { ts: t0 + 200, x: 180, y: 140, roomId: "hallway", confidence: 0.9, source: "ble" } },
  ];
  writeFileSync(join(dir, "night-1.jsonl"), rec.map((l) => JSON.stringify(l)).join("\n") + "\nnot json\n");

  const seen: { k: string; d: { ts: number | string; source?: string } }[] = [];
  monitor.bus.on("location", (d) => seen.push({ k: "location", d }));
  monitor.bus.on("position", (d) => seen.push({ k: "position", d }));

  assert.equal((await post("/replay/start", { session: "missing" })).status, 404);
  const started = await (await post("/replay/start", { session: "night-1", speed: 8 })).json();
  assert.equal(started.mode, "live");
  assert.equal(started.events, 2); // live mode replays conclusions, not raw frames
  await sleep(150);

  const loc = seen.find((e) => e.k === "location" && e.d.source === "sim");
  const pos = seen.find((e) => e.k === "position" && e.d.source === "sim");
  assert.ok(loc && pos, "replayed events arrive marked sim");
  assert.ok(Math.abs(Date.parse(loc!.d.ts as string) - Date.now()) < 2000, "timestamps rebased to now");
  assert.deepEqual(await (await fetch(base + "/replay/status")).json(), { running: false });
});

test("rebasePayload shifts every timestamp field", () => {
  const out = rebasePayload("risk", { startedAt: "2026-01-01T00:00:00.000Z", resolvedAt: "2026-01-01T00:01:00.000Z", source: "ble" }, 60_000);
  assert.equal(out.startedAt, "2026-01-01T00:01:00.000Z");
  assert.equal(out.resolvedAt, "2026-01-01T00:02:00.000Z");
  assert.equal(out.source, "ble"); // only position and location sources are relabeled
});

test("a replayed risk never starts a real response (no redirect, no alert)", async () => {
  const t0 = 1_700_000_100_000;
  const risk = { id: "replayed-risk", householdId: "h1", kind: "kitchen-night", roomId: "kitchen", trigger: "detected", state: "detected", source: "ble", startedAt: new Date(t0).toISOString() };
  writeFileSync(join(dir, "night-risk.jsonl"), JSON.stringify({ k: "risk", ts: t0, d: risk }) + "\n");
  await post("/replay/start", { session: "night-risk", speed: 16 });
  await sleep(200);
  const state = await (await fetch(base + "/debug/state")).json();
  assert.ok(!state.active.some((r: { id: string }) => r.id === "replayed-risk"), "the responder ignored the replay");
  assert.ok(!state.alerts.some((a: { riskEventId: string }) => a.riskEventId === "replayed-risk"), "no alert from a replay");
});
