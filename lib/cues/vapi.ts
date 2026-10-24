// Vapi voice agents (docs/vapi.md). Pure config builders and result parsing, shared by the monitor (phone calls to
// the family) and the TV page (the companion voice), so the tests can pin the prompts. Keys never live here.
// Request shapes follow Vapi's API: POST /call with phoneNumberId, customer.number and an assistant or assistantId.

import type { RiskKind } from "@/lib/types";
import { situation, type FamilyFacts } from "./family";

export const VAPI_API = "https://api.vapi.ai";
export const VAPI_MODEL = "claude-haiku-5-5"; // a quick reply matters more than depth on a call
// From Vapi's voice catalog: Zoe is "calm, soothing", Elliot is "natural, calm".
export const COMPANION_VOICE = "Zoe";
export const FAMILY_VOICE = "Elliot";
export const HELP_TOOL = "ask_family_for_help";

type Json = Record<string, unknown>;

const transcriber = { provider: "deepgram", model: "nova-3", language: "en" };

// After the call, Vapi extracts this from the transcript into call.analysis.structuredData.
const OUTCOME_SCHEMA = {
  type: "object",
  properties: {
    canCheck: { type: "boolean", description: "True only if the family member said they will check on the person now." },
    note: { type: "string", description: "Anything the family member asked Lantern to pass on, in a few words. Empty if nothing." },
  },
  required: ["canCheck"],
};

function familyPrompt(f: FamilyFacts): string {
  return [
    `You are Lantern, an automated home safety assistant. You are calling a family member of ${f.name}, who lives with dementia.`,
    `What is happening: ${situation(f)}`,
    "Your job, in order:",
    "1. If they have questions, answer in one or two short sentences, using only the facts above.",
    `2. Ask whether they can check on ${f.name} now.`,
    "3. If they say yes, thank them and end with exactly: Thank you. Take care.",
    "4. If they say no or cannot, say you will reach the next contact, then end with exactly: Okay, I will reach the next person. Take care.",
    "Rules:",
    "- Be calm, warm and brief. This person may have just woken up.",
    "- If you do not know something, say so and mention the Lantern dashboard has the latest.",
    "- Never give medical advice. If they describe an emergency, tell them to call 911.",
    "- You are automated. Say so if asked. Never claim to be a person.",
    `- Refer to ${f.name} by name, not with pronouns.`,
  ].join("\n");
}

export function familyCallAssistant(f: FamilyFacts, opts: { model?: string; voiceId?: string } = {}): Json {
  const facts = situation(f);
  return {
    name: "Lantern family check-in",
    firstMessage: `Hi, this is Lantern, calling about ${f.name}. ${facts} Can you check on ${f.name} now?`,
    model: { provider: "anthropic", model: opts.model || VAPI_MODEL, temperature: 0.3, maxTokens: 150, messages: [{ role: "system", content: familyPrompt(f) }] },
    voice: { provider: "vapi", voiceId: opts.voiceId || FAMILY_VOICE, version: 2 },
    transcriber,
    endCallPhrases: ["take care"],
    voicemailMessage: `This is Lantern, calling about ${f.name}. ${facts} Please check your Lantern text message.`,
    maxDurationSeconds: 180,
    silenceTimeoutSeconds: 20,
    artifactPlan: { recordingEnabled: false },
    analysisPlan: { structuredDataPlan: { enabled: true, schema: OUTCOME_SCHEMA } },
  };
}

// The POST /call body. With an assistant made in the Vapi dashboard, its prompt can use {{name}}, {{situation}},
// {{since}}, {{room}} and {{reminders}}; otherwise the whole assistant is sent with the call.
export function familyCallRequest(input: {
  phoneNumberId: string;
  to: string;
  facts: FamilyFacts;
  assistantId?: string;
  model?: string;
  voiceId?: string;
  riskEventId: string;
}): Json {
  const { facts } = input;
  const base = { phoneNumberId: input.phoneNumberId, customer: { number: input.to }, name: `Lantern ${facts.kind}`, metadata: { riskEventId: input.riskEventId } };
  if (input.assistantId) {
    const variableValues = { name: facts.name, situation: situation(facts), since: facts.since, room: facts.room, reminders: String(facts.reminders) };
    return { ...base, assistantId: input.assistantId, assistantOverrides: { variableValues } };
  }
  return { ...base, assistant: familyCallAssistant(facts, input) };
}

