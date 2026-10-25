import { appendFileSync } from "node:fs";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import os from "os";
import { forgetReceiver, forwardReading, placeReceiver, syncPlacements } from "@/lib/sensing/monitor-sync";
import { db, HOUSEHOLD_ID } from "@/lib/supabase/server";

// Caregiver placement and the live trail: which device is in which room,
// the latest dBm, and a line each time the phone's room changes.

function agentLog(hypothesisId: string, location: string, message: string, data: Record<string, unknown>) {
  // #region agent log
  const line = JSON.stringify({ sessionId: "aae308", hypothesisId, location, message, data, timestamp: Date.now() }) + "\n";
  try { appendFileSync("debug-aae308.log", line); } catch { /* ingest copy still records it */ }
  fetch("http://127.0.0.1:7903/ingest/78803543-27d2-4cbb-972a-636f029ea059", { method: "POST", headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "aae308" }, body: JSON.stringify({ sessionId: "aae308", hypothesisId, location, message, data, timestamp: Date.now() }) }).catch(() => {});
  // #endregion
}

const SLUG = /^[a-z0-9][a-z0-9-]{0,40}$/i;
const HEAR_FRESH_MS = 5000;

// Supabase holds each laptop's latest dBm so every Tracking page reads the same hub.
// This process keeps a copy for the moment between a reading and the database write.
type Ear = { rssi: number; at: number };
type JoinSlot = {
  ears: Map<string, Ear>;
  seenWrite: Map<string, number>;
  wanted: Map<string, number>;
};

function slot(): JoinSlot {
  const g = globalThis as typeof globalThis & { __lanternJoin?: JoinSlot };
  g.__lanternJoin ??= { ears: new Map(), seenWrite: new Map(), wanted: new Map() };
  g.__lanternJoin.wanted ??= new Map();
  return g.__lanternJoin;
}

type EarProc = { proc: ChildProcess | null; id: string | null };

function earProc(): EarProc {
  const g = globalThis as typeof globalThis & { __lanternEarProc?: EarProc };
  g.__lanternEarProc ??= { proc: null, id: null };
  return g.__lanternEarProc;
}

function stopEar() {
  const running = earProc();
  const pid = running.proc?.pid;
  if (pid && process.platform === "win32") {
    spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  } else {
    running.proc?.kill();
  }
  running.proc = null;
  running.id = null;
}

function earPostUrl(request: Request, clientProtocol?: string): string {
  const url = new URL(request.url);
  const startedHttps = process.argv.some((arg) => arg.includes("experimental-https")) || process.env.npm_lifecycle_event === "dev:https";
  const https = clientProtocol === "https:" || (clientProtocol !== "http:" && (url.protocol === "https:" || startedHttps));
  const port = url.port || process.env.PORT || "3000";
  return `${https ? "https" : "http"}://127.0.0.1:${port}/api/tracking`;
}

function requestFromHub(request: Request): boolean {
  const host = (request.headers.get("host") ?? "").trim().toLowerCase();
  const name = host.startsWith("[") ? host.slice(1, host.indexOf("]")) : host.split(":")[0];
  return name === "localhost" || name === "127.0.0.1" || name === "::1";
}

const PYTHON = process.platform === "win32" ? "py" : "python3";

function startEar(deviceId: string, postUrl: string): Promise<boolean> {
  stopEar();
  return new Promise((resolve) => {
    let proc: ChildProcess;
    try {
      proc = spawn(
        PYTHON,
        ["-u", "listener/listener.py", "--id", deviceId, "--post", postUrl, "--min-interval", "0.8"],
        { cwd: process.cwd(), windowsHide: true, stdio: "ignore" },
      );
    } catch {
      resolve(false);
      return;
    }
    const running = earProc();
    running.proc = proc;
    running.id = deviceId;
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    proc.once("error", () => finish(false));
    proc.once("exit", () => finish(false));
    setTimeout(() => finish(proc.exitCode == null && !proc.killed), 700);
  });
}

