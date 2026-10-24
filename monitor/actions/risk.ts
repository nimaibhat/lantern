// Risk engine (Part 6 step 4): decides whether a room change, a prediction, or a long stay is risky.
// Pure logic with an injected clock; index.ts wires it to the bus. The responder (step 5) takes it from there.

import { randomUUID } from "node:crypto";
import type { Household, LocationEvent, LocationSource, Prediction, RiskEvent, RiskKind, RoomKind, ZoneRule } from "@/lib/types";

export const PREDICTION_MIN_P = 0.6;
export const PREDICTION_WINDOW_MS = 60_000; // a predicted risk is cancelled (a false redirect) if they do not arrive in time
export const NIGHT_WANDER_MS = 10 * 60_000;
export const BATHROOM_STAY_MS = 30 * 60_000;
export const NO_MOVEMENT_MS = 2 * 60 * 60_000;

// Minutes since midnight in the household's timezone.
// DEMO_HOUR (0 to 23) pins the hour, like the predictor in monitor/inference, so an afternoon demo plays the
// 3 AM story with quiet hours and night rules in force. The minutes still move, so events stay in order.
export function localMinutes(ts: number, timeZone: string, demoHour = process.env.DEMO_HOUR): number {
  const parts = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "numeric", hourCycle: "h23", timeZone }).formatToParts(ts);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const pinned = demoHour !== undefined && demoHour !== "" ? Number(demoHour) : NaN;
  const hour = Number.isInteger(pinned) && pinned >= 0 && pinned <= 23 ? pinned : get("hour");
  return hour * 60 + get("minute");
}

