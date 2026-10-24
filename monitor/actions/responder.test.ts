import assert from "node:assert/strict";
import { test } from "node:test";
import type { PatientState, RiskEvent, RiskKind } from "@/lib/types";
import type { CallOutcome } from "@/lib/cues/vapi";
import { loadConfig } from "../config";
import { startMonitor } from "../server";
import { CALM_MS, CALL_POLL_S, ESCALATION, createResponder, escalateAfterS, type Here, type VoiceCaller } from "./responder";

const P = ESCALATION.demo;
const S = 1000;
const T0 = Date.parse("2026-01-15T08:00:00Z"); // 3:00 AM in New York
const GENTLE = escalateAfterS("kitchen-night", P); // after the glow

// A hand-cranked clock: advance(ms) runs every timer that comes due, in order.
function setup(opts: { voice?: VoiceCaller } = {}) {
  let clock = T0;
  let ids = 0;
  let timers: { at: number; fn: () => void; live: boolean }[] = [];
  const risks: RiskEvent[] = [];
  const screens: PatientState[] = [];
  const sent: string[] = [];
  const asked: { here: Here; cue: number }[] = [];
  const safe = new Set(["bedroom"]);

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
    redirectFor: (_risk, here, cue) => {
      asked.push({ here, cue });
      return { message: "Rosa, it's still nighttime. Let's go back to bed.", detail: `You're in the ${here.roomId}.`, route: [here.roomId, "bedroom"], photoPath: "h1/bedroom.jpg" };
    },
    closingFor: () => "Rosa, good night. Sleep well.",
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
    voice: opts.voice,
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

  const risk = (kind: RiskKind, roomId: string, upMinutesAgo?: number): RiskEvent => ({
    id: "k1", householdId: "h1", kind, roomId, trigger: "detected", state: "detected", source: "sim", startedAt: new Date(clock).toISOString(),
    ...(upMinutesAgo === undefined ? {} : { upSince: new Date(clock - upMinutesAgo * 60 * S).toISOString() }),
  });
  // Up long enough ago that the grace period is over.
  const kitchen = () => risk("kitchen-night", "kitchen", 10);
  return { responder, risks, screens, sent, asked, advance, risk, kitchen, modes: () => screens.map((s) => s.mode), states: () => risks.map((r) => r.state) };
}

// Let promise callbacks (voice-call results) run.
const settle = () => new Promise((r) => setImmediate(r));

test("a night risk waits out the grace period with nothing on screen", () => {
  const s = setup();
  s.responder.onRisk(s.risk("kitchen-night", "kitchen", 0));
  assert.deepEqual(s.modes(), []);
  assert.equal(s.risks[0].graceUntil, new Date(T0 + P.graceS * S).toISOString());
  s.advance(P.graceS * S - 1);
  assert.deepEqual(s.modes(), []);
  s.advance(1);
  assert.deepEqual(s.modes(), ["glow"]);
});

test("the grace period counts from getting out of bed, not from reaching the kitchen", () => {
  const s = setup();
  s.responder.onRisk(s.risk("kitchen-night", "kitchen", 10 / 60)); // up 10 s ago
  s.advance((P.graceS - 10) * S);
  assert.deepEqual(s.modes(), ["glow"]);
});

test("going back to bed during the grace period ends it quietly", () => {
  const s = setup();
  s.responder.onRisk(s.risk("kitchen-night", "kitchen", 0));
  s.advance(5 * S);
  s.responder.onLocation("bedroom", 0);
  s.advance(10 * 60 * S);
  assert.deepEqual(s.modes(), [], "no glow, no voice, no calm screen");
  assert.deepEqual(s.sent, []);
  assert.equal(s.states().at(-1), "resolved");
});

test("the front door never waits", () => {
  const s = setup();
  s.responder.onRisk(s.risk("exit-approach", "front-door", 0));
  assert.deepEqual(s.modes(), ["glow"]);
});

test("cues repeat with the same words, numbered, then stop at maxCues", () => {
  const s = setup();
  s.responder.onRisk(s.kitchen());
  s.advance(P.voiceAfterS * S);
  assert.deepEqual(s.modes(), ["glow", "photo_voice"]);
  assert.equal(s.screens[1].cue, 1);
  assert.equal(s.screens[1].detail, "You're in the kitchen.");
  assert.deepEqual(s.screens[1].route, ["kitchen", "bedroom"]);
  assert.equal(s.screens[1].roomId, "kitchen");
  s.advance((P.maxCues - 1) * P.repeatEveryS * S);
  const cues = s.screens.filter((x) => x.mode === "photo_voice");
  assert.deepEqual(cues.map((x) => x.cue), [1, 2, 3]);
  assert.equal(new Set(cues.map((x) => x.message)).size, 1, "same words every time");
  assert.equal(s.risks.at(-1)?.cues, 3);
  s.advance(5 * 60 * S);
  assert.equal(s.screens.filter((x) => x.mode === "photo_voice").length, 3);
});

