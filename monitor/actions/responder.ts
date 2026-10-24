// Responder (Part 6 step 5, docs/cues.md): one ladder per risk event.
//   detected -> (grace period for night risks, nothing plays) -> redirecting: glow, then a chime and the cue,
//   repeated with the same words -> resolved if they reach a safe room ("good night", and an update to anyone texted)
//   -> escalated: text the primary contact, then call them (a Vapi voice agent when set up, else a plain call),
//   then text the backup, until someone acknowledges.
// Timers go through deps.later so tests can drive time by hand.

import { randomUUID } from "node:crypto";
import type { Alert, Contact, PatientMode, PatientState, RiskEvent, RiskKind } from "@/lib/types";
import { alertText, allClearText, backupText, callScript, handoffText, type FamilyFacts } from "@/lib/cues/family";
import type { CallOutcome } from "@/lib/cues/vapi";

// Seconds. Cues start voiceAfterS after the glow and repeat every repeatEveryS, at most maxCues times.
// Urgent risks text the family smsAtS after the glow; gentle ones once the last cue has had its time.
export const ESCALATION = {
  demo: { graceS: 15, voiceAfterS: 3, repeatEveryS: 10, maxCues: 3, smsAtS: 30, callIfNoAckS: 45, backupIfNoAckS: 60 },
  real: { graceS: 300, voiceAfterS: 10, repeatEveryS: 60, maxCues: 3, smsAtS: 120, callIfNoAckS: 120, backupIfNoAckS: 240 },
} as const;
export type EscalationProfile = { [K in keyof (typeof ESCALATION)["demo"]]: number };

// Night risks wait: people are often confused for a few minutes after waking. Everything else answers at once.
export const GRACE_KINDS: RiskKind[] = ["kitchen-night", "night-wandering"];
export const URGENT_KINDS: RiskKind[] = ["exit-approach", "long-bathroom-stay"];
export const CONFIDENT = 0.6; // below this a cue does not name the room
export const CALL_POLL_S = 5;
export const CALL_POLL_MAX = 48; // about 4 minutes of checking on a voice-agent call

export const CALM_MS = 6_000; // how long the screen stays on "calm" (and its good-night line) before going back to idle

export function escalateAfterS(kind: RiskKind, p: EscalationProfile) {
  return URGENT_KINDS.includes(kind) ? p.smsAtS : p.voiceAfterS + p.maxCues * p.repeatEveryS;
}

export interface Notifier {
  sms(to: string, body: string): Promise<void>;
  call(to: string, say: string): Promise<void>;
}

// A two-way call to the family (Vapi). place returns the call id, or undefined if it could not start.
export interface VoiceCaller {
  live: boolean;
  place(to: string, facts: FamilyFacts, riskEventId: string): Promise<string | undefined>;
  outcome(callId: string): Promise<CallOutcome>;
}

export interface Redirect {
  message: string;
  detail?: string;
  route?: string[];
  photoPath?: string;
  voicePath?: string;
}

export interface Here {
  roomId: string;
  confident: boolean;
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
  redirectFor: (risk: RiskEvent, here: Here, cue: number) => Redirect;
  closingFor?: (risk: RiskEvent) => string | undefined; // said when they reach a safe room after a cue
  emitRisk: (risk: RiskEvent) => void;
  emitPatient: (state: PatientState) => void;
  notify: Notifier;
  voice?: VoiceCaller;
  log: (tag: string, ...args: unknown[]) => void;
  later?: (ms: number, fn: () => void) => () => void;
  now?: () => number;
  newId?: () => string;
}

type Who = "primary" | "backup";

interface Run {
  risk: RiskEvent;
  cancels: (() => void)[];
  done: boolean;
  here: Here;
  cues: number;
  escalated: boolean;
  texted: Set<Who>; // who has been messaged, for the updates
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
  const alerts = new Map<string, { alert: Alert; run: Run; who: Who }>(); // by alert id, kept so a repeated ack is harmless
  let patient: PatientState = { householdId: deps.householdId, mode: "idle", updatedAt: new Date(now()).toISOString() };

