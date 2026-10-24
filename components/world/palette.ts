// Colors shared by the 3D scene and the 2D plan, so the two views always agree.

import type { RiskState, RoomKind } from "@/lib/types";

export const FLOOR: Record<RoomKind, string> = {
  bedroom: "#d9cbb8",
  bathroom: "#c9d2d3",
  hallway: "#d6d0c6",
  kitchen: "#d8cfb3",
  living: "#d3c8b9",
  "tv-room": "#cbc4b8",
  "front-door": "#d1c3b1",
  other: "#d0cbc3",
};
export const RISK_FLOOR: Record<RiskState, string> = { detected: "#f0b46a", redirecting: "#f5a54a", escalated: "#d9573e", resolved: "#d0cbc3" };
export const HERE = "#f3c486";
export const AMBER = "#f5a54a";
export const LISTENER = "#5c7f9e";
export const LISTENER_OFF = "#9a8f84";
export const ROUTE_OK = "#4f7a52";
export const ROUTE_BLOCKED = "#d9573e";
