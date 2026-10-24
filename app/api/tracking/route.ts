import { appendFileSync } from "node:fs";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import http from "node:http";
import os from "os";
import { db, HOUSEHOLD_ID } from "@/lib/supabase/server";

function agentLog(hypothesisId: string, location: string, message: string, data: Record<string, unknown>) {
  // #region agent log
  const line = JSON.stringify({ sessionId: "aae308", hypothesisId, location, message, data, timestamp: Date.now() }) + "\n";
  try { appendFileSync("debug-aae308.log", line); } catch { /* the ingest copy below still records it */ }
  fetch("http://127.0.0.1:7903/ingest/78803543-27d2-4cbb-972a-636f029ea059", { method: "POST", headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "aae308" }, body: JSON.stringify({ sessionId: "aae308", hypothesisId, location, message, data, timestamp: Date.now() }) }).catch(() => {});
  // #endregion
}

let lastSnap = 0;

// Caregiver placement and the live trail: which device is in which room,
// the latest dBm, and a line each time the phone's room changes.

const SLUG = /^[a-z0-9][a-z0-9-]{0,40}$/i;
const HEAR_FRESH_MS = 5000;

// Supabase holds each laptop's latest dBm so every Tracking page reads the same hub.
// This process keeps a copy for the moment between a reading and the database write.
type Ear = { rssi: number; at: number };
type JoinSlot = {
  ears: Map<string, Ear>;
  seenWrite: Map<string, number>;
};

function slot(): JoinSlot {
  const g = globalThis as typeof globalThis & { __lanternJoin?: JoinSlot };
  g.__lanternJoin ??= { ears: new Map(), seenWrite: new Map() };
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

function startEar(deviceId: string): Promise<boolean> {
  stopEar();
  const port = process.env.PORT || "3000";
  return new Promise((resolve) => {
    let proc: ChildProcess;
    try {
      proc = spawn(
        "py",
        ["-u", "listener/listener.py", "--id", deviceId, "--post", `https://127.0.0.1:${port}/api/tracking`, "--min-interval", "0.8"],
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

// The page asks 127.0.0.1:3010 so only the computer running the hub starts the scanner here.
function startProbe() {
  const g = globalThis as typeof globalThis & { __lanternProbe?: boolean };
  if (g.__lanternProbe) return;
  g.__lanternProbe = true;
  const server = http.createServer((req, res) => {
    const origin = req.headers.origin || "*";
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Private-Network", "true");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Vary", "Origin");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
  });
  server.on("error", () => {});
  server.listen(3010, "127.0.0.1");
}
startProbe();

function shareUrl(): string {
  const port = process.env.PORT || "3000";
  const found: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.family === "IPv4" && !net.internal) found.push(net.address);
    }
  }
  const host = found.find((ip) => ip.startsWith("192.168.")) || found.find((ip) => ip.startsWith("10.")) || found[0] || "localhost";
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
    return Response.json({ devices, receivers: [], shareUrl: share });
  }
  const { data } = await db.from("receivers").select("id, label, room_id, last_rssi, last_rssi_at").eq("household_id", HOUSEHOLD_ID);
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
  const snapAt = Date.now();
  if (snapAt - lastSnap >= 3000) {
    lastSnap = snapAt;
    agentLog("C", "app/api/tracking/route.ts:GET", "hub snapshot", {
      receivers: receivers.filter((r) => r.id.startsWith("ear-")).map((r) => r.label),
      devices: devices.map((d) => ({ id: d.id, rssi: d.rssi, ageMs: d.ageMs, online: d.online })),
    });
  }
  return Response.json({ devices, receivers, shareUrl: share });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return Response.json({ error: "Bad request." }, { status: 400 });

  if (!db) return Response.json({ error: "Supabase is not configured." }, { status: 503 });
  if (body.action === "join") return join(body);
  if (body.action === "hear") return hear(body);
  if (body.action === "view") {
    agentLog("H1", "app/api/tracking/route.ts:view", "page view", {
      hub: !!body.hub,
      hostLocal: !!body.hostLocal,
      pairShown: !!body.pairShown,
      error: typeof body.error === "string" ? body.error.slice(0, 180) : "",
      protocol: body.protocol === "https:" || body.protocol === "http:" ? body.protocol : "",
    });
    return Response.json({ ok: true });
  }
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
    execFile("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true }, () => resolve());
  });
}

// One Windows radio can scan. A listener already running is left alone unless this laptop is switching rooms.
async function listenHere(receiverId: string, replace: boolean): Promise<boolean> {
  const running = earProc();
  if (running.id === receiverId && running.proc && running.proc.exitCode == null) return true;
  const scanners = await scannerPids();
  if (scanners.some((row) => row.id === receiverId)) return true;
  if (!replace && scanners.length > 0) return true;
  for (const row of scanners) await killPid(row.pid);
  if (running.proc?.pid) await killPid(running.proc.pid);
  return startEar(receiverId);
}

async function join(body: { name?: string; deviceId?: string; listen?: boolean; hub?: boolean; replace?: boolean }) {
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
    agentLog("A", "app/api/tracking/route.ts:join", "join failed", { label, error: error.message });
    return Response.json({ error: "Could not save that device." }, { status: 500 });
  }
  const listening = body.listen && body.hub ? await listenHere(receiverId, !!body.replace) : false;
  agentLog("A", "app/api/tracking/route.ts:join", "laptop joined", { deviceId: receiverId, label, listen: !!body.listen, hub: !!body.hub, listening });
  return Response.json({ ok: true, deviceId: receiverId, label, listening });
}

async function hear(body: { deviceId?: string; rssi?: number }) {
  const deviceId = (body.deviceId ?? "").trim();
  const rssi = body.rssi;
  if (!SLUG.test(deviceId) || typeof rssi !== "number" || !Number.isFinite(rssi) || rssi <= -100 || rssi > 20) {
    agentLog("B", "app/api/tracking/route.ts:hear", "hear rejected", { deviceId, rssiType: typeof rssi });
    return Response.json({ error: "Unknown device." }, { status: 400 });
  }

  const { data } = await db!.from("receivers").select("id").eq("id", deviceId).eq("household_id", HOUSEHOLD_ID).maybeSingle();
  if (!data) {
    agentLog("B", "app/api/tracking/route.ts:hear", "hear unknown laptop", { deviceId });
    return Response.json({ error: "Unknown device." }, { status: 404 });
  }

  const now = Date.now();
  const rounded = Math.round(rssi);
  slot().ears.set(deviceId, { rssi: rounded, at: now });
  const last = slot().seenWrite.get(deviceId) ?? 0;
  if (now - last >= 1000) {
    slot().seenWrite.set(deviceId, now);
    const { error } = await db!.from("receivers").update({
      last_rssi: rounded,
      last_rssi_at: new Date(now).toISOString(),
      last_seen_at: new Date(now).toISOString(),
    }).eq("id", deviceId).eq("household_id", HOUSEHOLD_ID);
    if (error) {
      agentLog("B", "app/api/tracking/route.ts:hear", "hear save failed", { deviceId, error: error.message });
      return Response.json({ error: "Could not save that signal." }, { status: 500 });
    }
    agentLog("D", "app/api/tracking/route.ts:hear", "signal saved", { deviceId, rssi: rounded });
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
  if (earProc().id === receiverId) stopEar();
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
