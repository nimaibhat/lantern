// Actions module (owner: Aarnav): risk rules, the responder, Twilio messages, the Roku wake-up and the
// TV-room greeting (Part 6).

import type { PatientMode, PatientState, RiskEvent, RiskKind, ZoneRule } from "@/lib/types";
import { HttpError, type MonitorModule } from "../module";
import { createOutcomeLog, summarize } from "./analytics";
import { createNotifier } from "./notify";
import { ESCALATION, createResponder, type Redirect } from "./responder";
import { createRiskEngine, localMinutes, resolves, ruleFor } from "./risk";
import { RokuClient } from "./roku";

const TICK_MS = 15_000;

// Same as supabase/seed.sql, supabase/seed/aarnav.sql and the demo household. Read them from Supabase once the monitor has keys.
const HOUSEHOLD = { patientName: "Rosa", quietHoursStart: "21:00", quietHoursEnd: "07:00", timezone: "America/New_York" };
const rules = (householdId: string): ZoneRule[] => [
  { id: "z1", householdId, roomKind: "front-door", kind: "exit-approach", startHour: 0, endHour: 24, action: "redirect" },
  { id: "z2", householdId, roomKind: "kitchen", kind: "kitchen-night", startHour: 22, endHour: 6, action: "redirect" },
  { id: "z3", householdId, roomKind: "bathroom", startHour: 22, endHour: 6, action: "allow" },
  { id: "z4", householdId, roomKind: "tv-room", startHour: 8, endHour: 20, action: "greet" },
];

const RISK_KINDS: RiskKind[] = ["exit-approach", "night-wandering", "kitchen-night", "long-bathroom-stay", "no-movement"];
const PATIENT_MODES: PatientMode[] = ["idle", "glow", "photo_voice", "greeting", "calm"];

// What the patient screen says for each risk. Voice clips are recorded by the caregiver in the routine editor.
const VOICE_SLOT: Partial<Record<RiskKind, string>> = { "kitchen-night": "kitchen", "night-wandering": "bedtime", "exit-approach": "front-door" };
const MESSAGE: Record<RiskKind, (name: string) => string> = {
  "kitchen-night": (n) => `It's still night, ${n}. Let's go back to bed.`,
  "night-wandering": (n) => `It's still night, ${n}. Let's go back to bed.`,
  "exit-approach": (n) => `You're home, ${n}. Let's go back to your room.`,
  "long-bathroom-stay": (n) => `${n}, are you all right?`,
  "no-movement": (n) => `${n}, how about a glass of water in the kitchen?`,
};

const GREETING_MS = 15_000; // how long the greeting stays before the routine comes back
const GREET_AGAIN_MS = 10 * 60_000; // walking in and out of the TV room should not greet every time

function greetingFor(ts: number, name: string, timeZone: string) {
  const h = localMinutes(ts, timeZone) / 60;
  return `${h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"}, ${name}.`;
}

const field = (body: unknown, key: string): unknown => (body && typeof body === "object" ? (body as Record<string, unknown>)[key] : undefined);
const optionalString = (v: unknown) => (typeof v === "string" ? v : undefined);