export type CallOutcome = "pending" | "will-check" | "cannot" | "no-answer" | "unknown";

// GET /call/:id. Ended calls report endedReason (customer-did-not-answer, customer-busy, voicemail, ...).
export function callOutcome(call: unknown): CallOutcome {
  if (!call || typeof call !== "object") return "unknown";
  const c = call as { status?: string; endedReason?: string; analysis?: { structuredData?: { canCheck?: unknown } } };
  if (c.status !== "ended") return "pending";
  if (/did-not-answer|busy|voicemail|failed|no-answer/i.test(c.endedReason ?? "")) return "no-answer";
  const canCheck = c.analysis?.structuredData?.canCheck;
  return canCheck === true ? "will-check" : canCheck === false ? "cannot" : "unknown";
}

// The companion: a calm two-way voice on the TV page, opt-in, after the first scripted cue has not worked.

const GOAL: Record<RiskKind, (name: string) => string> = {
  "kitchen-night": (n) => `${n} got up in the night and is in the kitchen. Help ${n} feel safe and go back to bed.`,
  "night-wandering": (n) => `${n} got up in the night and has been up for a while. Help ${n} feel safe and go back to bed.`,
  "exit-approach": (n) => `${n} is by the front door. Help ${n} feel at home and stay inside. Never mention danger.`,
  "long-bathroom-stay": (n) => `${n} has been in the bathroom for a long time. Check that ${n} is all right.`,
  "no-movement": (n) => `${n} has been sitting still for a long time. Suggest a glass of water or a little stretch.`,
};

export interface CompanionFacts {
  name: string;
  kind: RiskKind;
  message: string; // the scripted cue, said first so the voice matches the screen
  detail?: string;
  night: boolean;
}

export function companionPrompt(c: CompanionFacts): string {
  const close = c.night ? `Good night, ${c.name}. Sleep well.` : `See you soon, ${c.name}. Take care.`;
  return [
    `You are Lantern, a calm, gentle voice in ${c.name}'s home. ${c.name} lives with dementia.`,
    GOAL[c.kind](c.name),
    c.detail ? `Where ${c.name} is and the way back: ${c.detail}` : "",
    "How to talk:",
    `- Start what you say with ${c.name}'s name.`,
    "- Very short sentences, at most 12 words. One idea at a time. Warm and slow.",
    "- Invite, never order. Say \"Let's\" instead of giving commands.",
    "- Never argue, correct, or quiz memory. If something is not true, go along kindly and steer back.",
    "- Name feelings and reassure: \"You're safe.\" \"I'm right here.\"",
    "- You are not a person and not family. If asked, say you are Lantern, the voice that helps around the house.",
    "- No medical advice.",
    `- If ${c.name} is hurt, fell, feels unwell, is scared, or asks for someone, call ${HELP_TOOL}, then say: I'm letting your family know. You're safe.`,
    `- When ${c.name} agrees, end with exactly: ${close}`,
  ].filter(Boolean).join("\n");
}

export function companionAssistant(c: CompanionFacts, opts: { model?: string; voiceId?: string } = {}): Json {
  return {
    name: "Lantern companion",
    firstMessage: [c.message, c.detail].filter(Boolean).join(" "),
    firstMessageMode: "assistant-speaks-first",
    model: {
      provider: "anthropic",
      model: opts.model || VAPI_MODEL,
      temperature: 0.4,
      maxTokens: 80,
      messages: [{ role: "system", content: companionPrompt(c) }],
      // No server URL: Vapi hands the call to the browser, which asks the monitor to reach the family.
      tools: [{
        type: "function",
        async: true,
        function: {
          name: HELP_TOOL,
          description: "Tell the family right away that the person needs help.",
          parameters: { type: "object", properties: { reason: { type: "string", description: "A few words on why." } }, required: ["reason"] },
        },
      }],
    },
    voice: { provider: "vapi", voiceId: opts.voiceId || COMPANION_VOICE, speed: 0.9 },
    transcriber,
    endCallPhrases: [c.night ? "sleep well" : "take care"],
    maxDurationSeconds: 240,
    silenceTimeoutSeconds: 45,
    backgroundSound: "off",
    clientMessages: ["tool-calls"],
    artifactPlan: { recordingEnabled: false },
  };
}
