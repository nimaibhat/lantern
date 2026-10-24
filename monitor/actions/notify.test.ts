import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { contactAddress, createNotifier, withoutNumbers } from "./notify";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const logger = () => {
  const lines: string[] = [];
  return { lines, log: (...args: unknown[]) => void lines.push(args.join(" ")) };
};

test("dry run (no keys, or TWILIO_DRY_RUN=1) logs instead of sending, and never logs a number", async () => {
  const { lines, log } = logger();
  globalThis.fetch = (() => assert.fail("must not call Twilio")) as typeof fetch;
  const n = createNotifier({ TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "t", TWILIO_FROM_NUMBER: "+15550000000", TWILIO_DRY_RUN: "1" }, log);
  assert.equal(n.live, false);
  await n.sms("+16145550142", "Lantern: Patient is in the kitchen. Call +1 (614) 555-0142 back.");
  await n.call("+16145550142", "This is Lantern.");
  assert.equal(lines.length, 2);
  for (const l of lines) assert.doesNotMatch(l, /555/);
  assert.equal(createNotifier({}, log).live, false); // missing keys
});

test("live mode posts the message to Twilio with basic auth, and errors never carry a number", async () => {
  const { lines, log } = logger();
  const calls: { url: string; body: string; auth: string }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: String(init.body), auth: (init.headers as Record<string, string>).Authorization });
    return calls.length === 1
      ? new Response("{}", { status: 201 })
      : new Response(JSON.stringify({ code: 21608, message: "The number +16145550142 is unverified." }), { status: 400 });
  }) as typeof fetch;

  const n = createNotifier({ TWILIO_ACCOUNT_SID: "AC123", TWILIO_AUTH_TOKEN: "secret", TWILIO_FROM_NUMBER: "+15550000000" }, log);
  assert.equal(n.live, true);
  await n.sms("+16145550142", "hello");
  assert.match(calls[0].url, /Accounts\/AC123\/Messages\.json$/);
  assert.equal(new URLSearchParams(calls[0].body).get("Body"), "hello");
  assert.equal(calls[0].auth, `Basic ${Buffer.from("AC123:secret").toString("base64")}`);

  await assert.rejects(n.call("+16145550142", "x < y & z"), (e: Error) => {
    assert.match(e.message, /21608/);
    assert.doesNotMatch(e.message, /555/);
    return true;
  });
  assert.match(new URLSearchParams(calls[1].body).get("Twiml")!, /x &lt; y &amp; z/); // escaped for TwiML
  for (const l of lines) assert.doesNotMatch(l, /555|secret/);
});

test("contacts use their ntfy topic only when Twilio is not live and the topic is valid", () => {
  assert.equal(contactAddress("+16145550142", "lantern-abc", false), "ntfy:lantern-abc");
  assert.equal(contactAddress("+16145550142", "lantern-abc", true), "+16145550142"); // Twilio wins when live
  assert.equal(contactAddress("+16145550142", undefined, false), "+16145550142");
  assert.equal(contactAddress("", "bad topic!", false), ""); // spaces are not a topic
});

