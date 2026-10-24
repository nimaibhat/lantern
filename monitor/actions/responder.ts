// Responder (Part 6 step 5): one escalation ladder per risk event.
//   detected -> redirecting: glow at once, then the safe room's photo and a familiar voice
//   -> resolved if they reach a safe room (no message sent)
//   -> escalated: SMS the primary contact, then call them, then text the backup, until someone acknowledges.
// Timers go through deps.later so tests can drive time by hand.

import { randomUUID } from "node:crypto";
import type { Alert, Contact, PatientMode, PatientState, RiskEvent } from "@/lib/types";

// Seconds from the start of the response (voice, return window, SMS) and from the SMS (call, backup).
export const ESCALATION = {
  demo: { voiceAfterS: 5, returnWindowS: 30, smsAtS: 30, callIfNoAckS: 45, backupIfNoAckS: 60 },
  real: { voiceAfterS: 10, returnWindowS: 90, smsAtS: 120, callIfNoAckS: 120, backupIfNoAckS: 240 },
} as const;
export type EscalationProfile = (typeof ESCALATION)[keyof typeof ESCALATION];

export const CALM_MS = 3_000; // how long the screen stays on "calm" before going back to idle

export interface Notifier {
  sms(to: string, body: string): Promise<void>;
  call(to: string, say: string): Promise<void>;
}

export interface Redirect {
  message: string;
  photoPath?: string;
  voicePath?: string;
}

export interface ResponderDeps {
  householdId: string;
  patientName: string;
  timeZone: string;
  profile: EscalationProfile;
  contacts: Pick<Contact, "name" | "phone" | "priority">[];
  baseUrl: string; // for the acknowledge link in the SMS
  roomName: (roomId: string) => string;
  isSafe: (risk: RiskEvent, roomId: string, ts: number) => boolean;
  redirectFor: (risk: RiskEvent) => Redirect;
  emitRisk: (risk: RiskEvent) => void;
  emitPatient: (state: PatientState) => void;
  notify: Notifier;
  log: (tag: string, ...args: unknown[]) => void;
  later?: (ms: number, fn: () => void) => () => void;
  now?: () => number;
  newId?: () => string;
}

interface Run {
  risk: RiskEvent;
  cancels: (() => void)[];
  done: boolean;
}

const defaultLater = (ms: number, fn: () => void) => {
  const t = setTimeout(fn, ms);
  t.unref(); // a pending ladder should not keep the process (or a test run) alive
  return () => clearTimeout(t);
};

