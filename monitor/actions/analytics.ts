// Live outcomes since the monitor started (Part 6 step 9): how each response ended. Durable history moves to
// Supabase once the core tables are applied; this is tonight's view for GET /analytics/summary.

import type { RiskEvent, RiskKind, RiskTrigger } from "@/lib/types";

export interface Outcome {
  id: string;
  kind: RiskKind;
  roomId: string;
  trigger: RiskTrigger;
  startedAt: string;
  resolvedAt?: string;
  escalated: boolean; // a caregiver was messaged
  arrived: boolean; // a predicted risk counts only once they actually arrive
  leadTimeS?: number;
}

export function createOutcomeLog(limit = 500) {
  const byId = new Map<string, Outcome>();
  return {
    onRisk(r: RiskEvent) {
      const o = byId.get(r.id) ?? {
        id: r.id, kind: r.kind, roomId: r.roomId, trigger: r.trigger, startedAt: r.startedAt, escalated: false, arrived: r.trigger === "detected",
      };
      if (r.state === "escalated") o.escalated = true;
      if (r.arrivedAt) o.arrived = true;
      if (r.leadTimeS !== undefined) o.leadTimeS = r.leadTimeS;
      if (r.state === "resolved") o.resolvedAt = r.resolvedAt ?? new Date().toISOString();
      byId.set(r.id, o);
      if (byId.size > limit) byId.delete(byId.keys().next().value!);
    },
    list: () => [...byId.values()],
  };
}

const median = (v: number[]) => {
  if (!v.length) return undefined;
  const s = [...v].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function summarize(outcomes: Outcome[]) {
  const done = outcomes.filter((o) => o.resolvedAt);
  const worked = done.filter((o) => o.arrived && !o.escalated); // the redirect brought them back; nobody was woken
  const seconds = (o: Outcome) => (Date.parse(o.resolvedAt!) - Date.parse(o.startedAt)) / 1000;
  const byKind: Partial<Record<RiskKind, number>> = {};
  for (const o of outcomes) byKind[o.kind] = (byKind[o.kind] ?? 0) + 1;
  return {
    responses: outcomes.filter((o) => o.arrived).length,
    open: outcomes.filter((o) => !o.resolvedAt).length,
    workedWithoutMessage: worked.length,
    escalated: outcomes.filter((o) => o.escalated).length,
    falseRedirects: done.filter((o) => o.trigger === "predicted" && !o.arrived).length, // predicted, never came
    medianReturnS: median(worked.map(seconds)),
    leadTimesS: outcomes.flatMap((o) => (o.leadTimeS === undefined ? [] : [o.leadTimeS])),
    byKind,
    recent: [...outcomes].reverse().slice(0, 12),
  };
}
