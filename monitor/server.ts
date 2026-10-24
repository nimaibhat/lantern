// Monitor host: one Node process with a tiny JSON router, the bus, and WS /ws/live.
// Each owner's module registers its own routes and bus listeners (see modules.ts).

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket, WebSocketServer } from "ws";
import type { BusEvents, LiveFrame } from "@/lib/types";
import { BUS_EVENTS, Bus, type BusEvent } from "./bus";
import type { Config } from "./config";
import { log } from "./log";
import { HttpError, type Handler, type ModuleCtx } from "./module";
import modules from "./modules";
import { createStore } from "./store";

const POSITION_MIN_GAP_MS = 200; // cap position frames to the browser at 5 Hz
const MAX_BODY = 1_000_000;

type Route = { method: string; parts: string[]; handler: Handler };

// "/ack/:alertId" matches "/ack/42" with params { alertId: "42" }.
function match(route: Route, method: string, parts: string[]): Record<string, string> | undefined {
  if (route.method !== method || route.parts.length !== parts.length) return;
  const params: Record<string, string> = {};
  for (let i = 0; i < parts.length; i++) {
    if (route.parts[i].startsWith(":")) params[route.parts[i].slice(1)] = decodeURIComponent(parts[i]);
    else if (route.parts[i] !== parts[i]) return;
  }
  return params;
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > MAX_BODY) throw new HttpError(413, "body too large");
  }
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, "body is not valid JSON");
  }
}

// Bus events become LiveFrames for the browser. frame (raw RSSI) stays inside the monitor.
function toLive<K extends BusEvent>(event: K, p: BusEvents[K]): LiveFrame | undefined {
  const now = Date.now();
  switch (event) {
    case "position": {
      const e = p as BusEvents["position"];
      return { t: "position", ts: e.ts, x: e.x, y: e.y, roomId: e.roomId, confidence: e.confidence, source: e.source, velocity: e.velocity };
    }
    case "location": {
      const e = p as BusEvents["location"];
      return { t: "location", ts: Date.parse(e.ts) || now, roomId: e.roomId, prevRoomId: e.prevRoomId, source: e.source };
    }
    case "prediction": {
      const e = p as BusEvents["prediction"];
      return { t: "prediction", ts: e.ts, fromRoomId: e.fromRoomId, nextRoomId: e.nextRoomId, probability: e.probability };
    }
    case "risk": {
      const e = p as BusEvents["risk"];
      return { t: "risk", ts: now, riskEventId: e.id, kind: e.kind, roomId: e.roomId, state: e.state, trigger: e.trigger };
    }
    case "patient": {
      const e = p as BusEvents["patient"];
      return { t: "patient", ts: Date.parse(e.updatedAt) || now, mode: e.mode, message: e.message, photoPath: e.photoPath, voicePath: e.voicePath, riskEventId: e.riskEventId };
    }
  }
}

