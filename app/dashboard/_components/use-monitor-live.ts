"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LiveFeed } from "@/components/world/live-marker";
import { resolveRoomId, roomName } from "@/lib/dashboard/rooms";
import type { Activity, LocationSource, Receiver, RiskEvent, Room, Vec2 } from "@/lib/types";

// Overview data from the monitor's live frames: the live position (the dot), the room it is in, the timeline, risks,
// and every listener's status and signal. Everything comes from the monitor, so the Now page, the 3D view and the
// Tracking laptops all agree. Falls back to initial SSR data if the monitor is unreachable.

const HEALTH_MS = 5000;
const STALE_MS = 5000; // no position for this long: the plan goes back to marking the room
const POSITION_FRESH_MS = 2000; // positions newer than this own the room shown
const clock = () => new Date().toTimeString().slice(0, 5);

export interface TagHealth { online: boolean; lastSeen: number | null }

// GET /dwell (monitor/actions/dwell.ts). Room ids are the home model's.
export interface Dwell { roomId?: string; inRoomS: number; outOfBedS?: number; todayS: Record<string, number> }
export interface Placed { receiverId: string; position: Vec2 }

// Where this page can reach the monitor. From an http page, straight to it on the page's own host (so another laptop
// on the network finds the hub). From an https page, through this origin: browsers will not open ws:// or fetch
// http:// from https, and Saran's Tracking needs https for Bluetooth.
function endpoints(): { live?: string; http: string } {
  if (typeof location === "undefined" || location.protocol === "https:") return { http: "/api/monitor" };
  return {
    live: process.env.NEXT_PUBLIC_MONITOR_WS || `ws://${location.hostname}:8787/ws/live`,
    http: process.env.NEXT_PUBLIC_MONITOR_URL || `http://${location.hostname}:8787`,
  };
}

