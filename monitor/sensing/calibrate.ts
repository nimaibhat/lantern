// Calibration (PROJECT_PLAN Part 3 step 6): stand in a room with the tag and record labeled RSSI for the classifier.
//
// POST /calibrate/start {roomId, x?, y?, session?}  start (or relabel) a session; the label is where the PERSON is
// POST /calibrate/stop                             end it
// GET  /calibrate/status                           active session and windows recorded per room
//
// Each 1 s SensorFrame while a session runs becomes one row of fixtures/rssi-samples.csv (the format in plan 1.5,
// which ml/train.py reads) and, when Supabase is configured, one labeled rssi_samples row per receiver.
// Protocol: 2 minutes per room, walking slowly inside it; 3 separate sessions per room on different runs.

import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { SensorFrame } from "@/lib/types";
import { HttpError, type ModuleCtx } from "../module";

const NO_READING = -100;

export const csvHeader = (order: string[]) => ["session", "ts", "roomId", "x", "y", ...order].join(",");

// One frame as one CSV line. Coordinates are empty unless the sample was taken on a known floor point.
export function csvLine(session: string, roomId: string, f: SensorFrame, x?: number, y?: number) {
  return [session, f.ts, roomId, x ?? "", y ?? "", ...f.rssi.map((v) => Math.round(v * 10) / 10)].join(",");
}

// A frame where no listener heard the tag teaches the classifier nothing; skip it.
export const heardAnything = (f: SensorFrame) => f.rssi.some((v) => v > NO_READING);

// The CSV must keep one column order. If the file already exists with other receivers, start a new file.
export function csvPathFor(base: string, header: string, session: string): string {
  if (!existsSync(base)) return base;
  const first = readFileSync(base, "utf8").split("\n", 1)[0];
  return first === header ? base : base.replace(/\.csv$/, `-${session}.csv`);
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

function supabase(): SupabaseClient | undefined {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? createClient(url, key, { auth: { persistSession: false } }) : undefined;
}

export function registerCalibration(ctx: ModuleCtx, opts: { csvPath?: string } = {}) {
  const base = opts.csvPath ?? process.env.RSSI_CSV_PATH ?? "fixtures/rssi-samples.csv";
  const db = supabase();
  let active: { session: string; roomId: string; x?: number; y?: number; file: string; beaconId?: string } | undefined;
  const counts: Record<string, number> = {};

  // rssi_samples rows need a beacon id; the tag phone is the household's first beacon (created if missing).
  async function beaconId(): Promise<string | undefined> {
    if (!db) return;
    const { data } = await db.from("beacons").select("id").eq("household_id", ctx.cfg.householdId).limit(1).maybeSingle();
    if (data?.id) return data.id as string;
    const id = "tag-1";
    const { error } = await db.from("beacons").upsert({ id, household_id: ctx.cfg.householdId, label: "LanternTag" });
    return error ? undefined : id;
  }

  ctx.bus.on("frame", (f) => {
    if (!active || !heardAnything(f)) return;
    const { session, roomId, x, y, file } = active;
    if (!existsSync(file)) writeFileSync(file, csvHeader(f.order) + "\n");
    appendFileSync(file, csvLine(session, roomId, f, x, y) + "\n");
    counts[roomId] = (counts[roomId] ?? 0) + 1;

    if (db && active.beaconId) {
      const ts = new Date(f.ts).toISOString();
      const rows = f.order
        .map((receiverId, i) => ({ receiverId, rssi: f.rssi[i] }))
        .filter((r) => r.rssi > NO_READING)
        .map((r) => ({
          household_id: ctx.cfg.householdId,
          receiver_id: r.receiverId,
          beacon_id: active!.beaconId,
          rssi: Math.round(r.rssi),
          session,
          x: x ?? null,
          y: y ?? null,
          ts,
        }));
      // Best effort: the CSV is the source of truth for training; a failed insert only loses the copy.
      void db.from("rssi_samples").insert(rows).then(({ error }) => error && ctx.log("calibrate", "supabase insert failed:", error.message));
    }
  });

  ctx.http.post("/calibrate/start", async ({ body }) => {
    const roomId = field(body, "roomId");
    if (typeof roomId !== "string" || !ctx.world().rooms.some((r) => r.id === roomId)) {
      throw new HttpError(400, `roomId must be one of ${ctx.world().rooms.map((r) => r.id).join(", ")}`);
    }
    const x = num(field(body, "x")), y = num(field(body, "y"));
    const requested = field(body, "session");
    // Relabel within the running session (a test route walks several rooms in one session).
    if (active && (requested === undefined || requested === active.session)) {
      active = { ...active, roomId, x, y };
      ctx.log("calibrate", `${active.session}: now in ${roomId}`);
      return { session: active.session, roomId, relabeled: true };
    }
    const session = typeof requested === "string" && /^[\w-]{1,60}$/.test(requested)
      ? requested
      : `${roomId}-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}`;
    const order = ctx.world().anchors.map((a) => a.receiverId).sort();
    active = { session, roomId, x, y, file: csvPathFor(base, csvHeader(order), session), beaconId: await beaconId() };
    ctx.log("calibrate", `started ${session} in ${roomId} -> ${active.file}${db ? " + supabase" : ""}`);
    return { session, roomId, file: active.file };
  });

  ctx.http.post("/calibrate/stop", () => {
    if (!active) throw new HttpError(409, "not calibrating");
    const done = active;
    active = undefined;
    ctx.log("calibrate", `stopped ${done.session}`);
    return { session: done.session, file: done.file, windowsPerRoom: { ...counts } };
  });

  ctx.http.get("/calibrate/status", () => ({
    active: active ? { session: active.session, roomId: active.roomId, file: active.file } : null,
    windowsPerRoom: { ...counts },
    target: 120, // about 2 minutes of 1 s windows per room, per session
  }));
}