function shareUrl(): string {
  const port = process.env.PORT || "3000";
  const found: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.family === "IPv4" && !net.internal) found.push(net.address);
    }
  }
  // 172.28 is a virtual adapter on this laptop. Other devices cannot open it.
  const reachable = found.filter((ip) => !ip.startsWith("172.28."));
  const host =
    reachable.find((ip) => ip.startsWith("192.168.")) ||
    reachable.find((ip) => ip.startsWith("172.20.10.")) ||
    reachable.find((ip) => ip.startsWith("10.")) ||
    reachable[0] ||
    "localhost";
  return `https://${host}:${port}/dashboard/tracking`;
}

export async function GET() {
  const now = Date.now();
  const share = shareUrl();
  if (!db) {
    const devices = [...slot().ears.entries()].map(([id, ear]) => ({
      id,
      rssi: ear.rssi,
      ageMs: now - ear.at,
      online: now - ear.at < HEAR_FRESH_MS,
    }));
    return Response.json({ devices, receivers: [], shareUrl: share, wanted: [...slot().wanted.keys()] });
  }
  const { data } = await db.from("receivers").select("id, label, room_id, last_rssi, last_rssi_at, last_seen_at").eq("household_id", HOUSEHOLD_ID);
  // the monitor stands each laptop that reported in the last 5 min in its room
  if (data) void syncPlacements(data.map((r) => ({ id: r.id as string, label: r.label as string | null, room_id: r.room_id as string | null, online: !!r.last_seen_at && Date.now() - Date.parse(r.last_seen_at as string) < 5 * 60_000 })), { all: true });
  const latest = new Map<string, { rssi: number; at: number }>();
  for (const row of data ?? []) {
    if (typeof row.last_rssi !== "number" || !row.last_rssi_at) continue;
    latest.set(row.id as string, { rssi: row.last_rssi as number, at: new Date(row.last_rssi_at as string).getTime() });
  }
  for (const [id, ear] of slot().ears) {
    const saved = latest.get(id);
    if (!saved || ear.at > saved.at) latest.set(id, ear);
  }
  const devices = [...latest.entries()].map(([id, ear]) => ({
    id,
    rssi: ear.rssi,
    ageMs: now - ear.at,
    online: now - ear.at < HEAR_FRESH_MS && ear.rssi > -100,
  }));
  const receivers = (data ?? []).map((r) => ({ id: r.id as string, label: r.label as string, roomId: (r.room_id as string | null) ?? "" }));
  const wanted = [...slot().wanted.keys()].filter((id) => {
    const ear = latest.get(id);
    return !ear || now - ear.at >= HEAR_FRESH_MS;
  });
  return Response.json({ devices, receivers, shareUrl: share, wanted });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return Response.json({ error: "Bad request." }, { status: 400 });

  if (!db) return Response.json({ error: "Supabase is not configured." }, { status: 503 });
  if (body.action === "view") {
    // #region agent log
    agentLog("A", "route.ts:view", "page view", { error: typeof body.error === "string" ? body.error.slice(0, 180) : "", protocol: body.protocol === "https:" || body.protocol === "http:" ? body.protocol : "" });
    // #endregion
    return Response.json({ ok: true });
  }
  if (body.action === "join") return join(body, request);
  if (body.action === "want") return want(body);
  if (body.action === "hear") return hear(body);
  if (body.action === "place") return place(body);
  if (body.action === "remove") return remove(body);
  if (body.action === "sample") return sample(body);
  return Response.json({ error: "Unknown action." }, { status: 400 });
}

function cleanName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const name = raw.replace(/\s+/g, " ").trim();
  if (name.length < 1 || name.length > 40) return "";
  if (/[\u0000-\u001F\u007F]/.test(name)) return "";
  return name;
}

function quiet(at: string | null): boolean {
  if (!at) return true;
  return Date.now() - new Date(at).getTime() > 15000;
}