const actions: MonitorModule = {
  name: "actions",
  register(ctx) {
    const householdId = ctx.cfg.householdId;
    const zoneRules = rules(householdId);
    const room = (id: string) => ctx.world().rooms.find((r) => r.id === id);
    const profileName = process.env.ESCALATION_PROFILE === "real" ? "real" : "demo";
    const notify = createNotifier(process.env, ctx.log);
    const roku = new RokuClient(process.env.ROKU_HOST || undefined, ctx.log);

    // Deferred so a risk the engine raises reaches every listener before the responder's follow-up does.
    const later = <T>(fn: (x: T) => void) => (x: T) => queueMicrotask(() => fn(x));

    const engine = createRiskEngine({
      householdId,
      household: HOUSEHOLD,
      rules: zoneRules,
      roomKind: (id) => room(id)?.kind,
      emit: (risk) => {
        ctx.log("risk", risk.kind, risk.roomId, risk.state, risk.trigger);
        ctx.bus.emit("risk", risk);
      },
    });

    const responder = createResponder({
      householdId,
      patientName: HOUSEHOLD.patientName,
      timeZone: HOUSEHOLD.timezone,
      profile: ESCALATION[profileName],
      contacts: [
        { name: "Primary", phone: process.env.CAREGIVER_PHONE_NUMBER ?? "", priority: 1 },
        { name: "Backup", phone: process.env.BACKUP_PHONE_NUMBER ?? "", priority: 2 },
      ],
      baseUrl: process.env.PUBLIC_BASE_URL || "http://localhost:3000",
      roomName: (id) => room(id)?.name ?? id,
      isSafe: (risk: RiskEvent, roomId, ts) => {
        const kind = room(roomId)?.kind;
        return resolves(risk.kind, kind, ruleFor(zoneRules, kind, ts, HOUSEHOLD.timezone));
      },
      redirectFor: (risk): Redirect => {
        const slot = VOICE_SLOT[risk.kind];
        return {
          message: MESSAGE[risk.kind](HOUSEHOLD.patientName),
          // The caregiver's chosen photo (Settings). /api/patient/media falls back to the scanned bedroom photo.
          photoPath: `${householdId}/redirect-photo.jpg`,
          voicePath: slot ? `${householdId}/redirect-${slot}.m4a` : undefined,
        };
      },
      emitRisk: later((risk: RiskEvent) => ctx.bus.emit("risk", risk)),
      emitPatient: later((state) => ctx.bus.emit("patient", state)),
      notify,
      log: ctx.log,
    });
    ctx.log("actions", `escalation profile ${profileName}; twilio ${notify.live ? "live" : "dry run"}; roku ${roku.configured ? "on" : "dry run"}`);

    // A replay (/replay/start) re-emits a recorded night for the screens only: no new risks, texts or calls.
    const live = <T>(fn: (e: T) => void) => (e: T) => {
      if (!ctx.store.replaying) fn(e);
    };
    ctx.bus.on("location", live(engine.onLocation));
    ctx.bus.on("location", live((e) => responder.onLocation(e.roomId, Date.parse(e.ts) || Date.now())));
    ctx.bus.on("prediction", live(engine.onPrediction));
    ctx.bus.on("risk", live(engine.track));
    ctx.bus.on("risk", live(responder.onRisk));
    const outcomes = createOutcomeLog();
    ctx.bus.on("risk", live(outcomes.onRisk));
    // unref so the timer never keeps the process (or a test run) alive on its own.
    setInterval(engine.tick, TICK_MS).unref();

    // The glow is the first response: make sure the TV is on for it.
    ctx.bus.on("patient", (p) => {
      if (ctx.store.replaying) return;
      if (p.mode === "glow") void roku.wake();
    });

    // TV-room greeting (step 7): arriving where the rule says greet, with no response running, shows a welcome and
    // the next routine step, then the routine again. No risk event, no message.
    let greetedAt = 0;
    ctx.bus.on("location", (e) => {
      if (ctx.store.replaying) return;
      const ts = Date.parse(e.ts) || Date.now();
      const rule = ruleFor(zoneRules, room(e.roomId)?.kind, ts, HOUSEHOLD.timezone);
      if (rule?.action !== "greet" || responder.state().active.length || Date.now() - greetedAt < GREET_AGAIN_MS) return;
      greetedAt = Date.now();
      const greeting: PatientState = {
        householdId,
        mode: "greeting",
        message: greetingFor(ts, HOUSEHOLD.patientName, HOUSEHOLD.timezone),
        voicePath: `${householdId}/greeting.m4a`,
        updatedAt: new Date().toISOString(),
      };
      ctx.bus.emit("patient", greeting);
      setTimeout(() => {
        if (ctx.store.patient === "greeting") ctx.bus.emit("patient", { householdId, mode: "idle", updatedAt: new Date().toISOString() });
      }, GREETING_MS).unref();
    });

    // How tonight's responses ended, for the analytics page.
    ctx.http.get("/analytics/summary", () => summarize(outcomes.list()));

    // Alert log for the dashboard: numbers are never included, only who (primary or backup) and the context.
    ctx.http.get("/alerts", () => {
      const { alerts, active } = responder.state();
      return { alerts: [...alerts].reverse(), active, profile: profileName, twilio: notify.live ? "live" : "dry run" };
    });

    ctx.http.post("/ack/:alertId", ({ params }) => {
      if (!responder.ack(params.alertId)) throw new HttpError(404, "unknown alert");
      return { acknowledged: true };
    });

    ctx.http.get("/debug/state", () => {
      if (!ctx.cfg.debug) throw new HttpError(404, "not found");
      return { room: ctx.store.room, profile: profileName, ...responder.state() };
    });

    ctx.http.post("/debug/force-risk", ({ body }) => {
      if (!ctx.cfg.debug) throw new HttpError(404, "not found");
      const kind = field(body, "kind") as RiskKind;
      const roomId = field(body, "roomId");
      if (!RISK_KINDS.includes(kind)) throw new HttpError(400, `kind must be one of ${RISK_KINDS.join(", ")}`);
      if (typeof roomId !== "string" || !room(roomId)) throw new HttpError(400, "unknown roomId");
      const risk = engine.force(kind, roomId);
      if (!risk) throw new HttpError(409, `a ${kind} risk is already open`);
      return { riskEventId: risk.id };
    });

    // Drive the patient screen by hand (Part 6 step 2 tests).
    ctx.http.post("/debug/patient", ({ body }) => {
      if (!ctx.cfg.debug) throw new HttpError(404, "not found");
      const mode = field(body, "mode") as PatientMode;
      if (!PATIENT_MODES.includes(mode)) throw new HttpError(400, `mode must be one of ${PATIENT_MODES.join(", ")}`);
      const state = {
        householdId,
        mode,
        message: optionalString(field(body, "message")),
        photoPath: optionalString(field(body, "photoPath")),
        voicePath: optionalString(field(body, "voicePath")),
        updatedAt: new Date().toISOString(),
      };
      ctx.bus.emit("patient", state);
      return state;
    });
  },
};

export default actions;
