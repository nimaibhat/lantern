// Actions module (owner: Aarnav): risk rules, the responder, Twilio messages, the Roku wake-up and the
// TV-room greeting (Part 6).

import type { PatientMode, PatientState, RiskEvent, RiskKind, ZoneRule } from "@/lib/types";
import { cleanNote, closingLine, cueScript, greetingLine } from "@/lib/cues/script";
import { HttpError, type MonitorModule } from "../module";
import { createOutcomeLog, nightSummary, summarize } from "./analytics";
import { createDwell } from "./dwell";
import { createNotifier } from "./notify";
import { ESCALATION, createResponder, type EscalationProfile, type Redirect } from "./responder";
import { createRiskEngine, isQuiet, localMinutes, resolves, ruleFor } from "./risk";
import { RokuClient } from "./roku";
import { loadSettings, type HouseholdSettings } from "./settings";
import { createVoiceCaller } from "./vapi";

const TICK_MS = 15_000;

// Defaults until Supabase answers, and the fallback without keys (settings.ts). Same as supabase/seed.sql.
const DEFAULT_HOUSEHOLD: HouseholdSettings = { patientName: "Rosa", quietHoursStart: "21:00", quietHoursEnd: "07:00", timezone: "America/New_York" };
// A scanned home calls the TV room "Living room" as often as "TV room", so both greet.
export const rules = (householdId: string): ZoneRule[] => [
  { id: "z1", householdId, roomKind: "front-door", kind: "exit-approach", startHour: 0, endHour: 24, action: "redirect" },
  { id: "z2", householdId, roomKind: "kitchen", kind: "kitchen-night", startHour: 22, endHour: 6, action: "redirect" },
  { id: "z3", householdId, roomKind: "bathroom", startHour: 22, endHour: 6, action: "allow" },
  { id: "z4", householdId, roomKind: "tv-room", startHour: 8, endHour: 20, action: "greet" },
  { id: "z5", householdId, roomKind: "living", startHour: 8, endHour: 20, action: "greet" },
];

const RISK_KINDS: RiskKind[] = ["exit-approach", "night-wandering", "kitchen-night", "long-bathroom-stay", "no-movement"];
const PATIENT_MODES: PatientMode[] = ["idle", "glow", "photo_voice", "greeting", "calm", "note"];

// The caregiver's recordings (Settings). They play from the second reminder on; the first one says where they are
// and the way back, which a fixed recording cannot (docs/cues.md).
const VOICE_SLOT: Partial<Record<RiskKind, string>> = { "kitchen-night": "kitchen", "night-wandering": "bedtime", "exit-approach": "front-door" };

const GREETING_MS = 15_000; // how long the greeting stays before the routine comes back
const GREET_AGAIN_MS = 10 * 60_000; // walking in and out of the TV room should not greet every time
const NOTE_MS = 60_000; // how long a caregiver's message stays on the TV

// CUE_GRACE_MIN (0 to 15) overrides the grace period of either profile.
function profileFrom(env: Record<string, string | undefined>, name: "demo" | "real"): EscalationProfile {
  const min = Number(env.CUE_GRACE_MIN);
  const grace = env.CUE_GRACE_MIN !== undefined && env.CUE_GRACE_MIN !== "" && min >= 0 && min <= 15 ? { graceS: Math.round(min * 60) } : {};
  return { ...ESCALATION[name], ...grace };
}

const field = (body: unknown, key: string): unknown => (body && typeof body === "object" ? (body as Record<string, unknown>)[key] : undefined);
const optionalString = (v: unknown) => (typeof v === "string" ? v : undefined);

