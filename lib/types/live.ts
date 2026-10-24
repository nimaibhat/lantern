// Shared: all four sign off on changes.
// Everything the 3D view and dashboard need, pushed over WS /ws/live. Not stored per frame.

import type { LocationSource } from "./sensing";
import type { HomeModel, Vec2 } from "./world";

export type LiveFrame =
  | { t: "position"; ts: number; x: number; y: number; roomId: string; confidence: number; source: LocationSource; velocity?: Vec2 }
  | { t: "location"; ts: number; roomId: string; prevRoomId?: string; source: LocationSource }
  | { t: "prediction"; ts: number; fromRoomId: string; nextRoomId: string; probability: number }
  | { t: "risk"; ts: number; riskEventId: string; kind: RiskKind; roomId: string; state: RiskState; trigger: RiskTrigger }
  | { t: "listener"; ts: number; receiverId: string; online: boolean; rssi?: number };