test("the next cue starts from wherever they moved, and an unsure room is passed on", () => {
  const s = setup();
  s.responder.onRisk(s.kitchen());
  s.advance(P.voiceAfterS * S);
  s.responder.onLocation("hallway", 0, 0.4);
  s.advance(P.repeatEveryS * S);
  assert.deepEqual(s.asked.map((a) => [a.here.roomId, a.here.confident, a.cue]), [["kitchen", true, 1], ["hallway", false, 2]]);
});

test("back in bed after a cue: calm screen with the closing line, nothing sent", () => {
  const s = setup();
  s.responder.onRisk(s.kitchen());
  s.advance(P.voiceAfterS * S);
  s.responder.onLocation("bedroom", 0);
  s.advance(5 * 60 * S);
  assert.deepEqual(s.sent, []);
  assert.deepEqual(s.states(), ["redirecting", "redirecting", "resolved"]);
  assert.deepEqual(s.modes(), ["glow", "photo_voice", "calm", "idle"]);
  assert.equal(s.screens[2].message, "Rosa, good night. Sleep well.");
  assert.equal(s.screens[2].roomId, "bedroom");
});

test("gentle risks text the family once the last cue has had its time", () => {
  const s = setup();
  s.responder.onRisk(s.kitchen());
  s.advance(GENTLE * S - 1);
  assert.deepEqual(s.sent, []);
  s.advance(1);
  assert.equal(s.states().at(-1), "escalated");
  assert.equal(
    s.sent[0],
    "sms +15550001 Lantern: Rosa has been up since 2:50 AM and is in the kitchen. Lantern played 3 gentle reminders and Rosa has not gone back to bed yet. Could you check on Rosa? Tap when you are on it: http://lantern.test/api/alerts/a1/ack",
  );
});

test("urgent risks text on the usual timer while the cues go on", () => {
  const s = setup();
  s.responder.onRisk(s.risk("exit-approach", "front-door"));
  s.advance(P.smsAtS * S);
  assert.equal(s.sent.length, 1);
  assert.match(s.sent[0], /^sms \+15550001 Lantern: Rosa is at the front door \(3:00 AM\)\. A gentle reminder is playing\. Please check on Rosa now\./);
});

test("staying sends an SMS, then a call, then texts the backup, at the right times", () => {
  const s = setup();
  s.responder.onRisk(s.kitchen());
  s.advance(GENTLE * S);
  s.advance(P.callIfNoAckS * S);
  assert.deepEqual(s.sent.slice(1), ["call +15550001"]);
  s.advance((P.backupIfNoAckS - P.callIfNoAckS) * S);
  assert.equal(s.sent.length, 3);
  assert.match(s.sent[2], /^sms \+15550002 Lantern: .* The first contact has not been able to check\./);
  s.advance(10 * 60 * S);
  assert.equal(s.sent.length, 3, "nothing after the backup");
});

test("an acknowledgement stops everything, tells the others, and a second one is harmless", () => {
  const s = setup();
  s.responder.onRisk(s.kitchen());
  s.advance((GENTLE + P.backupIfNoAckS) * S); // primary texted and called, backup texted
  assert.equal(s.responder.ack("a1"), true);
  s.advance(10 * 60 * S);
  assert.equal(s.states().at(-1), "resolved");
  assert.equal(s.sent.at(-1), "sms +15550002 Lantern update: Maria is checking on Rosa now. No need to go.");
  assert.equal(s.sent.filter((x) => x.startsWith("sms +15550001")).length, 1, "the person who acknowledged gets nothing more");
  assert.equal(s.responder.ack("a1"), true);
  assert.equal(s.responder.ack("nope"), false);
});

test("going back after the family was texted sends an all clear and stops the call", () => {
  const s = setup();
  s.responder.onRisk(s.kitchen());
  s.advance(GENTLE * S + 5 * S);
  s.responder.onLocation("bedroom", 0);
  s.advance(10 * 60 * S);
  assert.equal(s.sent.length, 2);
  assert.match(s.sent[1], /^sms \+15550001 Lantern update: Rosa is back in the bedroom \(3:0\d AM\)\. No need to check\.$/);
});

test("an unsafe room does not end the response", () => {
  const s = setup();
  s.responder.onRisk(s.kitchen());
  s.responder.onLocation("front-door", 0);
  assert.equal(s.states().at(-1), "redirecting");
});

