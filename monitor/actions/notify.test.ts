import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createNotifier, withoutNumbers } from "./notify";

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
  await n.sms("+16145550142", "Lantern: Rosa is in the kitchen. Call +1 (614) 555-0142 back.");
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

test("withoutNumbers hides phone numbers in any format", () => {
  assert.equal(withoutNumbers("call +1 (614) 555-0142 now"), "call [number] now");
  assert.equal(withoutNumbers("to 6145550142."), "to [number].");
  assert.equal(withoutNumbers("3 AM, 2 min"), "3 AM, 2 min");
});