export function createResponder(deps: ResponderDeps) {
  const later = deps.later ?? defaultLater;
  const now = deps.now ?? Date.now;
  const newId = deps.newId ?? randomUUID;
  const p = deps.profile;
  const runs = new Map<string, Run>(); // by risk id
  const alerts = new Map<string, { alert: Alert; run: Run; who: "primary" | "backup" }>(); // by alert id, kept so a repeated ack is harmless
  let patient: PatientState = { householdId: deps.householdId, mode: "idle", updatedAt: new Date(now()).toISOString() };

  const iso = () => new Date(now()).toISOString();
  // When the risk started, in household time, for the SMS.
  const clockOf = (risk: RiskEvent) =>
    new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: deps.timeZone }).format(Date.parse(risk.startedAt) || now());

  function setPatient(mode: PatientMode, extra: Partial<PatientState> = {}) {
    patient = { householdId: deps.householdId, mode, updatedAt: iso(), ...extra };
    deps.emitPatient(patient);
  }

  function setRisk(run: Run, change: Partial<RiskEvent>) {
    run.risk = { ...run.risk, ...change };
    deps.emitRisk(run.risk);
  }

  function schedule(run: Run, seconds: number, fn: () => void) {
    run.cancels.push(later(seconds * 1000, () => !run.done && fn()));
  }

  function start(risk: RiskEvent) {
    const run: Run = { risk, cancels: [], done: false };
    runs.set(risk.id, run);
    deps.log("resp", risk.kind, risk.roomId, "redirecting");
    setRisk(run, { state: "redirecting" });
    setPatient("glow", { riskEventId: risk.id });

    schedule(run, p.voiceAfterS, () => {
      const r = deps.redirectFor(run.risk);
      setPatient("photo_voice", { riskEventId: risk.id, message: r.message, photoPath: r.photoPath, voicePath: r.voicePath });
    });
    schedule(run, p.smsAtS, () => escalate(run));
  }

  function escalate(run: Run) {
    deps.log("resp", run.risk.kind, run.risk.roomId, "escalated");
    setRisk(run, { state: "escalated" });
    const primary = deps.contacts.find((c) => c.priority === 1);
    const backup = deps.contacts.find((c) => c.priority === 2);
    const room = deps.roomName(run.risk.roomId).toLowerCase();
    const name = deps.patientName;
    const clock = () => clockOf(run.risk);

    if (primary) send(run, "sms", primary, (id) => `Lantern: ${name} is in the ${room} (${clock()}). Redirect played. Acknowledge: ${deps.baseUrl}/api/alerts/${id}/ack`);
    if (primary) schedule(run, p.callIfNoAckS, () => send(run, "call", primary, () => `This is Lantern. ${name} is in the ${room} and has not gone back. Please check in.`));
    if (backup) {
      schedule(run, p.backupIfNoAckS, () =>
        send(run, "sms", backup, (id) => `Lantern: ${name} is in the ${room} (${clock()}) and the first contact has not answered. Acknowledge: ${deps.baseUrl}/api/alerts/${id}/ack`),
      );
    }
    if (!primary && !backup) deps.log("resp", "no contacts set; nobody to alert");
  }

  function send(run: Run, channel: Alert["channel"], to: Pick<Contact, "phone" | "priority">, text: (alertId: string) => string) {
    const alert: Alert = { id: newId(), riskEventId: run.risk.id, channel, to: to.phone, status: "sent", ts: iso() };
    const who = to.priority === 1 ? "primary" : "backup"; // never log the number itself
    alerts.set(alert.id, { alert, run, who });
    deps.log("resp", channel, "to", who, "alert", alert.id);
    const body = text(alert.id);
    const done = channel === "sms" ? deps.notify.sms(to.phone, body) : deps.notify.call(to.phone, body);
    done.catch((e) => {
      alert.status = "failed";
      deps.log("resp", channel, "to", who, "failed:", (e as Error).message);
    });
  }

  // Stop every timer for this risk and settle the patient screen.
  function finish(run: Run, why: string) {
    if (run.done) return;
    run.done = true;
    for (const cancel of run.cancels) cancel();
    runs.delete(run.risk.id);
    deps.log("resp", run.risk.kind, run.risk.roomId, "resolved:", why);
    if (run.risk.state !== "resolved") setRisk(run, { state: "resolved", resolvedAt: iso() });

    // Leave the screen alone if another response has taken it over.
    if (patient.riskEventId !== run.risk.id) return;
    setPatient("calm");
    later(CALM_MS, () => patient.mode === "calm" && setPatient("idle"));
  }

  return {
    // Every risk on the bus: start a ladder for new ones, follow updates to ones we are running.
    onRisk(risk: RiskEvent) {
      const run = runs.get(risk.id);
      if (run) {
        // Take new fields (arrivedAt, leadTimeS) but keep our own state unless someone closed it.
        run.risk = { ...risk, state: risk.state === "resolved" ? "resolved" : run.risk.state };
        if (risk.state === "resolved") finish(run, "risk closed");
        return;
      }
      if (risk.state === "detected") start(risk);
    },

    // Reaching a safe room ends the response, before or after the caregiver has been told.
    onLocation(roomId: string, ts: number) {
      for (const run of [...runs.values()]) if (deps.isSafe(run.risk, roomId, ts)) finish(run, `reached ${roomId}`);
    },

    // Returns false for an unknown alert id. Acknowledging twice is fine.
    ack(alertId: string): boolean {
      const entry = alerts.get(alertId);
      if (!entry) return false;
      entry.alert.status = "acknowledged";
      finish(entry.run, "acknowledged");
      return true;
    },

    state() {
      return {
        patient,
        active: [...runs.values()].map((r) => r.risk),
        // The number never leaves the monitor; who and the risk's kind and room give the caregiver context
        alerts: [...alerts.values()].map(({ alert, run, who }) => ({ ...alert, to: alert.to ? "(set)" : "", who, kind: run.risk.kind, roomId: run.risk.roomId })),
      };
    },
  };
}
