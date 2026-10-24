// Actions, household and dashboard types (owner: Aarnav).

import type { LocationSource } from "./sensing";
import type { RoomKind } from "./world";

export interface Household {
  id: string;
  name: string;
  patientName: string;
  quietHoursStart: string; // "21:00"
  quietHoursEnd: string; // "07:00"
  timezone: string; // IANA, e.g. "America/New_York"
}

export interface Contact {
  id: string;
  name: string;
  relation: string;
  phone: string;
  priority: 1 | 2; // 1 = primary, 2 = backup
}

export type RiskKind = "exit-approach" | "night-wandering" | "kitchen-night" | "long-bathroom-stay" | "no-movement";
export type RiskTrigger = "detected" | "predicted";
export type RiskState = "detected" | "redirecting" | "escalated" | "resolved";

export interface RiskEvent {
  id: string;
  householdId: string;
  kind: RiskKind;
  roomId: string;
  trigger: RiskTrigger;
  state: RiskState;
  source: LocationSource;
  startedAt: string;
  resolvedAt?: string;
  predictedAt?: string;
  arrivedAt?: string;
  leadTimeS?: number;
}

export type PatientMode = "idle" | "glow" | "photo_voice" | "greeting" | "calm";

export interface PatientState {
  householdId: string;
  mode: PatientMode;
  message?: string;
  photoPath?: string;
  voicePath?: string;
  riskEventId?: string;
  updatedAt: string;
}

export interface Alert {
  id: string;
  riskEventId: string;
  channel: "sms" | "call";
  to: string;
  status: "sent" | "delivered" | "acknowledged" | "failed";
  ts: string;
}

export interface ZoneRule {
  id: string;
  householdId: string;
  roomKind: RoomKind;
  action: "redirect" | "allow" | "greet";
}

export interface RoutineStep {
  id: string;
  routineId: string;
  order: number;
  time: string; // "07:30"
  title: string;
  roomId?: string;
  photoPath?: string;
  voicePath?: string;
}

// One line in the dashboard timeline. Times shown in the UI are "HH:MM" in the household's timezone.
export interface Activity {
  id: string;
  kind: "move" | "risk" | "alert" | "info";
  text: string;
  time: string;
}