// Is min inside [start, end)? Wraps past midnight when start > end; start === end means always.
export function within(min: number, start: number, end: number): boolean {
  if (start === end) return true;
  return start < end ? min >= start && min < end : min >= start || min < end;
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

type QuietHours = Pick<Household, "quietHoursStart" | "quietHoursEnd" | "timezone">;

export function isQuiet(ts: number, h: QuietHours): boolean {
  return within(localMinutes(ts, h.timezone), toMinutes(h.quietHoursStart), toMinutes(h.quietHoursEnd));
}

export function ruleFor(rules: ZoneRule[], kind: RoomKind | undefined, ts: number, timeZone: string): ZoneRule | undefined {
  if (!kind) return;
  const min = localMinutes(ts, timeZone);
  return rules.find((r) => r.roomKind === kind && within(min, r.startHour * 60, r.endHour * 60));
}

// Does arriving in this room end the risk? For a zone risk, any room without a redirect rule right now does.
export function resolves(kind: RiskKind, roomKind: RoomKind | undefined, rule: ZoneRule | undefined): boolean {
  switch (kind) {
    case "night-wandering":
      return roomKind === "bedroom";
    case "long-bathroom-stay":
      return roomKind !== "bathroom";
    case "no-movement":
      return true;
    default:
      return rule?.action !== "redirect";
  }
}

export interface RiskDeps {
  householdId: string;
  household: QuietHours;
  rules: ZoneRule[];
  roomKind: (roomId: string) => RoomKind | undefined;
  emit: (risk: RiskEvent) => void;
  now?: () => number;
  newId?: () => string;
}

export function createRiskEngine(deps: RiskDeps) {
  const now = deps.now ?? Date.now;
  const newId = deps.newId ?? randomUUID;
  const tz = deps.household.timezone;
  const open = new Map<RiskKind, RiskEvent>(); // at most one open risk per kind, so repeats do not pile up
  const pending = new Map<string, { id: string; kind: RiskKind; deadline: number }>(); // predicted risks by target room

  let room: string | undefined;
  let source: LocationSource = "ble";
  let enteredAt = 0;
  let outOfBedSince: number | undefined;

  const iso = (ts: number) => new Date(ts).toISOString();
  const kindOf = (id?: string) => (id ? deps.roomKind(id) : undefined);
  const current = (p: { id: string; kind: RiskKind }) => (open.get(p.kind)?.id === p.id ? open.get(p.kind) : undefined);

  // Keep the latest copy of each open risk, including updates the responder makes.
  function track(risk: RiskEvent) {
    if (risk.state === "resolved") {
      if (open.get(risk.kind)?.id === risk.id) open.delete(risk.kind);
      for (const [roomId, p] of pending) if (p.id === risk.id) pending.delete(roomId);
    } else if (!open.has(risk.kind) || open.get(risk.kind)?.id === risk.id) {
      open.set(risk.kind, risk);
    }
  }

  function send(risk: RiskEvent) {
    track(risk);
    deps.emit(risk);
  }

  function raise(kind: RiskKind, roomId: string, ts: number, extra: Partial<RiskEvent> = {}): RiskEvent | undefined {
    if (open.has(kind)) return;
    // upSince lets the responder count its grace period from getting out of bed, not from reaching the kitchen.
    const up = outOfBedSince === undefined ? {} : { upSince: iso(outOfBedSince) };
    const risk: RiskEvent = { id: newId(), householdId: deps.householdId, kind, roomId, trigger: "detected", state: "detected", source, startedAt: iso(ts), ...up, ...extra };
    send(risk);
    return risk;
  }

  function onLocation(e: LocationEvent) {
    // The event's own time decides which rules apply (so a test event stamped 3 AM counts as night);
    // how long they stay is measured on our clock, so an old timestamp cannot look like hours without moving.
    const ts = Date.parse(e.ts) || now();
    room = e.roomId;
    source = e.source;
    enteredAt = now();
    const kind = kindOf(e.roomId);
    outOfBedSince = kind === "bedroom" ? undefined : (outOfBedSince ?? enteredAt);

    // Arriving where we predicted: record the lead time instead of raising the same risk again.
    const predicted = pending.get(e.roomId);
    pending.delete(e.roomId);
    const risk = predicted && current(predicted);
    if (risk) {
      send({ ...risk, arrivedAt: iso(ts), leadTimeS: Math.round((ts - Date.parse(risk.predictedAt ?? risk.startedAt)) / 100) / 10 });
      return;
    }

    const rule = ruleFor(deps.rules, kind, ts, tz);
    if (rule?.action === "redirect" && rule.kind) raise(rule.kind, e.roomId, ts);
  }

  function onPrediction(p: Prediction) {
    if (p.probability < PREDICTION_MIN_P || p.nextRoomId === room || pending.has(p.nextRoomId)) return;
    const rule = ruleFor(deps.rules, kindOf(p.nextRoomId), p.ts, tz);
    if (rule?.action !== "redirect" || !rule.kind) return;
    const risk = raise(rule.kind, p.nextRoomId, p.ts, { trigger: "predicted", predictedAt: iso(p.ts) });
    if (risk) pending.set(p.nextRoomId, { id: risk.id, kind: risk.kind, deadline: now() + PREDICTION_WINDOW_MS });
  }

  // Called every few seconds: expire predictions and check how long they have stayed put.
  function tick() {
    const t = now();
    for (const [roomId, p] of pending) {
      if (t < p.deadline) continue;
      pending.delete(roomId);
      const risk = current(p);
      if (risk) send({ ...risk, state: "resolved", resolvedAt: iso(t) }); // predicted, never arrived: a false redirect
    }

    if (!room) return;
    const kind = kindOf(room);
    const quiet = isQuiet(t, deps.household);
    if (kind === "bathroom" && t - enteredAt >= BATHROOM_STAY_MS) raise("long-bathroom-stay", room, t);
    // Skip while another risk is open (a kitchen visit already has its own response running).
    if (quiet && kind !== "bathroom" && outOfBedSince !== undefined && t - outOfBedSince >= NIGHT_WANDER_MS && open.size === 0) {
      raise("night-wandering", room, t);
    }
    if (!quiet && t - enteredAt >= NO_MOVEMENT_MS) raise("no-movement", room, t);
  }

  // For POST /debug/force-risk: raise a risk now, skipping the rules.
  const force = (kind: RiskKind, roomId: string) => raise(kind, roomId, now());

  return { onLocation, onPrediction, tick, track, force };
}
