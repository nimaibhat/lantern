// How close the dot on the plan is to where the person really was: replays every route session of an RSSI CSV
// (rows with x, y) through the real engine with each positioner and prints the error in inches. The CSV has one
// frame a second, so this tests the frame path; tools/position-lag.ts tests the live raw-reading path.
//
//   npx tsx tools/position-eval.ts [csv] [--home fixtures/home-model.json] [--model ml/out/knn.json]
//
// The fake CSV comes from ml/make_fake_rssi.py, whose signal model is close to the floor grid's, so its numbers are
// a best case. A walk with real x, y labels is the honest test.

import { existsSync, readFileSync } from "node:fs";
import { InferenceEngine, type EngineOptions } from "../monitor/inference/engine";
import { bySession, median, parseRssiCsv, replay, score } from "../monitor/inference/replay";
import type { HomeModel } from "@/lib/types";

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
const home: HomeModel = JSON.parse(readFileSync(flag("--home") ?? "fixtures/home-model.json", "utf8"));
const modelPath = flag("--model") ?? (existsSync("ml/out/knn-holdout.json") ? "ml/out/knn-holdout.json" : "ml/out/knn.json");
const knn = existsSync(modelPath) ? JSON.parse(readFileSync(modelPath, "utf8")) : undefined;
const csv = args[0] ?? (existsSync("fixtures/rssi-samples.csv") ? "fixtures/rssi-samples.csv" : "fixtures/rssi-samples.fake.csv");

const { order, rows } = parseRssiCsv(readFileSync(csv, "utf8"));
const routes = [...bySession(rows).values()].filter((list) => list.some((r) => r.x !== undefined) && new Set(list.map((r) => r.roomId)).size > 1);
if (!routes.length) throw new Error(`${csv} has no route sessions with x, y`);

const pct = (v: number[], q: number) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : 0; };

function run(label: string, opts: EngineOptions) {
  const errs: number[] = [], center: number[] = [];
  for (const list of routes) {
    const s = score(home, list, replay(new InferenceEngine(home, { knn }, { hourOf: () => 3, ...opts }), order, list));
    errs.push(...s.positionErrorsIn);
    center.push(...s.centerErrorsIn);
  }
  console.log(`${label.padEnd(26)} median ${String(Math.round(median(errs))).padStart(3)} in   p90 ${String(Math.round(pct(errs, 0.9))).padStart(3)} in   (mid-room ${Math.round(median(center))} in, ${errs.length} points)`);
  return median(errs);
}

console.log(`${routes.length} routes from ${csv}, ${home.anchors.length} listeners\n`);
run("weighted centroid (old)", { positioner: "centroid", live: false });
run("floor grid", { positioner: "grid", live: false });
