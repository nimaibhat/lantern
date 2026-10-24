// What the 3D view knows at any moment, built by applying LiveFrames in order.
// Pure, so the live socket, the mock walk and replays all share it.

import type { HomeModel, LiveFrame, LocationSource, PatientMode, RiskKind, RiskState, Vec2 } from "@/lib/types";

export type ViewSource = LocationSource | "replay";

export interface LivePosition {
  ts: number;
  x: number;
  y: number;
  roomId: string;
  confidence: number;
  source: LocationSource;
  velocity?: Vec2;
}

export interface LiveRisk {
  id: string;
  kind: RiskKind;
  roomId: string;
  state: RiskState;
  trigger: "detected" | "predicted";
}

export interface LiveState {
  home: HomeModel;
  position?: LivePosition;
  room?: string;
  prediction?: { fromRoomId: string; nextRoomId: string; probability: number; ts: number };
  risks: Record<string, LiveRisk>; // by risk event id
  patient?: PatientMode;
  listeners: Record<string, boolean>;
  rssi: Record<string, number>; // latest reading per listener, when the monitor sends it
  trail: { ts: number; x: number; y: number }[]; // last TRAIL_MS of positions
  lastSource?: LocationSource;
}

export const TRAIL_MS = 10_000;
const PREDICTION_TTL_MS = 30_000;

export const initialLive = (home: HomeModel): LiveState => ({ home, risks: {}, listeners: {}, rssi: {}, trail: [] });

export function applyFrame(s: LiveState, f: LiveFrame): LiveState {
  switch (f.t) {
    case "snapshot":
      return { ...s, home: f.home, room: f.room ?? s.room, patient: f.patient ?? s.patient, listeners: f.listeners };
    case "position": {
      const position: LivePosition = { ts: f.ts, x: f.x, y: f.y, roomId: f.roomId, confidence: f.confidence, source: f.source, velocity: f.velocity };
      const trail = [...s.trail.filter((p) => f.ts - p.ts <= TRAIL_MS && p.ts <= f.ts), { ts: f.ts, x: f.x, y: f.y }];
      const prediction = s.prediction && f.ts - s.prediction.ts < PREDICTION_TTL_MS && s.prediction.fromRoomId === f.roomId ? s.prediction : undefined;
      return { ...s, position, trail, room: f.roomId, lastSource: f.source, prediction };
    }
    case "location":
      return { ...s, room: f.roomId, lastSource: f.source };
    case "prediction":
      return { ...s, prediction: { fromRoomId: f.fromRoomId, nextRoomId: f.nextRoomId, probability: f.probability, ts: f.ts } };
    case "risk": {
      const risks = { ...s.risks };
      if (f.state === "resolved") delete risks[f.riskEventId];
      else risks[f.riskEventId] = { id: f.riskEventId, kind: f.kind, roomId: f.roomId, state: f.state, trigger: f.trigger };
      return { ...s, risks };
    }
    case "patient":
      return { ...s, patient: f.mode };
    case "listener":
      return {
        ...s,
        listeners: { ...s.listeners, [f.receiverId]: f.online },
        rssi: f.rssi === undefined ? s.rssi : { ...s.rssi, [f.receiverId]: f.rssi },
      };
  }
}

// The most serious open risk per room, for floor coloring.
export function riskByRoom(s: LiveState): Record<string, RiskState> {
  const out: Record<string, RiskState> = {};
  for (const r of Object.values(s.risks)) if (out[r.roomId] !== "escalated") out[r.roomId] = r.state;
  return out;
}

export const PATIENT_LABEL: Record<PatientMode, string> = {
  idle: "TV idle",
  glow: "TV glow",
  photo_voice: "Photo + familiar voice",
  greeting: "TV greeting",
  calm: "Calm screen",
  note: "Caregiver message",
};
