import { useEffect, useRef, useState } from "react";
import { resolveRoomId, roomName } from "@/lib/dashboard/rooms";
import type { Activity, LocationSource, Receiver, RiskEvent, Room } from "@/lib/types";
// Overview data from the monitor's /ws/live WebSocket: the room the monitor's classifier decided, the timeline,
// risks and listener status. The room always comes from the monitor so the overview and the 3D view agree.
const MONITOR = process.env.NEXT_PUBLIC_MONITOR_URL || "http://localhost:8787";
const HEALTH_MS = 5000;
export interface TagHealth { online: boolean; lastSeen: number | null }

  const { rooms } = initial;
  const [listeners, setListeners] = useState<Record<string, boolean>>({});
  // Where the latest room came from. "sim" covers the simulator and replays, and shows as SIMULATED.
  const [source, setSource] = useState<LocationSource>();
  const sourceRef = useRef<LocationSource>("ble");
  const [tag, setTag] = useState<TagHealth>();
    let closed = false; // set on unmount so the close below does not schedule a reconnect

    const seen = (s: LocationSource) => {
      sourceRef.current = s;
      setSource(s);
    };
      ws.onclose = () => {
        setConnected(false);
        if (!closed) retry = setTimeout(connect, 3000);
      };
          if (frame.t === "snapshot") {
              setMonitorRoom(resolveRoomId(rooms, frame.room) ?? "");
            if (frame.listeners) setListeners(frame.listeners);
          } else if (frame.t === "listener") {
            setListeners((prev) => (prev[frame.receiverId] === frame.online ? prev : { ...prev, [frame.receiverId]: frame.online }));
            seen(frame.source);
            setMonitorRoom(resolveRoomId(rooms, frame.roomId) ?? "");
              text: `${from} → ${to}${frame.source === "sim" ? " (simulated)" : ""}`,
            seen(frame.source);
            setMonitorRoom(resolveRoomId(rooms, frame.roomId) ?? "");
            // One row per risk event: a later state (escalated, resolved) replaces the earlier one.
              roomId: resolveRoomId(rooms, frame.roomId) ?? frame.roomId,
              source: sourceRef.current,
              startedAt: prev.find((r) => r.id === frame.riskEventId)?.startedAt ?? time,
            }, ...prev.filter((r) => r.id !== frame.riskEventId)]);
    // The WebSocket carries events, not silence: a tag that stops being heard only shows up in /health.
    async function health() {
      try {
        const res = await fetch(`${MONITOR}/health`, { cache: "no-store", signal: AbortSignal.timeout(2000) });
        const h = (await res.json()) as { tagOnline?: boolean; tagLastSeen?: number | null };
        if (!closed) setTag({ online: !!h.tagOnline, lastSeen: h.tagLastSeen ?? null });
      } catch {
        if (!closed) setTag(undefined);
      }
    }

    health();
    const healthTimer = setInterval(health, HEALTH_MS);
    return () => {
      closed = true;
      clearTimeout(retry);
      clearInterval(healthTimer);
      ws?.close();
    };
  const listenersOnline = Object.values(listeners).filter(Boolean).length;
  return { roomId: monitorRoom, since, entries, risks, connected, listenersOnline, source, tag };
