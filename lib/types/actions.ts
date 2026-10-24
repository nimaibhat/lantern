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
  upSince?: string; // when they left the bedroom; the grace period counts from here
  graceUntil?: string; // no cue plays before this (docs/cues.md)
  cues?: number; // reminders played so far
}

// note: a message the caregiver typed on the dashboard, shown and said on the TV.
export type PatientMode = "idle" | "glow" | "photo_voice" | "greeting" | "calm" | "note";

export interface PatientState {
  householdId: string;
  mode: PatientMode;
  message?: string;
  photoPath?: string;
  voicePath?: string;
  riskEventId?: string;
  detail?: string; // said after the message and shown smaller: where they are and the way back
  route?: string[]; // room names from here to where we invite them, for the route strip
  cue?: number; // 1 for the first reminder; the screen chimes before each one
  roomId?: string; // where they were when this was sent; a screen with ?room= only plays its own room
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
  kind?: RiskKind; // set for redirect rules only
  startHour: number; // 0 to 23, household time
  endHour: number; // wraps past midnight when below startHour; 0 to 24 means any time
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
