import assert from "node:assert/strict";
import { test } from "node:test";
import type { FamilyFacts } from "@/lib/cues/family";
import { createVoiceCaller } from "./vapi";

const facts: FamilyFacts = { name: "Patient", kind: "kitchen-night", room: "Kitchen", since: "3:04 AM", reminders: 3 };
const ENV = { VAPI_API_KEY: "test-key", VAPI_PHONE_NUMBER_ID: "pn1" };

test("off without a key or phone number, or with VAPI_DRY_RUN=1", () => {
  assert.equal(createVoiceCaller({}, () => {}).live, false);
  assert.equal(createVoiceCaller({ VAPI_API_KEY: "k" }, () => {}).live, false);
  assert.equal(createVoiceCaller({ ...ENV, VAPI_DRY_RUN: "1" }, () => {}).live, false);
  assert.equal(createVoiceCaller(ENV, () => {}).live, true);
});

test("places a call with the key, reads the outcome, and never logs the number", async () => {
  const requests: { url: string; init?: RequestInit }[] = [];
  const logs: string[] = [];
  const fake = (async (url: string, init?: RequestInit) => {
    requests.push({ url, init });
    if (init?.method === "POST") return new Response(JSON.stringify({ id: "call-1" }), { status: 201 });
    return new Response(JSON.stringify({ status: "ended", endedReason: "assistant-said-end-call-phrase", analysis: { structuredData: { canCheck: true } } }));
  }) as typeof fetch;
  const caller = createVoiceCaller(ENV, (...a) => logs.push(a.join(" ")), fake);

  assert.equal(await caller.place("+15550001", facts, "k1"), "call-1");
  assert.equal(requests[0].url, "https://api.vapi.ai/call");
  assert.equal((requests[0].init?.headers as Record<string, string>).Authorization, "Bearer test-key");
  const body = JSON.parse(String(requests[0].init?.body));
  assert.equal(body.customer.number, "+15550001");
  assert.equal(body.metadata.riskEventId, "k1");

  assert.equal(await caller.outcome("call-1"), "will-check");
  assert.equal(requests[1].url, "https://api.vapi.ai/call/call-1");
  assert.ok(logs.every((l) => !l.includes("5550001")));
});

test("a rejected call throws without the number in the message", async () => {
  const fake = (async () => new Response(JSON.stringify({ message: ["customer.number +15550001 is invalid"] }), { status: 400 })) as unknown as typeof fetch;
  const caller = createVoiceCaller(ENV, () => {}, fake);
  await assert.rejects(caller.place("+15550001", facts, "k1"), (e: Error) => /Vapi 400/.test(e.message) && !e.message.includes("5550001"));
});
