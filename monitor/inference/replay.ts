// Replay an RSSI CSV (the shared format, as in fixtures/rssi-samples.fake.csv) through the engine, like Saran's raw replay, and score it
// against the CSV's room labels. Used by tools/vineet-replay.ts and the tests.

import type { HomeModel, PositionEstimate } from "@/lib/types";
import { adjacency } from "@/lib/world/geometry";
import type { InferenceEngine } from "./engine";

export interface CsvRow { session: string; ts: number; roomId: string; x?: number; y?: number; rssi: number[] }
export interface SessionLine { k: "frame" | "position" | "location" | "prediction"; ts: number; d: unknown }

const META = ["session", "ts", "roomId", "x", "y"];
const RISKY_KINDS = ["kitchen", "front-door"]; // where a night visit would trigger a redirect

export function parseRssiCsv(text: string): { order: string[]; rows: CsvRow[] } {
  const [head, ...lines] = text.trim().split(/\r?\n/);
  const cols = head.split(",");
  const order = cols.filter((c) => !META.includes(c));
  const at = (name: string) => cols.indexOf(name);
  const rows = lines.map((line) => {
    const v = line.split(",");
    const num = (i: number) => (i >= 0 && v[i] !== "" ? Number(v[i]) : undefined);
    return {
      session: v[at("session")], ts: Number(v[at("ts")]), roomId: v[at("roomId")],
      x: num(at("x")), y: num(at("y")), rssi: order.map((c) => Number(v[at(c)])),
    };
  });
  return { order, rows };
}

export function bySession(rows: CsvRow[]): Map<string, CsvRow[]> {
  const out = new Map<string, CsvRow[]>();
  for (const r of rows) out.set(r.session, [...(out.get(r.session) ?? []), r]);
  for (const list of out.values()) list.sort((a, b) => a.ts - b.ts);
  return out;
}

export interface Replay { lines: SessionLine[]; tracked: (string | undefined)[]; positions: { p: PositionEstimate; frame: number }[] }

// One frame per row, then `ticks` position updates spread over the following second (5 Hz).
// `offline` replays as if those listeners were unplugged: no readings, and marked offline like Saran's heartbeat does.
export function replay(engine: InferenceEngine, order: string[], rows: CsvRow[], opts: { ticks?: number; offline?: string[] } = {}): Replay {
  const out: Replay = { lines: [], tracked: [], positions: [] };
  const ticks = opts.ticks ?? 5, off = new Set(opts.offline ?? []);
  const online = Object.fromEntries(order.map((id) => [id, !off.has(id)]));
  rows.forEach((r, i) => {
    const frame = { ts: r.ts, order, rssi: r.rssi.map((v, j) => (off.has(order[j]) ? -100 : v)), online };
    out.lines.push({ k: "frame", ts: r.ts, d: frame });
    for (const e of engine.onFrame(frame)) out.lines.push({ k: e.k, ts: r.ts, d: e.d });
    out.tracked.push(engine.room);
    for (let t = 0; t < ticks; t++) {
      const p = engine.tick(r.ts + (t * 1000) / ticks);
      if (p) { out.positions.push({ p, frame: i }); out.lines.push({ k: "position", ts: p.ts, d: p }); }
    }
  });
  return out;
}

export interface Score {
  frames: number; correct: number; roomChanges: number; trueRoomChanges: number; impossibleJumps: number;
  delaysMs: number[]; predictions: number; predictionsCorrect: number; leadTimesS: number[];
  falseRedirects: number; positionErrorsIn: number[]; centerErrorsIn: number[]; // centerErrors: avatar parked mid-room
}

export function score(home: HomeModel, rows: CsvRow[], r: Replay): Score {
  const adj = adjacency(home);
  const kind = Object.fromEntries(home.rooms.map((x) => [x.id, x.kind]));
  const s: Score = { frames: 0, correct: 0, roomChanges: 0, trueRoomChanges: 0, impossibleJumps: 0, delaysMs: [],
    predictions: 0, predictionsCorrect: 0, leadTimesS: [], falseRedirects: 0, positionErrorsIn: [], centerErrorsIn: [] };
  const indexAt = (ts: number) => { let i = 0; while (i + 1 < rows.length && rows[i + 1].ts <= ts) i++; return i; };
  const locations = r.lines.filter((l) => l.k === "location").map((l) => ({ ts: l.ts, d: l.d as { roomId: string; prevRoomId?: string } }));

  r.tracked.forEach((room, i) => { if (room) { s.frames++; if (room === rows[i].roomId) s.correct++; } });

  for (const l of locations) {
    s.roomChanges++;
    if (l.d.prevRoomId && !adj[l.d.prevRoomId]?.includes(l.d.roomId)) s.impossibleJumps++;
    if (RISKY_KINDS.includes(kind[l.d.roomId]) && rows[indexAt(l.ts)].roomId !== l.d.roomId) s.falseRedirects++;
  }

  for (let i = 1; i < rows.length; i++) {
    if (rows[i].roomId === rows[i - 1].roomId) continue;
    s.trueRoomChanges++;
    const hit = locations.find((l) => l.d.roomId === rows[i].roomId && l.ts >= rows[i].ts - 2000 && l.ts <= rows[i].ts + 15000);
    if (hit) s.delaysMs.push(Math.max(0, hit.ts - rows[i].ts));
  }

  // A prediction is right when the room the person really goes to next, after the room it was made in, matches
  for (const l of r.lines.filter((x) => x.k === "prediction")) {
    const p = l.d as { fromRoomId: string; nextRoomId: string };
    s.predictions++;
    let i = indexAt(l.ts);
    while (i > 0 && rows[i].roomId !== p.fromRoomId) i--;
    if (rows[i].roomId !== p.fromRoomId) continue;
    let j = i;
    while (j < rows.length && rows[j].roomId === p.fromRoomId) j++;
    if (j < rows.length && rows[j].roomId === p.nextRoomId) {
      s.predictionsCorrect++;
      s.leadTimesS.push(Math.round((rows[j].ts - l.ts) / 100) / 10);
    }
  }

  for (const { p, frame } of r.positions) {
    const t = rows[frame];
    if (t.x === undefined || t.y === undefined) continue;
    s.positionErrorsIn.push(Math.hypot(p.x - t.x, p.y - t.y));
    const c = home.rooms.find((x) => x.id === p.roomId)?.centroid;
    if (c) s.centerErrorsIn.push(Math.hypot(c.x - t.x, c.y - t.y));
  }
  return s;
}

export const median = (v: number[]) => {
  if (!v.length) return 0;
  const s = [...v].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