  const iso = () => new Date(now()).toISOString();
  const clock = (ts: number) => new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: deps.timeZone }).format(ts);
  const contact = (who: Who) => deps.contacts.find((c) => c.priority === (who === "primary" ? 1 : 2));

  // What the family hears: since they got up for night risks, since the risk started otherwise.
  function facts(run: Run): FamilyFacts {
    const since = Date.parse(run.risk.upSince ?? "") || Date.parse(run.risk.startedAt) || now();
    return { name: deps.patientName, kind: run.risk.kind, room: deps.roomName(run.here.roomId), since: clock(since), reminders: run.cues };
  }

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
    const run: Run = { risk, cancels: [], done: false, here: { roomId: risk.roomId, confident: true }, cues: 0, escalated: false, texted: new Set() };
    runs.set(risk.id, run);
    const upAt = Date.parse(risk.upSince ?? "") || now();
    const graceMs = GRACE_KINDS.includes(risk.kind) ? Math.max(0, upAt + p.graceS * 1000 - now()) : 0;
    if (graceMs <= 0) return respond(run);
    deps.log("resp", risk.kind, risk.roomId, `grace ${Math.round(graceMs / 1000)} s`);
    setRisk(run, { graceUntil: new Date(now() + graceMs).toISOString() });
    run.cancels.push(later(graceMs, () => !run.done && respond(run)));
  }

  function respond(run: Run) {
    deps.log("resp", run.risk.kind, run.risk.roomId, "redirecting");
    setRisk(run, { state: "redirecting" });
    setPatient("glow", { riskEventId: run.risk.id, roomId: run.here.roomId });
    for (let k = 1; k <= p.maxCues; k++) schedule(run, p.voiceAfterS + (k - 1) * p.repeatEveryS, () => cue(run, k));
    schedule(run, escalateAfterS(run.risk.kind, p), () => escalate(run));
  }

  // One reminder: the same words each time, from wherever they are now.
  function cue(run: Run, k: number) {
    run.cues = k;
    const r = deps.redirectFor(run.risk, run.here, k);
    setRisk(run, { cues: k });
    setPatient("photo_voice", {
      riskEventId: run.risk.id,
      message: r.message,
      detail: r.detail,
      route: r.route,
      photoPath: r.photoPath,
      voicePath: r.voicePath,
      cue: k,
      roomId: run.here.roomId,
    });
  }

  function escalate(run: Run, why = "no return") {
    if (run.escalated || run.done) return;
    run.escalated = true;
    deps.log("resp", run.risk.kind, run.risk.roomId, "escalated:", why);
    setRisk(run, { state: "escalated" });
    const primary = contact("primary");
    if (primary) {
      send(run, "sms", "primary", (id) => alertText(facts(run), ackUrl(id)));
      schedule(run, p.callIfNoAckS, () => callFamily(run, "primary"));
    }
    if (contact("backup")) schedule(run, p.backupIfNoAckS, () => textBackup(run));
    if (!primary && !contact("backup")) deps.log("resp", "no contacts set; nobody to alert");
  }

  const ackUrl = (alertId: string) => `${deps.baseUrl}/api/alerts/${alertId}/ack`;

  function textBackup(run: Run) {
    if (run.done || run.texted.has("backup") || !contact("backup")) return;
    send(run, "sms", "backup", (id) => backupText(facts(run), ackUrl(id)));
  }

  // A voice agent that can hear "yes, I'll go" when Vapi is set up; a plain read-aloud call otherwise.
  function callFamily(run: Run, who: Who) {
    const c = contact(who);
    if (!c) return;
    if (!deps.voice?.live || !c.phone) return send(run, "call", who, () => callScript(facts(run)));

    const alert = record(run, "call", who, c.phone);
    deps.voice.place(c.phone, facts(run), run.risk.id).then((callId) => {
      if (!callId) return fail(alert, who, "call", "voice call did not start");
      let polls = 0;
      const check = () => {
        void deps.voice!.outcome(callId).then((o) => {
          if (run.done) return;
          if (o === "pending" && ++polls < CALL_POLL_MAX) return schedule(run, CALL_POLL_S, check);
          deps.log("resp", "voice call to", who, "ended:", o);
          if (o === "will-check") {
            alert.status = "acknowledged";
            return finish(run, `${who} is checking (phone)`, who);
          }
          if (o === "cannot" || o === "no-answer") textBackup(run); // do not wait for the backup timer
        }, (e) => deps.log("resp", "voice call status failed:", (e as Error).message));
      };
      schedule(run, CALL_POLL_S, check);
    }, (e) => fail(alert, who, "call", (e as Error).message));
  }

  function record(run: Run, channel: Alert["channel"], who: Who, phone: string): Alert {
    const alert: Alert = { id: newId(), riskEventId: run.risk.id, channel, to: phone, status: "sent", ts: iso() };
    alerts.set(alert.id, { alert, run, who });
    if (channel === "sms") run.texted.add(who);
    deps.log("resp", channel, "to", who, "alert", alert.id); // never log the number itself
    return alert;
  }

  function fail(alert: Alert, who: Who, channel: string, message: string) {
    alert.status = "failed";
    deps.log("resp", channel, "to", who, "failed:", message);
  }

  function send(run: Run, channel: Alert["channel"], who: Who, text: (alertId: string) => string) {
    const c = contact(who);
    if (!c) return;
    const alert = record(run, channel, who, c.phone);
    const body = text(alert.id);
    const done = channel === "sms" ? deps.notify.sms(c.phone, body) : deps.notify.call(c.phone, body);
    done.catch((e) => fail(alert, who, channel, (e as Error).message));
  }

  // An update to everyone already texted, outside the alert log.
  function update(run: Run, body: string, except?: Who) {
    for (const who of run.texted) {
      const c = contact(who);
      if (!c || who === except) continue;
      deps.log("resp", "update to", who);
      deps.notify.sms(c.phone, body).catch((e) => deps.log("resp", "update to", who, "failed:", (e as Error).message));
    }
  }

  // Stop every timer for this risk and settle the patient screen.
  function finish(run: Run, why: string, ackedBy?: Who) {
    if (run.done) return;
    run.done = true;
    for (const cancel of run.cancels) cancel();
    runs.delete(run.risk.id);
    deps.log("resp", run.risk.kind, run.risk.roomId, "resolved:", why);
    if (run.risk.state !== "resolved") setRisk(run, { state: "resolved", resolvedAt: iso() });

    const back = why.startsWith("reached");
    if (back && run.escalated) update(run, allClearText(deps.patientName, deps.roomName(run.here.roomId), clock(now())));
    if (ackedBy) update(run, handoffText(deps.patientName, contact(ackedBy)?.name || "Someone"), ackedBy);

    // Leave the screen alone if another response has taken it over.
    if (patient.riskEventId !== run.risk.id) return;
    setPatient("calm", { roomId: run.here.roomId, ...(back && run.cues > 0 ? { message: deps.closingFor?.(run.risk) } : {}) });
    later(CALM_MS, () => patient.mode === "calm" && setPatient("idle"));
  }

  return {
    // Every risk on the bus: start a ladder for new ones, follow updates to ones we are running.
    onRisk(risk: RiskEvent) {
      const run = runs.get(risk.id);
      if (run) {
        // Take new fields (arrivedAt, leadTimeS) but keep our own state and counts unless someone closed it.
        run.risk = { ...risk, state: risk.state === "resolved" ? "resolved" : run.risk.state, graceUntil: run.risk.graceUntil, cues: run.risk.cues };
        if (risk.state === "resolved") finish(run, "risk closed");
        return;
      }
      if (risk.state === "detected") start(risk);
    },

    // Reaching a safe room ends the response, before or after the caregiver has been told. Anywhere else, the
    // next cue starts from the new room.
    onLocation(roomId: string, ts: number, confidence = 1) {
      for (const run of [...runs.values()]) {
        run.here = { roomId, confident: confidence >= CONFIDENT };
        if (deps.isSafe(run.risk, roomId, ts)) finish(run, `reached ${roomId}`);
      }
    },

    // Returns false for an unknown alert id. Acknowledging twice is fine.
    ack(alertId: string): boolean {
      const entry = alerts.get(alertId);
      if (!entry) return false;
      entry.alert.status = "acknowledged";
      finish(entry.run, "acknowledged", entry.who);
      return true;
    },

    // The companion voice heard a call for help, or a caregiver pressed "tell the family now": skip the waiting.
    escalateNow(riskEventId?: string): boolean {
      const run = riskEventId ? runs.get(riskEventId) : [...runs.values()][0];
      if (!run) return false;
      if (run.risk.state === "detected") respond(run); // still in its grace period
      escalate(run, "help asked");
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
