"use client";

import { useEffect, useRef, useState } from "react";
import { resolveRoomId, roomName } from "@/lib/dashboard/rooms";
import type { Activity, LocationSource, Receiver, RiskEvent, Room } from "@/lib/types";

// Overview data from the monitor's /ws/live WebSocket: the room the monitor's classifier decided, the timeline,
// risks and listener status. The room always comes from the monitor so the overview and the 3D view agree.
// Falls back to initial SSR data if the monitor is unreachable.

const WS_URL = process.env.NEXT_PUBLIC_MONITOR_WS || "ws://localhost:8787/ws/live";
const MONITOR = process.env.NEXT_PUBLIC_MONITOR_URL || "http://localhost:8787";
const HEALTH_MS = 5000;
const clock = () => new Date().toTimeString().slice(0, 5);

export interface TagHealth { online: boolean; lastSeen: number | null }

// GET /dwell (monitor/actions/dwell.ts). Room ids are the home model's.
export interface Dwell { roomId?: string; inRoomS: number; outOfBedS?: number; todayS: Record<string, number> }

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

  useEffect(() => {
    let ws: WebSocket;
    let retry: ReturnType<typeof setTimeout>;
    let closed = false; // set on unmount so the close below does not schedule a reconnect

    const seen = (s: LocationSource) => {
      sourceRef.current = s;
      setSource(s);
    };

    function connect() {
      ws = new WebSocket(WS_URL);
      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        if (!closed) retry = setTimeout(connect, 3000);
      };
      ws.onerror = () => ws.close();
      ws.onmessage = (e) => {
        try {
          const frame = JSON.parse(e.data);

          if (frame.t === "snapshot") {
            if (frame.room) {
              setMonitorRoom(resolveRoomId(rooms, frame.room) ?? "");
              setSince(clock());
            }
            if (frame.listeners) setListeners(frame.listeners);
          } else if (frame.t === "listener") {
            setListeners((prev) => (prev[frame.receiverId] === frame.online ? prev : { ...prev, [frame.receiverId]: frame.online }));
          } else if (frame.t === "location") {
            seen(frame.source);
            setMonitorRoom(resolveRoomId(rooms, frame.roomId) ?? "");
            setSince(clock());
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
            setMonitorRoom(resolveRoomId(rooms, frame.roomId) ?? "");
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
      };
    }

    // The WebSocket carries events, not silence: a tag that stops being heard only shows up in /health.
    async function health() {
      try {
        const res = await fetch(`${MONITOR}/health`, { cache: "no-store", signal: AbortSignal.timeout(2000) });
        const h = (await res.json()) as { tagOnline?: boolean; tagLastSeen?: number | null };
        if (!closed) setTag({ online: !!h.tagOnline, lastSeen: h.tagLastSeen ?? null });
      } catch {
        if (!closed) setTag(undefined);
      }
      try {
        const res = await fetch(`${MONITOR}/dwell`, { cache: "no-store", signal: AbortSignal.timeout(2000) });
        if (res.ok && !closed) setDwell((await res.json()) as Dwell);
      } catch {
        if (!closed) setDwell(undefined);
      }
    }

    connect();
    health();
    const healthTimer = setInterval(health, HEALTH_MS);
    return () => {
      closed = true;
      clearTimeout(retry);
      clearInterval(healthTimer);
      ws?.close();
    };
  }, [rooms]);

  const listenersOnline = Object.values(listeners).filter(Boolean).length;
  return { roomId: monitorRoom, since, entries, risks, connected, listenersOnline, source, tag, dwell };
}