export function useMonitorLive(initial: { rooms: Room[]; receivers?: Receiver[]; activity: Activity[]; risks: RiskEvent[] }) {
  const { rooms } = initial;
  const lastMove = initial.activity.findLast((a) => a.kind === "move");
  const [monitorRoom, setMonitorRoom] = useState(rooms.find((r) => /bed/i.test(r.name))?.id ?? rooms[0]?.id ?? "");
  const [since, setSince] = useState(lastMove?.time ?? "");
  const [entries, setEntries] = useState<Activity[]>(initial.activity);
  const [risks, setRisks] = useState<RiskEvent[]>(initial.risks);
  const [connected, setConnected] = useState(false);
  const [listeners, setListeners] = useState<Record<string, boolean>>({});
  // Where the latest room came from. "sim" covers the simulator and replays, and shows as SIMULATED.
  const [source, setSource] = useState<LocationSource>();
  const sourceRef = useRef<LocationSource>("ble");
  const [tag, setTag] = useState<TagHealth>();
  const [dwell, setDwell] = useState<Dwell>();
  const lastState = useRef(new Map<string, string>()); // risk id -> state, so the timeline skips reminder-count updates
  const shown = useRef("");
  const lastPositionAt = useRef(0);
  // The live position, read by the dot on every animation frame rather than through React state
  const position = useRef<LiveFeed>(undefined);
  const [live, setLive] = useState(false); // a position arrived in the last few seconds
  const [spreadFt, setSpreadFt] = useState<number>();
  const [rssi, setRssi] = useState<Record<string, number>>({});
  const heard = useRef<Record<string, number>>({}); // signal per listener as it arrives; shown once a second
  const [placed, setPlaced] = useState<Placed[]>([]);
  const [registered, setRegistered] = useState<Receiver[]>(initial.receivers ?? []); // refreshed, so new laptops appear
  const feed = useCallback(() => position.current, []);

  // Set where a device stands, by room or by its exact spot on the plan. Returns an error to show, or nothing.
  const place = useCallback(async (receiverId: string, where: { roomId?: string; position?: Vec2 }) => {
    try {
      const res = await fetch("/api/sensors", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ receiverId, ...where }) });
      const data = (await res.json().catch(() => ({}))) as { position?: Vec2; roomId?: string; error?: string };
      if (!res.ok || !data.position) return data.error ?? "Could not place that device.";
      const at = data.position;
      setPlaced((prev) => [...prev.filter((p) => p.receiverId !== receiverId), { receiverId, position: at }]);
      setRegistered((prev) => prev.map((r) => (r.id === receiverId ? { ...r, roomId: data.roomId ?? r.roomId } : r)));
    } catch {
      return "Could not reach the server.";
    }
  }, []);

  useEffect(() => {
    let ws: WebSocket | undefined;
    let es: EventSource | undefined;
    let retry: ReturnType<typeof setTimeout>;
    let closed = false; // set on unmount so the close below does not schedule a reconnect
    const where = endpoints();

    const seen = (s: LocationSource) => {
      sourceRef.current = s;
      setSource(s);
    };

    // The room shown is the room the live dot is in. A room-change event (the steadier tracker behind alerts) only
    // moves it when no position has arrived for a moment, so the words never disagree with the dot on the plan.
    const show = (roomId: string) => {
      const id = resolveRoomId(rooms, roomId) ?? "";
      if (id === shown.current) return;
      shown.current = id;
      setMonitorRoom(id);
      setSince(clock());
    };

    function connect() {
      if (!where.live) {
        es = new EventSource("/api/live");
        es.onopen = () => setConnected(true);
        es.onerror = () => setConnected(false); // EventSource reconnects on its own
        es.onmessage = (e) => handle(e.data);
        return;
      }
      try {
        ws = new WebSocket(where.live);
      } catch {
        return;
      }
      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        if (!closed) retry = setTimeout(connect, 3000);
      };
      ws.onerror = () => ws?.close();
      ws.onmessage = (e) => handle(e.data);
    }

    function handle(data: string) {
      try {
        const frame = JSON.parse(data);

        if (frame.t === "snapshot") {
          if (frame.room) show(frame.room);
          if (frame.listeners) setListeners(frame.listeners);
          if (frame.home?.anchors) setPlaced(frame.home.anchors.map((x: Placed) => ({ receiverId: x.receiverId, position: x.position })));
        } else if (frame.t === "listener") {
          setListeners((prev) => (prev[frame.receiverId] === frame.online ? prev : { ...prev, [frame.receiverId]: frame.online }));
          // -100 is how the monitor says "online but not hearing the tag"
          if (typeof frame.rssi === "number" && frame.rssi > -100) heard.current[frame.receiverId] = Math.round(frame.rssi);
          else delete heard.current[frame.receiverId];
        } else if (frame.t === "location") {
          seen(frame.source);
          if (Date.now() - lastPositionAt.current > POSITION_FRESH_MS) show(frame.roomId);
          const from = roomName(rooms, frame.prevRoomId);
          const to = roomName(rooms, frame.roomId);
          const time = clock();
          setEntries((prev) => [...prev, {
            id: `live-${Date.now()}`,
            time,
            kind: "move" as const,
            text: `${from} → ${to}${frame.source === "sim" ? " (simulated)" : ""}`,
          }]);
        } else if (frame.t === "position") {
          seen(frame.source);
          lastPositionAt.current = Date.now();
          position.current = { x: frame.x, y: frame.y, velocity: frame.velocity, spreadIn: frame.spreadIn, at: performance.now() };
          setLive(true);
          if (typeof frame.spreadIn === "number") setSpreadFt(Math.max(1, Math.round(frame.spreadIn / 12)));
          show(frame.roomId);
        } else if (frame.t === "risk") {
          const time = clock();
          // One row per risk event: a later state (escalated, resolved) replaces the earlier one.
          setRisks((prev) => [{
            id: frame.riskEventId,
            householdId: "",
            kind: frame.kind,
            roomId: resolveRoomId(rooms, frame.roomId) ?? frame.roomId,
            trigger: frame.trigger,
            state: frame.state,
            source: sourceRef.current,
            startedAt: prev.find((r) => r.id === frame.riskEventId)?.startedAt ?? time,
            graceUntil: frame.graceUntil,
            cues: frame.cues,
          }, ...prev.filter((r) => r.id !== frame.riskEventId)]);
          // One timeline line per change of state, not one per reminder.
          const was = lastState.current.get(frame.riskEventId);
          lastState.current.set(frame.riskEventId, frame.state);
          if (was !== frame.state) {
            setEntries((prev) => [...prev, {
              id: `risk-${Date.now()}`,
              time,
              kind: "risk" as const,
              text: `Risk: ${frame.kind} in ${roomName(rooms, frame.roomId)} (${frame.state})`,
            }]);
          }
        }
      } catch {}
    }

    // The live frames carry events, not silence: a tag that stops being heard only shows up in /health.
    async function health() {
      try {
        const res = await fetch(`${where.http}/health`, { cache: "no-store", signal: AbortSignal.timeout(2000) });
        const h = (await res.json()) as { tagOnline?: boolean; tagLastSeen?: number | null };
        if (!closed) setTag({ online: !!h.tagOnline, lastSeen: h.tagLastSeen ?? null });
      } catch {
        if (!closed) setTag(undefined);
      }
      try {
        const res = await fetch(`${where.http}/dwell`, { cache: "no-store", signal: AbortSignal.timeout(2000) });
        if (res.ok && !closed) setDwell((await res.json()) as Dwell);
      } catch {
        if (!closed) setDwell(undefined);
      }
      // Where each listener stands, so the plan can show the sensors the dot is worked out from
      try {
        const res = await fetch(`${where.http}/world/rooms`, { cache: "no-store", signal: AbortSignal.timeout(2000) });
        if (res.ok && !closed) setPlaced(((await res.json()) as { anchors: Placed[] }).anchors);
      } catch {}
      // Devices registered on Tracking, including any added since the page opened
      try {
        const res = await fetch("/api/sensors", { cache: "no-store", signal: AbortSignal.timeout(3000) });
        if (res.ok && !closed) setRegistered(((await res.json()) as { receivers: Receiver[] }).receivers);
      } catch {}
      // A position that stops arriving (tag silent, monitor down) hands the plan back to marking the room
      if (!closed && Date.now() - lastPositionAt.current > STALE_MS) setLive(false);
    }

    // Listener frames arrive several times a second per sensor; the numbers on screen only need to change once a second.
    const flush = () => setRssi((prev) => {
      const next = heard.current;
      const same = Object.keys(next).length === Object.keys(prev).length && Object.entries(next).every(([k, v]) => prev[k] === v);
      return same ? prev : { ...next };
    });

    connect();
    health();
    const healthTimer = setInterval(health, HEALTH_MS);
    const rssiTimer = setInterval(flush, 1000);
    return () => {
      closed = true;
      clearTimeout(retry);
      clearInterval(healthTimer);
      clearInterval(rssiTimer);
      ws?.close();
      es?.close();
    };
  }, [rooms]);

  const listenersOnline = Object.values(listeners).filter(Boolean).length;
  return { roomId: monitorRoom, since, entries, risks, connected, listeners, listenersOnline, rssi, placed, registered, place, source, tag, dwell, feed, live, spreadFt };
}