test("without Twilio, texts become ntfy pushes and calls urgent ones, each acknowledged in the background", async () => {
  const { lines, log } = logger();
  const sent: { url: string; body: Record<string, any>; auth?: string }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    sent.push({ url, body: JSON.parse(String(init.body)), auth: (init.headers as Record<string, string>).Authorization });
    return new Response("{}", { status: 200 });
  }) as typeof fetch;

  const n = createNotifier({ TWILIO_DRY_RUN: "1", NTFY_CAREGIVER_TOPIC: "lantern-abc", NTFY_TOKEN: "tk" }, log);
  assert.equal(n.live, false);
  assert.equal(n.ntfy, true);
  await n.sms("ntfy:lantern-abc", "Lantern: Patient is in the kitchen (3:07 AM). Acknowledge: http://192.168.1.5:3000/api/alerts/a1/ack");
  await n.call("ntfy:lantern-abc", "This is Lantern. Patient is in the kitchen.", "http://192.168.1.5:3000/api/alerts/a2/ack");
  await n.call("ntfy:lantern-abc", "No link this time.");

  const button = (id: string) => [{ action: "http", label: "Acknowledge", url: `http://192.168.1.5:3000/api/alerts/${id}/ack`, method: "GET", clear: true }];
  assert.equal(sent[0].url, "https://ntfy.sh");
  assert.equal(sent[0].auth, "Bearer tk");
  assert.equal(sent[0].body.topic, "lantern-abc");
  assert.equal(sent[0].body.priority, 4);
  assert.deepEqual(sent[0].body.actions, button("a1")); // found in the text
  assert.equal(sent[0].body.click, undefined); // tapping the alert never opens a web page
  assert.equal(sent[1].body.priority, 5);
  assert.deepEqual(sent[1].body.actions, button("a2")); // passed with the call, never spoken
  assert.doesNotMatch(sent[1].body.message, /http/);
  assert.equal(sent[2].body.actions, undefined);

  await n.confirm!("ntfy:lantern-abc", "Lantern: got it, thank you. Alerts stopped. Patient is in the kitchen.");
  assert.equal(sent[3].body.title, "Lantern: got it");
  assert.equal(sent[3].body.priority, 3); // quiet: it is good news
  assert.equal(sent[3].body.actions, undefined); // nothing left to acknowledge
  await n.confirm!("+16145550142", "x"); // a phone number: Twilio sends no confirmation
  assert.equal(sent.length, 4);
  for (const l of lines) assert.doesNotMatch(l, /lantern-abc/); // topics are never logged
});

test("with an ack topic, Acknowledge publishes the alert id to ntfy instead of calling a link", async () => {
  const sent: Record<string, any>[] = [];
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    sent.push(JSON.parse(String(init.body)));
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  const { log } = logger();
  const n = createNotifier({ TWILIO_DRY_RUN: "1", NTFY_CAREGIVER_TOPIC: "lantern-abc", NTFY_ACK_TOPIC: "lantern-ack-xyz" }, log);
  assert.deepEqual(n.acks, { server: "https://ntfy.sh", topic: "lantern-ack-xyz", token: undefined });
  await n.sms("ntfy:lantern-abc", "Lantern: Patient is in the kitchen. Tap when you are on it: http://localhost:3000/api/alerts/4c85-1f3e/ack");
  assert.deepEqual(sent[0].actions, [{ action: "http", label: "Acknowledge", url: "https://ntfy.sh/lantern-ack-xyz", method: "POST", body: "ack 4c85-1f3e", clear: true }]);
  assert.equal(sent[0].message, "Lantern: Patient is in the kitchen. Tap Acknowledge when you are on it."); // no dead link
  assert.equal(createNotifier({ TWILIO_DRY_RUN: "1", NTFY_ACK_TOPIC: "lantern-ack-xyz" }, log).acks, undefined); // no ntfy contacts, no listener
});

test("an ntfy error never carries the topic", async () => {
  const { log } = logger();
  globalThis.fetch = (async () => new Response("topic lantern-abc is reserved", { status: 403 })) as typeof fetch;
  const n = createNotifier({ NTFY_CAREGIVER_TOPIC: "lantern-abc" }, log);
  await assert.rejects(n.sms("ntfy:lantern-abc", "hi"), (e: Error) => {
    assert.match(e.message, /ntfy 403/);
    assert.doesNotMatch(e.message, /lantern-abc/);
    return true;
  });
});

test("with no Twilio and no ntfy topic, nothing is sent", async () => {
  const { lines, log } = logger();
  globalThis.fetch = (() => assert.fail("must not send")) as typeof fetch;
  const n = createNotifier({}, log);
  assert.equal(n.ntfy, false);
  await n.sms("ntfy:lantern-abc", "hi"); // a stale address without a topic configured is only logged
  assert.equal(lines.length, 1);
});

test("withoutNumbers hides phone numbers in any format", () => {
  assert.equal(withoutNumbers("call +1 (614) 555-0142 now"), "call [number] now");
  assert.equal(withoutNumbers("to 6145550142."), "to [number].");
  assert.equal(withoutNumbers("3 AM, 2 min"), "3 AM, 2 min");
});
