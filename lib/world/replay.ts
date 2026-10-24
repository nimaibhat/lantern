// Recorded sessions (fixtures/sessions/<id>.jsonl, written by the monitor's recorder) as LiveFrames.
// Each line is { "k": "frame" | "position" | "location" | "prediction" | "risk" | "patient", "ts": number, "d": payload }.
// Raw "frame" lines (RSSI vectors) are skipped; the view only needs what the pipeline concluded.

import type { HomeModel, LiveFrame } from "@/lib/types";
import { applyFrame, initialLive, type LiveState } from "./live-state";
import { mockWalk } from "./mock-walk";

type Line = { k: string; ts: number; d: Record<string, any> };

export function lineToFrame({ k, ts, d }: Line): LiveFrame | undefined {
  switch (k) {
    case "position":
      return { t: "position", ts, x: d.x, y: d.y, roomId: d.roomId, confidence: d.confidence ?? 1, source: d.source ?? "ble", velocity: d.velocity };
    case "location":
      return { t: "location", ts, roomId: d.roomId, prevRoomId: d.prevRoomId, source: d.source ?? "ble" };
    case "prediction":
      return { t: "prediction", ts, fromRoomId: d.fromRoomId, nextRoomId: d.nextRoomId, probability: d.probability };
    case "risk":
      return { t: "risk", ts, riskEventId: d.id, kind: d.kind, roomId: d.roomId, state: d.state, trigger: d.trigger ?? "detected" };
    case "patient":
      return { t: "patient", ts, mode: d.mode };
    case "live":
      return d as LiveFrame; // a session recorded straight from /ws/live
  }
}

export function parseSession(text: string): LiveFrame[] {
  const frames: LiveFrame[] = [];
  for (const raw of text.split("\n")) {
    if (!raw.trim()) continue;
    try {
      const f = lineToFrame(JSON.parse(raw));
      if (f) frames.push(f);
    } catch {
      // Skip a broken line rather than refusing the whole night.
    }
  }
  return rebase(frames);
}

// Timestamps start at 0 and stay in order, so the scrubber is simple.
export function rebase(frames: LiveFrame[]): LiveFrame[] {
  const sorted = [...frames].sort((a, b) => a.ts - b.ts);
  const t0 = sorted[0]?.ts ?? 0;
  return sorted.map((f) => ({ ...f, ts: f.ts - t0 }) as LiveFrame);
}

// The built-in demo: two loops of the scripted walk.
export function demoNight(home: HomeModel): LiveFrame[] {
  const first = mockWalk(home);
  const second = mockWalk(home, (first[first.length - 1]?.at ?? 0) + 4000);
  return rebase([...first, ...second].map((f) => f.frame));
}

// State of the view at time t: apply every frame up to t.
export function stateAt(home: HomeModel, frames: LiveFrame[], t: number): LiveState {
  let s = initialLive(home);
  for (const f of frames) {
    if (f.ts > t) break;
    s = applyFrame(s, f);
  }
  return s;
}