function scannerPids(): Promise<{ pid: number; id: string | null }[]> {
  if (process.platform !== "win32") return Promise.resolve([]);
  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-Command", "Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | Where-Object { $_.CommandLine -match 'listener\\.py' } | ForEach-Object { $_.ProcessId.ToString() + '|' + $_.CommandLine }"],
      { windowsHide: true, timeout: 8000 },
      (err, stdout) => {
        if (err) return resolve([]);
        resolve(
          String(stdout)
            .split(/\r?\n/)
            .map((line) => {
              const bar = line.indexOf("|");
              if (bar < 1) return { pid: 0, id: null };
              const pid = Number(line.slice(0, bar));
              const cmd = line.slice(bar + 1);
              const id = /--id\s+(ear-[a-f0-9]{8})/i.exec(cmd)?.[1]?.toLowerCase() ?? null;
              return { pid, id };
            })
            .filter((row) => row.pid > 0),
        );
      },
    );
  });
}

function killPid(pid: number): Promise<void> {
  return new Promise((resolve) => {
    if (process.platform === "win32") {
      execFile("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true }, () => resolve());
    } else {
      try { process.kill(pid, "SIGTERM"); } catch { /* already gone */ }
      resolve();
    }
  });
}

// One Windows radio can scan as one laptop. Pairing a different laptop switches the radio to that name.
async function listenHere(receiverId: string, replace: boolean, postUrl: string): Promise<boolean> {
  const running = earProc();
  const scanners = await scannerPids();
  const ids = scanners.map((row) => row.id);
  // #region agent log
  agentLog("B", "route.ts:listenHere", "scanner check", { receiverId, replace, scanners: ids, tracked: running.id });
  // #endregion
  const already = ids.includes(receiverId) || (running.id === receiverId && !!running.proc && running.proc.exitCode == null);
  if (already && !replace) return true;
  if (!replace && (ids.length > 0 || running.id)) return false;
  for (const row of scanners) {
    if (row.id !== receiverId) await killPid(row.pid);
  }
  if (running.proc?.pid && running.id !== receiverId) await killPid(running.proc.pid);
  if (already) return true;
  const started = await startEar(receiverId, postUrl);
  // #region agent log
  agentLog("B", "route.ts:listenHere", "scanner started", { receiverId, started });
  // #endregion
  return started;
}

async function want(body: { deviceId?: string }) {
  const deviceId = (body.deviceId ?? "").trim();
  if (!SLUG.test(deviceId)) return Response.json({ error: "Unknown device." }, { status: 400 });
  const { data } = await db!.from("receivers").select("id").eq("id", deviceId).eq("household_id", HOUSEHOLD_ID).maybeSingle();
  if (!data) return Response.json({ error: "Unknown device." }, { status: 404 });
  slot().wanted.set(deviceId, Date.now());
  // #region agent log
  agentLog("B", "route.ts:want", "laptop wanted", { deviceId });
  // #endregion
  return Response.json({ ok: true, deviceId });
}

async function join(body: { name?: string; deviceId?: string; listen?: boolean; hub?: boolean; replace?: boolean; protocol?: string }, request: Request) {
  const label = cleanName(body.name);
  if (!label) return Response.json({ error: "Type a name." }, { status: 400 });

  const requested = (body.deviceId ?? "").trim();
  let receiverId = "";
  if (SLUG.test(requested)) {
    const { data } = await db!.from("receivers").select("id").eq("id", requested).eq("household_id", HOUSEHOLD_ID).maybeSingle();
    if (data) receiverId = requested;
  }
  if (!receiverId) {
    const { data: rows } = await db!.from("receivers").select("id, label, last_rssi_at").eq("household_id", HOUSEHOLD_ID).like("id", "ear-%");
    const same = (rows ?? []).find((r) => String(r.label ?? "").toLowerCase() === label.toLowerCase() && quiet(r.last_rssi_at as string | null));
    if (same) receiverId = same.id as string;
  }
  if (!receiverId) {
    receiverId = /^ear-[a-f0-9]{8}$/i.test(requested)
      ? requested.toLowerCase()
      : `ear-${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
  }

  const { error } = await db!.from("receivers").upsert(
    { id: receiverId, household_id: HOUSEHOLD_ID, room_id: null, label, last_seen_at: new Date().toISOString() },
    { onConflict: "id" },
  );
  if (error) {
    console.error("Could not save a laptop:", error.message);
    return Response.json({ error: "Could not save that device." }, { status: 500 });
  }
  void syncPlacements([{ id: receiverId, label, room_id: null, online: true }], { force: true });
  const clientProtocol = body.protocol === "https:" || body.protocol === "http:" ? body.protocol : undefined;
  const listening = body.listen && body.hub && requestFromHub(request) ? await listenHere(receiverId, !!body.replace, earPostUrl(request, clientProtocol)) : false;
  return Response.json({ ok: true, deviceId: receiverId, label, listening });
}

async function hear(body: { deviceId?: string; rssi?: number }) {
  const deviceId = (body.deviceId ?? "").trim();
  const rssi = body.rssi;
  if (!SLUG.test(deviceId) || typeof rssi !== "number" || !Number.isFinite(rssi) || rssi <= -100 || rssi > 20) {
    // #region agent log
    agentLog("D", "route.ts:hear", "hear rejected", { deviceId, rssiType: typeof rssi });
    // #endregion
    return Response.json({ error: "Unknown device." }, { status: 400 });
  }

  const { data } = await db!.from("receivers").select("id").eq("id", deviceId).eq("household_id", HOUSEHOLD_ID).maybeSingle();
  if (!data) {
    // #region agent log
    agentLog("D", "route.ts:hear", "hear unknown laptop", { deviceId });
    // #endregion
    return Response.json({ error: "Unknown device." }, { status: 404 });
  }

  const now = Date.now();
  const rounded = Math.round(rssi);
  forwardReading(deviceId, rounded); // the monitor moves the dot on the plan from these
  slot().ears.set(deviceId, { rssi: rounded, at: now });
  slot().wanted.delete(deviceId);
  // #region agent log
  const heardLog = (globalThis as typeof globalThis & { __lanternHeardLog?: Map<string, number> }).__lanternHeardLog ?? new Map<string, number>();
  (globalThis as typeof globalThis & { __lanternHeardLog?: Map<string, number> }).__lanternHeardLog = heardLog;
  const prevLog = heardLog.get(deviceId) ?? 0;
  if (now - prevLog > 10000) {
    heardLog.set(deviceId, now);
    agentLog("C", "route.ts:hear", "signal saved", { deviceId, rssi: rounded });
  }
  // #endregion
  const last = slot().seenWrite.get(deviceId) ?? 0;
  if (now - last >= 1000) {
    slot().seenWrite.set(deviceId, now);
    const { error } = await db!.from("receivers").update({
      last_rssi: rounded,
      last_rssi_at: new Date(now).toISOString(),
      last_seen_at: new Date(now).toISOString(),
    }).eq("id", deviceId).eq("household_id", HOUSEHOLD_ID);
    if (error) {
      console.error("Could not save a laptop signal:", error.message);
      return Response.json({ error: "Could not save that signal." }, { status: 500 });
    }
  }
  return Response.json({ ok: true });
}

async function place(body: { receiverId?: string; roomId?: string; label?: string }) {
  const receiverId = (body.receiverId ?? "").trim();
  const roomId = (body.roomId ?? "").trim();
  if (!SLUG.test(receiverId)) return Response.json({ error: "Use a short device name, like bedroom." }, { status: 400 });

  const { data: room } = await db!.from("rooms").select("id, name").eq("id", roomId).eq("household_id", HOUSEHOLD_ID).maybeSingle();
  if (!room) return Response.json({ error: "Pick a room in this home." }, { status: 400 });

  const label = (body.label ?? "").trim() || `${room.name} device`;
  const { error } = await db!.from("receivers").upsert(
    { id: receiverId, household_id: HOUSEHOLD_ID, room_id: roomId, label, last_seen_at: new Date().toISOString() },
    { onConflict: "id" },
  );
  if (error) return Response.json({ error: "Could not save that device." }, { status: 500 });
  void placeReceiver(receiverId, { roomId, roomName: room.name as string });
  return Response.json({ ok: true, receiver: { id: receiverId, label, roomId } });
}

async function remove(body: { receiverId?: string }) {
  const receiverId = (body.receiverId ?? "").trim();
  if (!SLUG.test(receiverId)) return Response.json({ error: "Unknown device." }, { status: 400 });

  const { error: samplesError } = await db!.from("rssi_samples").delete().eq("receiver_id", receiverId).eq("household_id", HOUSEHOLD_ID);
  if (samplesError) return Response.json({ error: "Could not remove that device." }, { status: 500 });

  const { error } = await db!.from("receivers").delete().eq("id", receiverId).eq("household_id", HOUSEHOLD_ID);
  if (error) return Response.json({ error: "Could not remove that device." }, { status: 500 });
  slot().ears.delete(receiverId);
  slot().seenWrite.delete(receiverId);
  slot().wanted.delete(receiverId);
  if (earProc().id === receiverId) stopEar();
  forgetReceiver(receiverId);
  return Response.json({ ok: true });
}

async function sample(body: { readings?: { id: string; rssi: number }[]; roomId?: string; prevRoomId?: string | null; from?: string; to?: string; trueRoomId?: string }) {
  const readings = (body.readings ?? []).filter((r) => SLUG.test(r.id) && Number.isFinite(r.rssi) && r.rssi > -100);
  const now = new Date().toISOString();

  for (const r of readings) {
    await db!.from("receivers").update({ last_seen_at: now }).eq("id", r.id).eq("household_id", HOUSEHOLD_ID);
  }

  const { data: beacon } = await db!.from("beacons").select("id").eq("household_id", HOUSEHOLD_ID).limit(1).maybeSingle();
  if (beacon && readings.length > 0) {
    const { data: known } = await db!.from("receivers").select("id").eq("household_id", HOUSEHOLD_ID).in("id", readings.map((r) => r.id));
    const placed = new Set((known ?? []).map((r) => r.id));
    // A training label is where the PERSON is, which only a human knows. The listener's own room is not a label:
    // the phone in the hallway is heard by the bedroom laptop too. So these live readings stay unlabeled unless the
    // caller says where the phone really is (trueRoomId); labeled data comes from the monitor's /calibrate/* routes.
    const trueRoom = typeof body.trueRoomId === "string" && SLUG.test(body.trueRoomId) ? body.trueRoomId : null;
    const rows = readings
      .filter((r) => placed.has(r.id))
      .map((r) => ({
        household_id: HOUSEHOLD_ID,
        receiver_id: r.id,
        beacon_id: beacon.id,
        rssi: Math.round(r.rssi),
        label_room_id: trueRoom,
        ts: now,
      }));
    if (rows.length > 0) await db!.from("rssi_samples").insert(rows);
  }

  const roomId = body.roomId;
  const prev = body.prevRoomId || null;
  if (roomId && roomId !== prev && body.to) {
    await db!.from("location_events").insert({
      household_id: HOUSEHOLD_ID,
      room_id: roomId,
      prev_room_id: prev,
      confidence: 0.8,
      source: "ble",
      ts: now,
    });
    await db!.from("activity").insert({
      household_id: HOUSEHOLD_ID,
      kind: "move",
      text: body.from ? `${body.from} → ${body.to}` : `In the ${body.to}`,
      ts: now,
    });
  }

  return Response.json({ ok: true });
}
