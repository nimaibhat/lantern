// How far behind the person the dot trails. Simulates walks through a home with raw 5 Hz readings per listener
// (dropouts, noise, body shadowing, a per-walk phone bias), runs them through the real engine three ways, and
// prints the error and the effective lag: the delay that best lines the dot's path up with the true one.
//
//   npx tsx tools/position-lag.ts [--home fixtures/home-model.json] [--model ml/out/knn.json] [--walks 12]
//
// The signal model matches the floor grid's, so the absolute errors are a best case. The lag comparison is fair:
// every pipeline sees the same readings.

import { existsSync, readFileSync } from "node:fs";
import type { HomeModel, PositionEstimate, Vec2 } from "@/lib/types";
import { InferenceEngine, type EngineOptions } from "../monitor/inference/engine";
import { median } from "../monitor/inference/replay";
import { RssiWindow } from "../monitor/sensing/window";
import { Radio, rng, walk } from "./walk-sim";

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
const home: HomeModel = JSON.parse(readFileSync(flag("--home") ?? "fixtures/home-model.json", "utf8"));
const modelPath = flag("--model") ?? "ml/out/knn.json";
const knn = existsSync(modelPath) ? JSON.parse(readFileSync(modelPath, "utf8")) : undefined;
const WALKS = Number(flag("--walks") ?? 12), WALK_S = 240, T0 = Date.UTC(2026, 9, 24, 3);
const WALL_DB = Number(flag("--wall") ?? 6); // the simulated home's real loss per wall; the model assumes 6
const r = rng(20261024);

// Listeners the room model knows, with a position in the home
// The room model's listeners when it was trained on this home; for any other home, every placed listener
const placed = [...new Set(home.anchors.map((a) => a.receiverId))];
const fits = knn && knn.rooms.every((r: string) => home.rooms.some((x) => x.id === r));
const order: string[] = fits ? knn.order.filter((id: string) => placed.includes(id)) : placed;

// Raw readings: each listener about every 200 ms, as Radio hears them
function readings(track: Vec2[]) {
  const radio = new Radio(home, r, WALL_DB);
  const out: { receiverId: string; rssi: number; ts: number }[] = [];
  for (const id of order) {
    for (let t = r() * 200; t < track.length * 100; t += 160 + r() * 80) {
      const rssi = radio.hear(id, track[Math.min(track.length - 1, Math.floor(t / 100))]);
      if (rssi !== undefined) out.push({ receiverId: id, rssi, ts: T0 + t });
    }
  }
  return out.sort((a, b) => a.ts - b.ts);
}

type Run = { p: PositionEstimate; truthIdx: number }[];

function run(opts: EngineOptions, raw: boolean, tickMs: number, track: Vec2[], heard: ReturnType<typeof readings>): Run {
  const engine = new InferenceEngine(home, { knn }, { hourOf: () => 3, ...opts });
  const win = new RssiWindow(order);
  const online = Object.fromEntries(order.map((id) => [id, true]));
  const out: Run = [];
  let k = 0, nextFrame = T0 + 1000, nextTick = T0 + tickMs;
  const end = T0 + track.length * 100;
  while (nextTick < end) {
    const t = Math.min(nextFrame, nextTick);
    for (; k < heard.length && heard[k].ts <= t; k++) {
      win.push(heard[k]);
      if (raw) engine.onReading(heard[k]);
    }
    if (t === nextFrame) { engine.onFrame(win.frame(t, online)); nextFrame += 1000; }
    if (t === nextTick) {
      const p = engine.tick(t);
      if (p) out.push({ p, truthIdx: Math.floor((t - T0) / 100) });
      nextTick += tickMs;
    }
  }
  return out;
}

const walks = Array.from({ length: WALKS }, () => walk(home, WALK_S, r));
const data = walks.map((w) => ({ ...w, heard: readings(w.track) }));
console.log(`${WALKS} walks of ${WALK_S} s, ${order.length} listeners (${order.join(", ")}), ${home.rooms.length} rooms\n`);

