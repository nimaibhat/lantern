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
    world() {
      if (!store.world) throw new Error("no home model loaded");
      return store.world;
  bus.on("location", (e) => (store.room = e.roomId));
  ctx.http.get("/health", () => ({
    ok: true,
    uptimeS: Math.round((Date.now() - started) / 1000),
    listeners: store.listeners,
    tagLastSeen: store.tagLastSeen ?? null,

  // Emit any bus event by hand. This is how the web, 3D view and responder are tested without Bluetooth.
  ctx.http.post("/debug/emit", ({ body }) => {
    if (!cfg.debug) throw new HttpError(404, "not found");
    const { event, payload } = (body ?? {}) as { event?: string; payload?: unknown };
    if (!BUS_EVENTS.includes(event as BusEvent)) throw new HttpError(400, `event must be one of ${BUS_EVENTS.join(", ")}`);
    if (!payload || typeof payload !== "object") throw new HttpError(400, "payload must be an object");
    return { emitted: bus.emit(event as BusEvent, payload as never) };
  for (const m of modules) {
    await m.register(ctx);
    log("monitor", `registered ${m.name}`);
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
        const body = req.method === "POST" ? await readJson(req) : undefined;
        return send(200, await route.handler({ body, query: url.searchParams, params }));
      } catch (e) {
        if (e instanceof HttpError) return send(e.status, { error: e.message });
        log("http", `${req.method} ${url.pathname} failed`, e);
        return send(500, { error: "internal error" });
    send(404, { error: "not found" });
  const ingest = (ctx as unknown as Record<string, unknown>)._ingest as
    const url = new URL(req.url ?? "/", "http://monitor");
  const live = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    const path = new URL(req.url ?? "/", "http://monitor").pathname;
      live.handleUpgrade(req, socket, head, (ws) => live.emit("connection", ws, req));
  live.on("connection", (ws) => {
    ws.send(JSON.stringify(snapshot));
  const broadcast = (frame: LiveFrame) => {
    for (const ws of live.clients) if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  };
  for (const event of BUS_EVENTS) {
    bus.on(event, (payload) => {
      if (event === "position") {
        const frame = toLive(event, payload as BusEvents[typeof event]);
      const frame = toLive(event, payload as BusEvents[typeof event]);
      if (frame) broadcast(frame);
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
        for (const ws of live.clients) ws.terminate();
        live.close();
        server.close(() => resolve());
      }),
  };
