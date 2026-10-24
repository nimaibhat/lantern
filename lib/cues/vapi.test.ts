import assert from "node:assert/strict";
import { test } from "node:test";
import type { FamilyFacts } from "./family";
import { HELP_TOOL, VAPI_MODEL, callOutcome, companionAssistant, companionPrompt, familyCallAssistant, familyCallRequest } from "./vapi";

const facts: FamilyFacts = { name: "Patient", kind: "kitchen-night", room: "Kitchen", since: "3:04 AM", reminders: 3 };

test("a family call sends the whole assistant when no dashboard assistant is set", () => {
  const body = familyCallRequest({ phoneNumberId: "pn1", to: "+15550001", facts, riskEventId: "k1" }) as Record<string, any>;
  assert.equal(body.phoneNumberId, "pn1");
  assert.deepEqual(body.customer, { number: "+15550001" });
  assert.deepEqual(body.metadata, { riskEventId: "k1" });
  assert.equal(body.assistant.model.provider, "anthropic");
  assert.equal(body.assistant.model.model, VAPI_MODEL);
  assert.match(body.assistant.firstMessage, /^Hi, this is Lantern, calling about Patient\. Patient has been up since 3:04 AM/);
  assert.equal(body.assistant.artifactPlan.recordingEnabled, false);
  assert.equal(body.assistant.analysisPlan.structuredDataPlan.schema.required[0], "canCheck");
});

test("a dashboard assistant gets the facts as variables instead", () => {
  const body = familyCallRequest({ phoneNumberId: "pn1", to: "+1", facts, assistantId: "as1", riskEventId: "k1" }) as Record<string, any>;
  assert.equal(body.assistantId, "as1");
  assert.equal(body.assistant, undefined);
  assert.equal(body.assistantOverrides.variableValues.name, "Patient");
  assert.equal(body.assistantOverrides.variableValues.reminders, "3");
});

test("the family prompt keeps to the facts and never claims to be a person", () => {
  const prompt = (familyCallAssistant(facts) as any).model.messages[0].content as string;
  assert.match(prompt, /Never claim to be a person/);
  assert.match(prompt, /call 911/);
  assert.match(prompt, /Take care\./);
});

test("call outcomes", () => {
  assert.equal(callOutcome({ status: "in-progress" }), "pending");
  assert.equal(callOutcome({ status: "ended", endedReason: "customer-did-not-answer" }), "no-answer");
  assert.equal(callOutcome({ status: "ended", endedReason: "voicemail" }), "no-answer");
  assert.equal(callOutcome({ status: "ended", endedReason: "assistant-said-end-call-phrase", analysis: { structuredData: { canCheck: true } } }), "will-check");
  assert.equal(callOutcome({ status: "ended", endedReason: "customer-ended-call", analysis: { structuredData: { canCheck: false } } }), "cannot");
  assert.equal(callOutcome({ status: "ended", endedReason: "customer-ended-call" }), "unknown");
  assert.equal(callOutcome(null), "unknown");
});

test("the companion speaks the same cue first, calmly, and can ask the family for help", () => {
  const a = companionAssistant({ name: "Patient", kind: "kitchen-night", message: "Patient, it's still nighttime. Let's go back to bed.", detail: "You're in the kitchen.", night: true }) as Record<string, any>;
  assert.equal(a.firstMessage, "Patient, it's still nighttime. Let's go back to bed. You're in the kitchen.");
  assert.equal(a.voice.voiceId, "Zoe");
  assert.deepEqual(a.endCallPhrases, ["sleep well"]);
  assert.equal(a.model.tools[0].function.name, HELP_TOOL);
  assert.deepEqual(a.clientMessages, ["tool-calls"]);
  const prompt = companionPrompt({ name: "Patient", kind: "exit-approach", message: "", night: false });
  assert.match(prompt, /Start what you say with Patient's name/);
  assert.match(prompt, /Never mention danger/);
  assert.match(prompt, /See you soon, Patient\. Take care\./);
});