const actions: MonitorModule = {
  name: "actions",
  register(ctx) {
    const householdId = ctx.cfg.householdId;
    // Updated in place by reload(), so the engine and responder always read the saved values.
    const HOUSEHOLD = { ...DEFAULT_HOUSEHOLD };
    const zoneRules = rules(householdId);
    const room = (id: string) => ctx.world().rooms.find((r) => r.id === id);
    const profileName = process.env.ESCALATION_PROFILE === "real" ? "real" : "demo";
    const profile = profileFrom(process.env, profileName);
    const notify = createNotifier(process.env, ctx.log);
    const voice = createVoiceCaller(process.env, ctx.log);
    const roku = new RokuClient(process.env.ROKU_HOST || undefined, ctx.log);
    const night = () => isQuiet(Date.now(), HOUSEHOLD);

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
      get patientName() {
        return HOUSEHOLD.patientName;
      },
      get timeZone() {
        return HOUSEHOLD.timezone;
      },
      profile,
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
      // Built from the scan at each reminder, so a person who moved hears the way back from where they are now.
      redirectFor: (risk, here, cue): Redirect => {
        const slot = VOICE_SLOT[risk.kind];
        const script = cueScript({ kind: risk.kind, name: HOUSEHOLD.patientName, home: ctx.world(), roomId: here.roomId, confident: here.confident, night: night() });
        return {
          ...script,
          // The caregiver's chosen photo (Settings). /api/patient/media falls back to the scanned bedroom photo.
          photoPath: `${householdId}/redirect-photo.jpg`,
          voicePath: slot && cue >= 2 ? `${householdId}/redirect-${slot}.m4a` : undefined,
        };
      },
      // "Good night, sleep well" only in bed; leaving the kitchen for the TV room at 3 AM gets a plain thank you.
      closingFor: (_risk, roomId) => closingLine(HOUSEHOLD.patientName, night() && room(roomId)?.kind === "bedroom"),
      settled: (roomId) => !night() || room(roomId)?.kind === "bedroom",
      emitRisk: later((risk: RiskEvent) => ctx.bus.emit("risk", risk)),
      emitPatient: later((state) => ctx.bus.emit("patient", state)),
      notify,
      voice,
      log: ctx.log,
    });
    ctx.log(
      "actions",
      `escalation profile ${profileName} (grace ${profile.graceS} s); twilio ${notify.live ? "live" : "dry run"}; vapi ${voice.live ? "live" : "off"}; roku ${roku.configured ? "on" : "dry run"}`,
    );

    // Saved Settings and zone rules. Runs once on start; Settings calls /household/reload after a save.
    async function reload() {
      const saved = await loadSettings(householdId);
      if (saved?.household) Object.assign(HOUSEHOLD, saved.household);
      if (saved?.rules) zoneRules.splice(0, zoneRules.length, ...saved.rules);
      return { source: saved ? "supabase" : "defaults", patientName: HOUSEHOLD.patientName, quietHours: `${HOUSEHOLD.quietHoursStart} to ${HOUSEHOLD.quietHoursEnd}`, rules: zoneRules.length };
    }
    reload()
      .then((r) => ctx.log("actions", `household from ${r.source}: quiet hours ${r.quietHours}, ${r.rules} zone rules`))
      .catch((e) => ctx.log("actions", "household load failed, using the defaults:", (e as Error).message));
    ctx.http.post("/household/reload", async () => {
      const r = await reload();
      ctx.log("actions", `household reloaded: quiet hours ${r.quietHours}, ${r.rules} zone rules`);
      return r;
    });

    // A replay (/replay/start) re-emits a recorded night for the screens only: no new risks, texts or calls.
    const live = <T>(fn: (e: T) => void) => (e: T) => {
      if (!ctx.store.replaying) fn(e);
    };
    ctx.bus.on("location", live(engine.onLocation));
    ctx.bus.on("location", live((e) => responder.onLocation(e.roomId, Date.parse(e.ts) || Date.now(), e.confidence)));
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
        message: greetingLine(HOUSEHOLD.patientName, localMinutes(ts, HOUSEHOLD.timezone) / 60),
        voicePath: `${householdId}/greeting.m4a`,
        updatedAt: new Date().toISOString(),
      };
      ctx.bus.emit("patient", greeting);
      setTimeout(() => {
        if (ctx.store.patient === "greeting") ctx.bus.emit("patient", { householdId, mode: "idle", updatedAt: new Date().toISOString() });
      }, GREETING_MS).unref();
    });

    // Time away: where they are, for how long, out of bed at night, minutes per room today.
    const dwell = createDwell({
      get timeZone() {
        return HOUSEHOLD.timezone;
      },
      quiet: (t) => isQuiet(t, HOUSEHOLD),
      roomKind: (id) => room(id)?.kind,
    });
    ctx.bus.on("location", live((e) => dwell.onLocation(e.roomId)));
    ctx.http.get("/dwell", () => dwell.state());

    // How tonight's responses ended, for the analytics page, with last night in one paragraph.
    const clock = (iso: string) => new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: HOUSEHOLD.timezone }).format(Date.parse(iso) || Date.now());
    const lastNight = () => {
      const since = Date.now() - 18 * 60 * 60_000;
      return nightSummary(outcomes.list(), HOUSEHOLD.patientName, (o) => Date.parse(o.startedAt) > since && isQuiet(Date.parse(o.startedAt), HOUSEHOLD), clock);
    };
    ctx.http.get("/analytics/summary", () => ({ ...summarize(outcomes.list()), night: lastNight() }));

    // MORNING_SUMMARY_SMS=1: text last night to the primary contact as quiet hours end. Off by default.
    if (process.env.MORNING_SUMMARY_SMS === "1") {
      let wasQuiet = night();
      setInterval(() => {
        const quietNow = night();
        if (wasQuiet && !quietNow && !ctx.store.replaying) {
          ctx.log("actions", "morning summary to primary");
          notify.sms(process.env.CAREGIVER_PHONE_NUMBER ?? "", `Lantern, last night: ${lastNight()}`).catch((e) => ctx.log("actions", "morning summary failed:", (e as Error).message));
        }
        wasQuiet = quietNow;
      }, 60_000).unref();
    }

    // Alert log for the dashboard: numbers are never included, only who (primary or backup) and the context.
    ctx.http.get("/alerts", () => {
      const { alerts, active } = responder.state();
      return { alerts: [...alerts].reverse(), active, profile: profileName, twilio: notify.live ? "live" : "dry run" };
    });

    ctx.http.post("/ack/:alertId", ({ params }) => {
      if (!responder.ack(params.alertId)) throw new HttpError(404, "unknown alert");
      return { acknowledged: true };
    });

    // The companion voice heard a call for help (or a caregiver pressed the button): tell the family now.
    ctx.http.post("/help", ({ body }) => {
      const riskEventId = optionalString(field(body, "riskEventId"));
      if (!responder.escalateNow(riskEventId)) throw new HttpError(409, "no response is running");
      ctx.log("actions", "help asked:", optionalString(field(body, "reason"))?.slice(0, 80) ?? "");
      return { escalated: true };
    });

    // A message the caregiver typed on the dashboard: shown and said on the TV, then the routine comes back.
    // A running redirect keeps the screen; the message would talk over it.
    let noteAt = 0;
    ctx.http.post("/patient/say", ({ body }) => {
      const text = cleanNote(field(body, "text"));
      if (!text) throw new HttpError(400, "text required");
      if (responder.state().active.some((r) => r.state !== "detected")) throw new HttpError(409, "a reminder is playing; try again in a moment");
      const at = (noteAt = Date.now());
      const note: PatientState = { householdId, mode: "note", message: text, roomId: ctx.store.room, updatedAt: new Date(at).toISOString() };
      ctx.bus.emit("patient", note);
      ctx.log("actions", `caregiver message (${text.length} chars)`); // the text itself stays off the log
      setTimeout(() => {
        if (noteAt === at && ctx.store.patient === "note") ctx.bus.emit("patient", { householdId, mode: "idle", updatedAt: new Date().toISOString() });
      }, NOTE_MS).unref();
      return { shown: true, text };
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
