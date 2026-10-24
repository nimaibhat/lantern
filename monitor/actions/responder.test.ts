import assert from "node:assert/strict";
import { test } from "node:test";
import type { PatientState, RiskEvent } from "@/lib/types";
import { loadConfig } from "../config";
import { startMonitor } from "../server";
import { CALM_MS, ESCALATION, createResponder } from "./responder";

const P = ESCALATION.demo;
const S = 1000;

// A hand-cranked clock: advance(ms) runs every timer that comes due, in order.
function setup() {
  let clock = 0;
  let ids = 0;
  let timers: { at: number; fn: () => void; live: boolean }[] = [];
  const risks: RiskEvent[] = [];
  const screens: PatientState[] = [];
  const sent: string[] = [];
  const safe = new Set(["bedroom", "hallway"]);

  const responder = createResponder({
    householdId: "h1",
    patientName: "Rosa",
    timeZone: "America/New_York",
    profile: P,
    contacts: [
      { name: "Maria", phone: "+15550001", priority: 1 },
      { name: "Luis", phone: "+15550002", priority: 2 },
    ],
    baseUrl: "http://lantern.test",
    roomName: (id) => id[0].toUpperCase() + id.slice(1),
    isSafe: (_risk, roomId) => safe.has(roomId),
    redirectFor: () => ({ message: "It's still night, Rosa. Let's go back to bed.", photoPath: "h1/bedroom.jpg", voicePath: "h1/redirect-kitchen.m4a" }),
    emitRisk: (r) => risks.push(r),
    emitPatient: (s) => screens.push(s),
    notify: {
      async sms(to, body) {
        sent.push(`sms ${to} ${body}`);
      },
      async call(to) {
        sent.push(`call ${to}`);
      },
    },
    log: () => {},
    later: (ms, fn) => {
      const t = { at: clock + ms, fn, live: true };
      timers.push(t);
      return () => (t.live = false);
    },
    now: () => clock,
    newId: () => `a${++ids}`,
  });

  const advance = (ms: number) => {
    const end = clock + ms;
    for (;;) {
      const next = timers.filter((t) => t.live && t.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      clock = next.at;
      next.live = false;
      next.fn();
    }
    clock = end;
    timers = timers.filter((t) => t.live);
  };

  const kitchen: RiskEvent = { id: "k1", householdId: "h1", kind: "kitchen-night", roomId: "kitchen", trigger: "detected", state: "detected", source: "sim", startedAt: "" };
  return { responder, risks, screens, sent, advance, kitchen, modes: () => screens.map((s) => s.mode), states: () => risks.map((r) => r.state) };
}

test("a new risk glows at once, then shows the photo and voice", () => {
  const s = setup();
  s.responder.onRisk(s.kitchen);
  assert.deepEqual(s.states(), ["redirecting"]);
  assert.deepEqual(s.modes(), ["glow"]);
  s.advance(P.voiceAfterS * S);
  assert.deepEqual(s.modes(), ["glow", "photo_voice"]);
  assert.equal(s.screens[1].voicePath, "h1/redirect-kitchen.m4a");
  assert.equal(s.screens[1].riskEventId, "k1");
});

test("(a) returning to a safe room in time sends nothing", () => {
  const s = setup();
  s.responder.onRisk(s.kitchen);
  s.advance(10 * S);
  s.responder.onLocation("bedroom", 0);
  s.advance(5 * 60 * S);
  assert.deepEqual(s.sent, []);
  assert.deepEqual(s.states(), ["redirecting", "resolved"]);
  assert.deepEqual(s.modes(), ["glow", "photo_voice", "calm", "idle"]);
});

test("(b) staying sends an SMS, then a call, then texts the backup, at the right times", () => {
  const s = setup();
  s.responder.onRisk(s.kitchen);
  s.advance(P.smsAtS * S - 1);
  assert.deepEqual(s.sent, []);
  s.advance(1);
  assert.equal(s.states().at(-1), "escalated");
  assert.equal(s.sent.length, 1);
  assert.match(s.sent[0], /^sms \+15550001 Lantern: Rosa is in the kitchen \(.+\)\. Redirect played\. Acknowledge: http:\/\/lantern\.test\/api\/alerts\/a1\/ack$/);

  s.advance(P.callIfNoAckS * S);
  assert.deepEqual(s.sent.slice(1), ["call +15550001"]);
  s.advance((P.backupIfNoAckS - P.callIfNoAckS) * S);
  assert.equal(s.sent.length, 3);
  assert.match(s.sent[2], /^sms \+15550002 /);
  s.advance(10 * 60 * S);
  assert.equal(s.sent.length, 3, "nothing after the backup");
});

test("(c) an acknowledgement stops everything, and a second one is harmless", () => {
  const s = setup();
  s.responder.onRisk(s.kitchen);
  s.advance(P.smsAtS * S);
  assert.equal(s.responder.ack("a1"), true);
  s.advance(10 * 60 * S);
  assert.equal(s.sent.length, 1);
  assert.equal(s.states().at(-1), "resolved");
  assert.equal(s.responder.ack("a1"), true);
  assert.equal(s.responder.ack("nope"), false);
});

test("returning after the SMS still stops the call and the backup", () => {
  const s = setup();
  s.responder.onRisk(s.kitchen);
  s.advance(P.smsAtS * S + 5 * S);
  s.responder.onLocation("hallway", 0);
  s.advance(10 * 60 * S);
  assert.equal(s.sent.length, 1);
});

test("an unsafe room does not end the response", () => {
  const s = setup();
  s.responder.onRisk(s.kitchen);
  s.responder.onLocation("front-door", 0);
  assert.equal(s.states().at(-1), "redirecting");
});

test("a risk closed elsewhere (a cancelled prediction) stops the ladder and calms the screen", () => {
  const s = setup();
  s.responder.onRisk({ ...s.kitchen, trigger: "predicted" });
  s.advance(10 * S);
  s.responder.onRisk({ ...s.kitchen, trigger: "predicted", state: "resolved" });
  s.advance(CALM_MS + 10 * 60 * S);
  assert.deepEqual(s.sent, []);
  assert.deepEqual(s.modes(), ["glow", "photo_voice", "calm", "idle"]);
});

test("updates for a risk already running do not start a second ladder", () => {
  const s = setup();
  s.responder.onRisk(s.kitchen);
  s.responder.onRisk({ ...s.kitchen, arrivedAt: "x", leadTimeS: 12 });
  assert.deepEqual(s.modes(), ["glow"]);
  s.advance(P.smsAtS * S);
  assert.equal(s.sent.length, 1);
});

test("(d) through the monitor: a night bathroom trip only lights up, a kitchen visit runs the ladder", async () => {
  const monitor = await startMonitor({ ...loadConfig({}), port: 0, debug: true });
  const base = `http://localhost:${monitor.port}`;
  const emit = (roomId: string) =>
    fetch(`${base}/debug/emit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event: "location", payload: { id: roomId, householdId: "h1", roomId, confidence: 1, source: "sim", ts: "2026-01-15T08:00:00Z" } }),
    });
  try {
    const risks: RiskEvent[] = [];
    const screens: PatientState[] = [];
    monitor.bus.on("risk", (r) => risks.push(r));
    monitor.bus.on("patient", (p) => screens.push(p));

    await emit("bathroom");
    assert.equal(risks.length, 0);
    assert.equal(screens.length, 0);

    await emit("kitchen");
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(risks.map((r) => r.state), ["detected", "redirecting"]);
    assert.deepEqual(screens.map((p) => p.mode), ["glow"]);

    const state = await (await fetch(`${base}/debug/state`)).json();
    assert.equal(state.active[0].kind, "kitchen-night");

    await emit("bedroom");
    await new Promise((r) => setImmediate(r));
    assert.equal(risks.at(-1)?.state, "resolved");
    assert.equal(screens.at(-1)?.mode, "calm");
  } finally {
    await monitor.close();
  }
});