export async function startMonitor(cfg: Config) {
  const started = Date.now();
  const bus = new Bus();
  const store = createStore();
  const routes: Route[] = [];
  const add = (method: string) => (path: string, handler: Handler) => routes.push({ method, parts: path.split("/").filter(Boolean), handler });

  const ctx: ModuleCtx = {
    http: { get: add("GET"), post: add("POST") },
    bus,
    store,
    cfg,
    log,
    world() {
      if (!store.world) throw new Error("no home model loaded");
      return store.world;
    },
  };

  bus.on("location", (e) => (store.room = e.roomId));
  bus.on("patient", (p) => {
    store.patient = p.mode;
    store.patientState = p;
  });

  ctx.http.get("/health", () => ({
    ok: true,
    uptimeS: Math.round((Date.now() - started) / 1000),
    listeners: store.listeners,
    tagLastSeen: store.tagLastSeen ?? null,
    tagOnline: store.tagOnline ?? false,
  }));

  // Emit any bus event by hand. This is how the web, 3D view and responder are tested without Bluetooth.
  ctx.http.post("/debug/emit", ({ body }) => {
    if (!cfg.debug) throw new HttpError(404, "not found");
    const { event, payload } = (body ?? {}) as { event?: string; payload?: unknown };
    if (!BUS_EVENTS.includes(event as BusEvent)) throw new HttpError(400, `event must be one of ${BUS_EVENTS.join(", ")}`);
    if (!payload || typeof payload !== "object") throw new HttpError(400, "payload must be an object");
    return { emitted: bus.emit(event as BusEvent, payload as never) };
  });

  for (const m of modules) {
    await m.register(ctx);
    log("monitor", `registered ${m.name}`);
  }

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    res.setHeader("Access-Control-Allow-Origin", cfg.corsOrigin);
    res.setHeader("Access-Control-Allow-Headers", "content-type");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    if (req.method === "OPTIONS") return void res.writeHead(204).end();

    const url = new URL(req.url ?? "/", "http://monitor");
    const parts = url.pathname.split("/").filter(Boolean);
    const send = (status: number, data: unknown) => {
      res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(data ?? null));
    };

    for (const route of routes) {
      const params = match(route, req.method ?? "GET", parts);
      if (!params) continue;
      try {
        const body = req.method === "POST" ? await readJson(req) : undefined;
        return send(200, await route.handler({ body, query: url.searchParams, params }));
      } catch (e) {
        if (e instanceof HttpError) return send(e.status, { error: e.message });
        log("http", `${req.method} ${url.pathname} failed`, e);
        return send(500, { error: "internal error" });
      }
    }
    send(404, { error: "not found" });
  });

  // --- /ws/listener for BLE listeners ---
  const listenerWss = new WebSocketServer({ noServer: true });
  const ingest = (ctx as unknown as Record<string, unknown>)._ingest as
    | { handleRaw(ws: import("ws").WebSocket, raw: string, token: string): void }
    | undefined;

  listenerWss.on("connection", (ws, req) => {
    const url = new URL(req.url ?? "/", "http://monitor");
    const token = url.searchParams.get("token") ?? "";
    ws.on("message", (data) => {
      if (ingest) ingest.handleRaw(ws, data.toString(), token);
    });
  });

  // --- recorder: save bus events to JSONL ---
  let recordingStream: import("node:fs").WriteStream | null = null;
  let recordingId: string | null = null;

  function recordEvent(k: string, d: unknown) {
    if (!recordingStream) return;
    recordingStream.write(JSON.stringify({ k, ts: Date.now(), d }) + "\n");
  }
  for (const ev of BUS_EVENTS) {
    bus.on(ev, (p) => recordEvent(ev, p));
  }

  ctx.http.post("/record/start", () => {
    if (recordingStream) throw new HttpError(409, "already recording");
    const fs = require("node:fs");
    const path = require("node:path");
    recordingId = `rec-${Date.now()}`;
    const dir = path.resolve("fixtures/sessions");
    fs.mkdirSync(dir, { recursive: true });
    recordingStream = fs.createWriteStream(path.join(dir, `${recordingId}.jsonl`));
    log("record", `started: ${recordingId}`);
    return { ok: true, session: recordingId };
  });

  ctx.http.post("/record/stop", () => {
    if (!recordingStream) throw new HttpError(409, "not recording");
    recordingStream.end();
    log("record", `stopped: ${recordingId}`);
    const id = recordingId;
    recordingStream = null;
    recordingId = null;
    return { ok: true, session: id };
  });

  const live = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    const path = new URL(req.url ?? "/", "http://monitor").pathname;
    if (path === "/ws/live") {
      live.handleUpgrade(req, socket, head, (ws) => live.emit("connection", ws, req));
    } else if (path === "/ws/listener") {
      listenerWss.handleUpgrade(req, socket, head, (ws) => listenerWss.emit("connection", ws, req));
    } else {
      socket.destroy();
    }
  });

  live.on("connection", (ws) => {
    const snapshot: LiveFrame = { t: "snapshot", ts: Date.now(), home: ctx.world(), room: store.room, patient: store.patient, patientState: store.patientState, listeners: store.listeners };
    ws.send(JSON.stringify(snapshot));
  });

  const broadcast = (frame: LiveFrame) => {
    const msg = JSON.stringify(frame);
    for (const ws of live.clients) if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  };

  // Positions are capped at 5 Hz, but the newest one is never dropped: one that lands inside the gap is held and
  // sent when the gap ends. Dropping it lost sim moves (a drop 170 ms after a BLE frame vanished) and made the
  // 5 Hz stream stutter whenever two frames arrived a few ms closer than 200 ms.
  let lastPositionAt = 0;
  let heldPosition: LiveFrame | undefined;
  let positionTimer: ReturnType<typeof setTimeout> | undefined;
  const sendPosition = (frame: LiveFrame) => {
    lastPositionAt = Date.now();
    broadcast(frame);
  };
  const queuePosition = (frame: LiveFrame) => {
    const wait = lastPositionAt + POSITION_MIN_GAP_MS - Date.now();
    if (wait <= 0 && !positionTimer) return sendPosition(frame);
    heldPosition = frame;
    positionTimer ??= setTimeout(() => {
      positionTimer = undefined;
      if (heldPosition) sendPosition(heldPosition);
      heldPosition = undefined;
    }, Math.max(0, wait));
    positionTimer.unref();
  };

  for (const event of BUS_EVENTS) {
    bus.on(event, (payload) => {
      if (event === "position") {
        const frame = toLive(event, payload as BusEvents[typeof event]);
        if (frame) queuePosition(frame);
        return;
      }
      if (event === "frame") {
        // Broadcast per-receiver RSSI as listener frames so Devices can show live dBm
        const f = payload as BusEvents["frame"];
        const now = Date.now();
        for (let i = 0; i < f.order.length; i++) {
          const rid = f.order[i];
          broadcast({ t: "listener", ts: now, receiverId: rid, online: f.online[rid] ?? false, rssi: f.rssi[i] });
        }
        return;
      }
      const frame = toLive(event, payload as BusEvents[typeof event]);
      if (frame) broadcast(frame);
    });
  }

  await new Promise<void>((resolve) => server.listen(cfg.port, resolve));
  const port = (server.address() as AddressInfo).port;
  log("monitor", `listening on http://localhost:${port} (debug ${cfg.debug ? "on" : "off"})`);

  return {
    port,
    bus,
    store,
    close: () =>
      new Promise<void>((resolve) => {
        const ig = (ctx as unknown as Record<string, unknown>)._ingest as { stop?(): void } | undefined;
        ig?.stop?.();
        clearTimeout(positionTimer);
        for (const ws of live.clients) ws.terminate();
        for (const ws of listenerWss.clients) ws.terminate();
        live.close();
        listenerWss.close();
        server.close(() => resolve());
      }),
  };
}
