// Replay a recorded session (fixtures/sessions/<id>.jsonl, written by /record/start) back through the monitor.
//
// POST /replay/start {session, speed?, mode?}  mode "live" (default) re-emits what the pipeline concluded (position,
//                                             location, prediction, risk, patient), so /ws/live, the 3D view and the
//                                             dashboard see the night again. mode "raw" re-emits only the recorded
//                                             SensorFrames, so inference and the responder run again on real data.
// POST /replay/stop
// GET  /replay/status
//
// Timestamps are rebased to now so the receivers treat the events as fresh. Replayed BLE events are marked
// source "sim" so the UI shows SIMULATED, and the sim lock keeps live BLE from fighting the replay.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { BusEvents } from "@/lib/types";
import type { BusEvent } from "../bus";
import { HttpError, type ModuleCtx } from "../module";

type Line = { k: string; ts: number; d: Record<string, unknown> };
const LIVE_EVENTS = new Set<BusEvent>(["position", "location", "prediction", "risk", "patient"]);

export function readSession(id: string, dir = process.env.SESSIONS_DIR ?? "fixtures/sessions"): Line[] {
  if (!/^[\w.-]+$/.test(id)) throw new HttpError(400, "bad session id");
  let text: string;
  try {
    text = readFileSync(join(dir, `${id}.jsonl`), "utf8");
  } catch {
    throw new HttpError(404, `no session ${id} in ${dir}`);
  }
  return text
    .split("\n")
    .flatMap((raw) => {
      try {
        const l = JSON.parse(raw) as Line;
        return typeof l.k === "string" && typeof l.ts === "number" ? [l] : [];
      } catch {
        return [];
      }
    })
    .sort((a, b) => a.ts - b.ts);
}

// Shift one recorded payload to "now": every timestamp field moves by the same offset.
export function rebasePayload(k: string, d: Record<string, unknown>, shiftMs: number): Record<string, unknown> {
  const out: Record<string, unknown> = { ...d };
  if (typeof d.ts === "number") out.ts = d.ts + shiftMs;
  if (typeof d.ts === "string") out.ts = new Date(Date.parse(d.ts) + shiftMs).toISOString();
  for (const key of ["startedAt", "resolvedAt", "predictedAt", "arrivedAt", "updatedAt"]) {
    if (typeof d[key] === "string") out[key] = new Date(Date.parse(d[key] as string) + shiftMs).toISOString();
  }
  if ((k === "position" || k === "location") && out.source === "ble") out.source = "sim";
  return out;
}

export function registerReplay(ctx: ModuleCtx) {
  let timers: ReturnType<typeof setTimeout>[] = [];
  let running: { session: string; mode: "live" | "raw"; speed: number; events: number; startedAt: number; durationMs: number } | undefined;

  const stop = () => {
    timers.forEach(clearTimeout);
    timers = [];
    running = undefined;
    ctx.store.replaying = undefined;
  };

  ctx.http.post("/replay/start", ({ body }) => {
    const b = (body ?? {}) as Record<string, unknown>;
    if (typeof b.session !== "string") throw new HttpError(400, "session is required (the file name without .jsonl)");
    const speed = typeof b.speed === "number" && b.speed > 0 && b.speed <= 16 ? b.speed : 1;
    const mode = b.mode === "raw" ? "raw" : "live";
    const lines = readSession(b.session).filter((l) => (mode === "raw" ? l.k === "frame" : LIVE_EVENTS.has(l.k as BusEvent)));
    if (lines.length === 0) throw new HttpError(400, `session ${b.session} has no ${mode === "raw" ? "frame" : "pipeline"} events`);

    stop();
    const t0 = lines[0].ts;
    const start = Date.now();
    for (const l of lines) {
      const delay = (l.ts - t0) / speed;
      timers.push(
        setTimeout(() => {
          // Same moment in the replay, now on the wall clock.
          const shift = start + delay - l.ts;
          ctx.bus.emit(l.k as BusEvent, rebasePayload(l.k, l.d, shift) as unknown as BusEvents[BusEvent]);
        }, delay),
      );
    }
    const durationMs = (lines[lines.length - 1].ts - t0) / speed;
    // While this runs, the actions module ignores the bus: a replay must never text, call or wake the TV for real.
    ctx.store.replaying = b.session;
    timers.push(setTimeout(stop, durationMs + 50));
    timers.forEach((t) => t.unref?.());
    running = { session: b.session, mode, speed, events: lines.length, startedAt: start, durationMs };
    ctx.log("replay", `${b.session} (${mode}, ${speed}x, ${lines.length} events, ${Math.round(durationMs / 1000)} s)`);
    return running;
  });

  ctx.http.post("/replay/stop", () => {
    const was = running?.session;
    stop();
    return { stopped: was ?? null };
  });

  ctx.http.get("/replay/status", () => (running ? { ...running, elapsedMs: Date.now() - running.startedAt } : { running: false }));
}
