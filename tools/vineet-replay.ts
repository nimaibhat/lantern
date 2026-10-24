// Replays the route sessions of an RSSI CSV through the real inference engine, with and without the HMM,
// scores them against the labels, and writes ml/out/pipeline.json (read by ml/report.py) plus one
// session file per route in ml/out/sessions/ (same .jsonl format as Saran's recorder).
//
//   npx tsx tools/vineet-replay.ts [csv] [--model ml/out/knn-holdout.json] [--home home.json] [--out ml/out]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { InferenceEngine } from "../monitor/inference/engine";
import { bySession, median, parseRssiCsv, replay, score, type Score } from "../monitor/inference/replay";
import type { HomeModel } from "@/lib/types";

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
const out = flag("--out") ?? "ml/out";
const modelPath = flag("--model") ?? (existsSync(join(out, "knn-holdout.json")) ? join(out, "knn-holdout.json") : join(out, "knn.json"));
const homePath = flag("--home") ?? "fixtures/home-model.json";
const csvPath = args[0] ?? (existsSync("fixtures/rssi-samples.csv") ? "fixtures/rssi-samples.csv" : "fixtures/rssi-samples.fake.csv");

const json = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const home: HomeModel = json(homePath);
const models = { knn: json(modelPath), markov: existsSync("ml/out/markov.json") ? json("ml/out/markov.json") : undefined };
const synthetic = csvPath.includes("fake");
// Synthetic timestamps are UTC; real recordings use the laptop's local time, like the monitor
const hourOf = (ts: number) => { const d = new Date(ts); return synthetic ? d.getUTCHours() + d.getUTCMinutes() / 60 : d.getHours() + d.getMinutes() / 60; };

const { order, rows } = parseRssiCsv(readFileSync(csvPath, "utf8"));
const routes = [...bySession(rows)].filter(([, list]) => new Set(list.map((r) => r.roomId)).size > 1);
if (!routes.length) throw new Error(`${csvPath} has no multi-room (route) sessions to replay`);

const sum = (list: Score[], key: keyof Score) => list.reduce((s, x) => s + (x[key] as number), 0);
const all = (list: Score[], key: keyof Score) => list.flatMap((x) => x[key] as number[]);
const withHmm: Score[] = [], noHmm: Score[] = [];
mkdirSync(join(out, "sessions"), { recursive: true });

for (const [id, list] of routes) {
  const on = replay(new InferenceEngine(home, models, { hourOf }), order, list);
  const off = replay(new InferenceEngine(home, models, { hourOf, useHmm: false }), order, list);
  withHmm.push(score(home, list, on));
  noHmm.push(score(home, list, off));
  writeFileSync(join(out, "sessions", `${id}.jsonl`), on.lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  const path = on.lines.filter((l) => l.k !== "frame" && l.k !== "position").map((l) => {
    const d = l.d as { roomId?: string; nextRoomId?: string; probability?: number };
    return d.roomId ?? `(next ${d.nextRoomId} ${d.probability})`;
  });
  console.log(`${id.padEnd(16)} truth ${[...new Set(list.map((r) => r.roomId))].length} rooms | ${path.join(" > ")}`);
}

// Failure drill: each listener unplugged in turn, with and without leaving its column out of the kNN
const accuracy = (list: Score[]) => sum(list, "correct") / Math.max(sum(list, "frames"), 1);
const unplugged = Object.fromEntries(order.map((id) => {
  const run = (maskOffline: boolean) =>
    routes.map(([, list]) => score(home, list, replay(new InferenceEngine(home, models, { hourOf, maskOffline }), order, list, { offline: [id] })));
  const masked = run(true), naive = run(false);
  return [id, { accuracy: accuracy(masked), accuracyUnmasked: accuracy(naive), falseRedirects: sum(masked, "falseRedirects"), falseRedirectsUnmasked: sum(naive, "falseRedirects") }];
}));

const nights = new Set(routes.map(([, list]) => new Date(list[0].ts).toISOString().slice(0, 10))).size;
const pos = all(withHmm, "positionErrorsIn");
const pipeline = {
  csv: basename(csvPath), model: basename(modelPath), dataset: synthetic ? "synthetic" : "real", sessions: routes.length, nights,
  roomAccuracy: sum(withHmm, "correct") / Math.max(sum(withHmm, "frames"), 1),
  roomAccuracyNoHmm: sum(noHmm, "correct") / Math.max(sum(noHmm, "frames"), 1),
  impossibleJumps: sum(withHmm, "impossibleJumps"), impossibleJumpsNoHmm: sum(noHmm, "impossibleJumps"),
  roomChanges: sum(withHmm, "roomChanges"), roomChangesNoHmm: sum(noHmm, "roomChanges"), trueRoomChanges: sum(withHmm, "trueRoomChanges"),
  predictions: sum(withHmm, "predictions"), predictionsCorrect: sum(withHmm, "predictionsCorrect"),
  leadTimesS: all(withHmm, "leadTimesS"),
  falseRedirectsPerNight: sum(withHmm, "falseRedirects") / Math.max(nights, 1),
  latencyMs: median(all(withHmm, "delaysMs")),
  positionErrorIn: pos.length ? Math.round(median(pos)) : undefined,
  positionErrorRoomCenterIn: pos.length ? Math.round(median(all(withHmm, "centerErrorsIn"))) : undefined,
  unplugged,
};
writeFileSync(join(out, "pipeline.json"), JSON.stringify(pipeline, null, 2) + "\n");
console.log(JSON.stringify({ ...pipeline, leadTimesS: pipeline.leadTimesS.length + " values", unplugged: undefined }, null, 2));
for (const [id, u] of Object.entries(unplugged)) {
  console.log(`unplugged ${id.padEnd(10)} room accuracy ${(u.accuracy * 100).toFixed(1)}% (${(u.accuracyUnmasked * 100).toFixed(1)}% without masking)`);
}