test("a risk closed elsewhere (a cancelled prediction) stops the ladder and calms the screen", () => {
  const s = setup();
  s.responder.onRisk({ ...s.kitchen(), trigger: "predicted" });
  s.advance(P.voiceAfterS * S);
  s.responder.onRisk({ ...s.kitchen(), trigger: "predicted", state: "resolved" });
  s.advance(CALM_MS + 10 * 60 * S);
  assert.deepEqual(s.sent, []);
  assert.deepEqual(s.modes(), ["glow", "photo_voice", "calm", "idle"]);
  assert.equal(s.screens[2].message, undefined, "no good-night line: they did not get back on their own");
});

test("updates for a risk already running do not start a second ladder", () => {
  const s = setup();
  s.responder.onRisk(s.kitchen());
  s.responder.onRisk({ ...s.kitchen(), arrivedAt: "x", leadTimeS: 12 });
  assert.deepEqual(s.modes(), ["glow"]);
  s.advance(GENTLE * S);
  assert.equal(s.sent.length, 1);
});

test("asking for help skips the grace period and texts the family now", () => {
  const s = setup();
  s.responder.onRisk(s.risk("kitchen-night", "kitchen", 0));
  assert.equal(s.responder.escalateNow("k1"), true);
  assert.deepEqual(s.modes(), ["glow"]);
  assert.equal(s.states().at(-1), "escalated");
  assert.equal(s.sent.length, 1);
  s.advance(GENTLE * S);
  assert.equal(s.sent.length, 1, "the scheduled text does not repeat it");
  assert.equal(s.responder.escalateNow("nope"), false);
});

function fakeVoice(result: CallOutcome) {
  const placed: string[] = [];
  let polls = 0;
  const voice: VoiceCaller = {
    live: true,
    async place(to, facts) {
      placed.push(`${to} ${facts.reminders}`);
      return "call-1";
    },
    async outcome() {
      return ++polls < 2 ? "pending" : result;
    },
  };
  return { voice, placed };
}

test("a voice-agent call that hears yes acknowledges and stops the backup", async () => {
  const v = fakeVoice("will-check");
  const s = setup({ voice: v.voice });
  s.responder.onRisk(s.kitchen());
  s.advance((GENTLE + P.callIfNoAckS) * S);
  await settle();
  assert.deepEqual(v.placed, ["+15550001 3"]);
  for (let i = 0; i < 3; i++) (s.advance(CALL_POLL_S * S), await settle());
  assert.equal(s.states().at(-1), "resolved");
  s.advance(10 * 60 * S);
  assert.equal(s.sent.filter((x) => x.startsWith("sms +15550002")).length, 0);
  assert.equal(s.responder.state().alerts.find((a) => a.channel === "call")?.status, "acknowledged");
});

test("a voice-agent call that hears no texts the backup at once", async () => {
  const v = fakeVoice("cannot");
  const s = setup({ voice: v.voice });
  s.responder.onRisk(s.kitchen());
  s.advance((GENTLE + P.callIfNoAckS) * S);
  await settle();
  for (let i = 0; i < 3; i++) (s.advance(CALL_POLL_S * S), await settle());
  assert.equal(s.sent.filter((x) => x.startsWith("sms +15550002")).length, 1);
  s.advance(10 * 60 * S);
  assert.equal(s.sent.filter((x) => x.startsWith("sms +15550002")).length, 1, "the backup timer does not text again");
});

test("through the monitor: a bathroom trip does nothing, a kitchen visit waits out its grace", async () => {
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
    assert.deepEqual(risks.map((r) => r.state), ["detected", "detected"]);
    assert.ok(risks[0].upSince, "the engine says when they got up");
    assert.ok(risks[1].graceUntil, "the responder says how long it waits");
    assert.equal(screens.length, 0);

    const state = await (await fetch(`${base}/debug/state`)).json();
    assert.equal(state.active[0].kind, "kitchen-night");

    await emit("bedroom");
    await new Promise((r) => setImmediate(r));
    assert.equal(risks.at(-1)?.state, "resolved");
    assert.equal(screens.length, 0, "back in bed before any cue: the screen never changed");
  } finally {
    await monitor.close();
  }
});

test("through the monitor: a typed message shows on the TV, and help needs a running response", async () => {
  const monitor = await startMonitor({ ...loadConfig({}), port: 0, debug: true });
  const base = `http://localhost:${monitor.port}`;
  const post = (path: string, body: unknown) => fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  try {
    const screens: PatientState[] = [];
    monitor.bus.on("patient", (p) => screens.push(p));
    const res = await post("/patient/say", { text: "  Maria is coming\nat 9.  " });
    assert.equal(res.status, 200);
    assert.deepEqual([screens[0].mode, screens[0].message], ["note", "Maria is coming at 9."]);
    assert.equal((await post("/patient/say", { text: "   " })).status, 400);
    assert.equal((await post("/help", {})).status, 409);
  } finally {
    await monitor.close();
  }
});
