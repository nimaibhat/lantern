// A scripted night walk for building and demoing the 3D view with no backend (NEXT_PUBLIC_MOCK=1),
// and the built-in "demo night" replay. Every frame is source "sim", so the view shows SIMULATED.
//
// bedroom > hallway (predicted: kitchen) > kitchen (redirect: glow, then photo + voice) > hallway > bedroom

import type { HomeModel, HomeRoom, LiveFrame, RoomKind, Vec2 } from "@/lib/types";
import { pathLength, pointAlong, roomAt, routeBetween } from "./geometry";

export const STEP_MS = 200;
const SPEED_IN_PER_S = 50;
const PAUSE_MS = 2500;

export interface TimedFrame {
  at: number; // ms from the start of the walk
  frame: LiveFrame;
}

const pick = (home: HomeModel, ...kinds: RoomKind[]): HomeRoom | undefined => {
  for (const k of kinds) {
    const r = home.rooms.find((x) => x.kind === k);
    if (r) return r;
  }
};

export function mockWalk(home: HomeModel, start = 0): TimedFrame[] {
  const bedroom = pick(home, "bedroom") ?? home.rooms[0];
  const hallway = pick(home, "hallway") ?? home.rooms[1] ?? bedroom;
  const target = pick(home, "kitchen", "front-door", "tv-room") ?? home.rooms[2] ?? hallway;
  if (!bedroom) return [];

  const frames: TimedFrame[] = [];
  let t = 0;
  let room = bedroom.id;
  const at = (dt: number) => start + t + dt;
  const push = (frame: LiveFrame, dt = 0) => frames.push({ at: at(dt), frame: { ...frame, ts: at(dt) } as LiveFrame });
  const riskId = `sim-risk-${start}`;

  const walk = (points: Vec2[]) => {
    const len = pathLength(points);
    const steps = Math.max(1, Math.round((len / SPEED_IN_PER_S) * (1000 / STEP_MS)));
    for (let i = 0; i <= steps; i++) {
      const p = pointAlong(points, (len * i) / steps);
      const next = pointAlong(points, (len * (i + 1)) / steps);
      const here = roomAt(home, p)?.id ?? room;
      if (here !== room) {
        push({ t: "location", ts: 0, roomId: here, prevRoomId: room, source: "sim" });
        if (here === hallway.id && target.id !== hallway.id) {
          push({ t: "prediction", ts: 0, fromRoomId: hallway.id, nextRoomId: target.id, probability: 0.78 });
        }
        if (here === target.id) {
          push({ t: "risk", ts: 0, riskEventId: riskId, kind: target.kind === "front-door" ? "exit-approach" : "kitchen-night", roomId: target.id, state: "redirecting", trigger: "predicted" });
          push({ t: "patient", ts: 0, mode: "glow" });
          push({ t: "patient", ts: 0, mode: "photo_voice" }, 1200);
        }
        if (room === target.id) {
          push({ t: "risk", ts: 0, riskEventId: riskId, kind: target.kind === "front-door" ? "exit-approach" : "kitchen-night", roomId: target.id, state: "resolved", trigger: "predicted" });
          push({ t: "patient", ts: 0, mode: "calm" });
        }
        room = here;
      }
      const velocity = { x: ((next.x - p.x) * 1000) / STEP_MS, y: ((next.y - p.y) * 1000) / STEP_MS };
      push({ t: "position", ts: 0, x: p.x, y: p.y, roomId: room, confidence: 0.82, source: "sim", velocity });
      t += STEP_MS;
    }
  };

  push({ t: "location", ts: 0, roomId: bedroom.id, source: "sim" });
  push({ t: "patient", ts: 0, mode: "idle" });
  t += PAUSE_MS;
  walk(routeBetween(home, bedroom.id, target.id));
  t += PAUSE_MS;
  walk(routeBetween(home, target.id, bedroom.id));
  push({ t: "patient", ts: 0, mode: "idle" });
  t += PAUSE_MS;
  return frames.sort((a, b) => a.at - b.at); // delayed frames (the voice after the glow) slot into place
}

export const walkDuration = (frames: TimedFrame[]) => (frames.length ? frames[frames.length - 1].at - frames[0].at + PAUSE_MS : 0);
