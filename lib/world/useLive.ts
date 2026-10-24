"use client";

// Live data for the 3D view and the dashboard.
// Live mode: connects to the monitor's WS /ws/live (NEXT_PUBLIC_MONITOR_WS), applies the snapshot and then each
// frame, and reconnects with backoff. Mock mode (NEXT_PUBLIC_MOCK=1, ?mock=1, or startMock()) loops the scripted
// walk from mock-walk.ts so the view works with no backend.

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { HomeModel, LiveFrame } from "@/lib/types";
import { applyFrame, initialLive, type LiveState } from "./live-state";
import { mockWalk } from "./mock-walk";

export type LiveStatus = "connecting" | "live" | "offline" | "mock";

export const MONITOR_WS = process.env.NEXT_PUBLIC_MONITOR_WS || "ws://localhost:8787/ws/live";
export const MONITOR_URL = process.env.NEXT_PUBLIC_MONITOR_URL || "http://localhost:8787";
const envMock = process.env.NEXT_PUBLIC_MOCK === "1";

type Action = { type: "frame"; frame: LiveFrame } | { type: "reset"; home: HomeModel };

function reducer(s: LiveState, a: Action): LiveState {
  return a.type === "reset" ? initialLive(a.home) : applyFrame(s, a.frame);
}

export function useLive(initialHome: HomeModel, opts: { mock?: boolean } = {}) {
  const [state, dispatch] = useReducer(reducer, initialHome, initialLive);
  const [mock, setMock] = useState(opts.mock ?? envMock);
  const [status, setStatus] = useState<LiveStatus>(mock ? "mock" : "connecting");
  const homeRef = useRef(initialHome);
  homeRef.current = state.home;

  const push = useCallback((frame: LiveFrame) => dispatch({ type: "frame", frame }), []);

  // Live socket
  useEffect(() => {
    if (mock) return;
    let ws: WebSocket | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let delay = 1000;
    let stopped = false;

    const connect = () => {
      setStatus((s) => (s === "live" ? s : "connecting"));
      ws = new WebSocket(MONITOR_WS);
      ws.onopen = () => {
        delay = 1000;
        setStatus("live");
      };
      ws.onmessage = (e) => {
        try {
          push(JSON.parse(e.data) as LiveFrame);
        } catch {
          // Ignore a malformed frame rather than dropping the connection.
        }
      };
      ws.onclose = () => {
        if (stopped) return;
        setStatus("offline");
        retry = setTimeout(connect, delay);
        delay = Math.min(delay * 2, 10_000);
      };
    };
    connect();
    return () => {
      stopped = true;
      clearTimeout(retry);
      ws?.close();
    };
  }, [mock, push]);

  // Scripted walk, looped. Frames are re-stamped with the wall clock so the trail ages normally.
  useEffect(() => {
    if (!mock) return;
    setStatus("mock");
    dispatch({ type: "reset", home: homeRef.current });
    let timers: ReturnType<typeof setTimeout>[] = [];
    const play = () => {
      const frames = mockWalk(homeRef.current);
      const end = frames.length ? frames[frames.length - 1].at + 2500 : 5000;
      timers = frames.map(({ at, frame }) => setTimeout(() => push({ ...frame, ts: Date.now() } as LiveFrame), at));
      timers.push(setTimeout(play, end));
    };
    play();
    return () => timers.forEach(clearTimeout);
  }, [mock, push]);

  return { ...state, status, mock, setMock, push };
}

// Move the person by hand. In live mode this asks the monitor's simulator; in mock mode it only moves the view.
export async function simulatePosition(p: { x: number; y: number }): Promise<string | undefined> {
  try {
    const res = await fetch(`${MONITOR_URL}/sim/position`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ x: Math.round(p.x), y: Math.round(p.y) }),
    });
    if (!res.ok) return ((await res.json().catch(() => ({}))) as { error?: string }).error ?? `monitor returned ${res.status}`;
  } catch {
    return "The monitor is not reachable. Start it with npm run dev:monitor.";
  }
}
