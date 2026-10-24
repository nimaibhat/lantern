// Actions module (owner: Aarnav): risk rules, the responder, Twilio messages, the Roku wake-up and the
// TV-room greeting (Part 6).

import type { PatientMode, PatientState, RiskEvent, RiskKind, ZoneRule } from "@/lib/types";
import { createOutcomeLog, summarize } from "./analytics";
import { createNotifier } from "./notify";
import { ESCALATION, createResponder, type Redirect } from "./responder";
import { createRiskEngine, localMinutes, resolves, ruleFor } from "./risk";
import { RokuClient } from "./roku";
const GREETING_MS = 15_000; // how long the greeting stays before the routine comes back
const GREET_AGAIN_MS = 10 * 60_000; // walking in and out of the TV room should not greet every time

function greetingFor(ts: number, name: string, timeZone: string) {
  const h = localMinutes(ts, timeZone) / 60;
  return `${h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"}, ${name}.`;
}

const actions: MonitorModule = {
  name: "actions",
    const notify = createNotifier(process.env, ctx.log);
    const roku = new RokuClient(process.env.ROKU_HOST || undefined, ctx.log);
          // The caregiver's chosen photo (Settings). /api/patient/media falls back to the scanned bedroom photo.
          photoPath: `${householdId}/redirect-photo.jpg`,
      notify,
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

};

export default actions;