const sweep = args.includes("--sweep");
const pipelines: [string, EngineOptions, boolean, number][] = sweep
  ? [250, 400, 550].flatMap((tauMs) => [300, 500].flatMap((leadMs) => [6, 9].map((stillIn): [string, EngineOptions, boolean, number] =>
      [`tau ${tauMs} lead ${leadMs} still ${stillIn}`, { live: { tauMs, leadMs, floor: { stillIn } } }, true, 100])))
  : args.includes("--stick")
    ? [1, 0.6, 0.4, 0.25].map((doorStick): [string, EngineOptions, boolean, number] => [`fast, door stick ${doorStick}`, { live: { floor: { doorStick } } }, true, 100])
    : [
        ["today: centroid, 1 s frames", { positioner: "centroid", live: false }, false, 200],
        ["floor grid, 1 s frames", { positioner: "grid", live: false }, false, 200],
        ["fast: raw readings, 10 Hz", {}, true, 100],
      ];

for (const [label, opts, raw, tickMs] of pipelines) {
  const runs = data.map((d) => ({ d, r: run(opts, raw, tickMs, d.track, d.heard) }));
  const errAt = (shiftS: number) => median(runs.flatMap(({ d, r }) => r.map(({ p, truthIdx }) => {
    const q = d.track[Math.max(0, truthIdx - Math.round(shiftS * 10))];
    return Math.hypot(p.x - q.x, p.y - q.y);
  })));
  let lag = 0, best = Infinity;
  for (let s = 0; s <= 4; s += 0.1) { const e = errAt(s); if (e < best) { best = e; lag = s; } }
  // Just after walking through a door: the moment a held-back dot looks most wrong
  const doorway = median(runs.flatMap(({ d, r }) => r.filter(({ truthIdx }) => {
    for (let back = 1; back <= 30; back++) if (truthIdx - back >= 0 && d.roomAt[truthIdx - back] !== d.roomAt[truthIdx]) return true;
    return false;
  }).map(({ p, truthIdx }) => Math.hypot(p.x - d.track[truthIdx].x, p.y - d.track[truthIdx].y))));
  // Standing still (no true movement for 2 s): how much the dot wanders anyway, in inches per second
  const wobble = median(runs.flatMap(({ d, r }) => r.slice(1).filter(({ truthIdx }, i) => truthIdx >= 20 && r[i].truthIdx >= 0
    && Math.hypot(d.track[truthIdx].x - d.track[truthIdx - 20].x, d.track[truthIdx].y - d.track[truthIdx - 20].y) < 1)
    .map(({ p }, i, list) => (i ? Math.hypot(p.x - list[i - 1].p.x, p.y - list[i - 1].p.y) * (1000 / tickMs) : 0))));
  // How often the room shown is the room the person is really in
  // Label churn: how often the room shown changes, per minute, against how often the person really changes room
  const changes = (list: string[]) => list.slice(1).filter((r, i) => r !== list[i]).length;
  const minutes = runs.reduce((m, { r }) => m + (r.length * tickMs) / 60000, 0);
  const churn = runs.reduce((n, { r }) => n + changes(r.map(({ p }) => p.roomId)), 0) / minutes;
  const real = runs.reduce((n, { d, r }) => n + changes(r.map(({ truthIdx }) => d.roomAt[truthIdx])), 0) / minutes;
  const shownRight = runs.flatMap(({ d, r }) => r.map(({ p, truthIdx }) => (p.roomId === d.roomAt[truthIdx] ? 1 : 0)));
  const roomRight = Math.round((100 * shownRight.reduce((a: number, b: number) => a + b, 0)) / Math.max(shownRight.length, 1));
  console.log(`${label.padEnd(30)} room shown right ${roomRight}% | label changes ${churn.toFixed(1)}/min (real ${real.toFixed(1)}) | error now ${String(Math.round(errAt(0))).padStart(3)} in | lag ${lag.toFixed(1)} s | after a doorway ${String(Math.round(doorway)).padStart(3)} in | wobble still ${String(Math.round(wobble)).padStart(2)} in/s`);
}
