// Zone rules as edited in Settings: what Lantern does when the person enters a kind of room during some hours.
// Shared by the Settings card (instant feedback) and the save action (the check that counts). The monitor reads the
// saved rows (monitor/actions/settings.ts) and the risk engine applies them (monitor/actions/risk.ts).

import type { RiskKind, RoomKind, ZoneRule } from "@/lib/types";

export type RuleAction = ZoneRule["action"];
export type RuleInput = { roomKind: RoomKind; action: RuleAction; startHour: number; endHour: number };

export const ROOM_KINDS: { kind: RoomKind; label: string }[] = [
  { kind: "bedroom", label: "Bedroom" },
  { kind: "bathroom", label: "Bathroom" },
  { kind: "hallway", label: "Hallway" },
  { kind: "kitchen", label: "Kitchen" },
  { kind: "living", label: "Living room" },
  { kind: "tv-room", label: "TV room" },
  { kind: "front-door", label: "Front door or entrance" },
  { kind: "other", label: "Other rooms" },
];

export const ACTIONS: { action: RuleAction; label: string }[] = [
  { action: "redirect", label: "Guide back to bed, then tell the family" },
  { action: "allow", label: "Allow (light the way only)" },
  { action: "greet", label: "Greet with the routine" },
];

export const roomLabel = (kind: RoomKind) => ROOM_KINDS.find((r) => r.kind === kind)?.label ?? kind;

// The risk a redirect raises. The front door is urgent (no grace period); any other room is a night redirect.
export const riskKindFor = (roomKind: RoomKind): RiskKind => (roomKind === "front-door" ? "exit-approach" : "kitchen-night");

// Hours of the day a rule covers, the same way the risk engine reads it: wraps past midnight, 0 to 24 is any time.
export function hoursCovered(r: Pick<RuleInput, "startHour" | "endHour">): number[] {
  const out: number[] = [];
  for (let h = 0; h < 24; h++) {
    const inside = r.startHour === r.endHour || (r.startHour < r.endHour ? h >= r.startHour && h < r.endHour : h >= r.startHour || h < r.endHour);
    if (inside) out.push(h);
  }
  return out;
}

export const hourLabel = (h: number) => (h === 24 || h === 0 ? "12 AM" : h === 12 ? "12 PM" : h < 12 ? `${h} AM` : `${h - 12} PM`);

const isRoomKind = (v: unknown): v is RoomKind => ROOM_KINDS.some((r) => r.kind === v);
const isAction = (v: unknown): v is RuleAction => ACTIONS.some((a) => a.action === v);
const isHour = (v: unknown, max: number): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= max;

// The problem with a set of rules in plain words, or null when it can be saved.
export function checkRules(rules: unknown): string | null {
  if (!Array.isArray(rules) || rules.length === 0) return "Keep at least one rule. With none, the monitor falls back to its built-in rules.";
  if (rules.length > 30) return "That is a lot of rules; keep it to 30 or fewer.";
  for (const r of rules as Partial<RuleInput>[]) {
    if (!isRoomKind(r.roomKind)) return "Pick a room for every rule.";
    if (!isAction(r.action)) return `Pick what Lantern does in the ${roomLabel(r.roomKind).toLowerCase()}.`;
    if (!isHour(r.startHour, 23) || !isHour(r.endHour, 24)) return `Check the hours for the ${roomLabel(r.roomKind).toLowerCase()} rule.`;
  }
  // Two rules for one room at the same hour would leave it to chance which applies.
  const valid = rules as RuleInput[];
  for (let i = 0; i < valid.length; i++) {
    for (let j = i + 1; j < valid.length; j++) {
      if (valid[i].roomKind !== valid[j].roomKind) continue;
      const a = new Set(hoursCovered(valid[i]));
      const clash = hoursCovered(valid[j]).find((h) => a.has(h));
      if (clash !== undefined) return `Two ${roomLabel(valid[i].roomKind).toLowerCase()} rules both cover ${hourLabel(clash)}. Change the hours so they don't overlap.`;
    }
  }
  return null;
}

// Database rows for a checked set of rules.
export const toRows = (householdId: string, rules: RuleInput[]) =>
  rules.map((r) => ({
    household_id: householdId,
    room_kind: r.roomKind,
    kind: r.action === "redirect" ? riskKindFor(r.roomKind) : null,
    start_hour: r.startHour,
    end_hour: r.endHour,
    action: r.action,
  }));
