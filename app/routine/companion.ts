"use client";

// The companion voice (docs/vapi.md): a calm two-way Vapi call on the TV page after the first scripted reminder has
// not worked. Opt-in: NEXT_PUBLIC_VAPI_PUBLIC_KEY plus NEXT_PUBLIC_VAPI_COMPANION=1. The SDK loads only when a call
// starts, so the page stays light without it. Any failure falls back to the scripted voice.

import { HELP_TOOL, companionAssistant, type CompanionFacts } from "@/lib/cues/vapi";

const KEY = process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY;
export const companionEnabled = !!KEY && process.env.NEXT_PUBLIC_VAPI_COMPANION === "1";
// Which reminder the companion takes over from. Default 2: the first reminder is the scripted voice.
// 1 = the companion's voice from the very first reminder.
export const companionFromCue = Math.max(1, Number(process.env.NEXT_PUBLIC_VAPI_COMPANION_FROM_CUE) || 2);

// The slice of the SDK we use. Our assistant is plain JSON (lib/cues/vapi.ts), shared with the monitor.
interface VapiLike {
  start(assistant: unknown): Promise<unknown>;
  stop(): Promise<void>;
  say(message: string, endCallAfterSpoken?: boolean): void;
  send(message: unknown): void;
  on(event: string, listener: (...args: never[]) => void): unknown;
}

export interface Companion {
  say(text: string, end?: boolean): void;
  tell(context: string): void; // quiet context for the agent, not spoken
  stop(): void;
}

interface ToolCall {
  function?: { name?: string; arguments?: unknown };
}

function reasonOf(args: unknown): string {
  try {
    const a = typeof args === "string" ? JSON.parse(args) : args;
    return typeof a?.reason === "string" ? a.reason : "";
  } catch {
    return "";
  }
}

export async function startCompanion(facts: CompanionFacts, hooks: { onHelp(reason: string): void; onEnd(): void }): Promise<Companion | undefined> {
  if (!companionEnabled) return;
  const { default: Vapi } = await import("@vapi-ai/web");
  const vapi = new Vapi(KEY!) as unknown as VapiLike;
  vapi.on("call-end", hooks.onEnd);
  vapi.on("error", hooks.onEnd);
  vapi.on("message", (m: { type?: string; toolCallList?: ToolCall[] }) => {
    if (m?.type !== "tool-calls") return;
    for (const call of m.toolCallList ?? []) if (call.function?.name === HELP_TOOL) hooks.onHelp(reasonOf(call.function.arguments));
  });
  await vapi.start(companionAssistant(facts, { voiceId: process.env.NEXT_PUBLIC_VAPI_COMPANION_VOICE_ID }));
  return {
    say: (text, end = false) => vapi.say(text, end),
    tell: (context) => vapi.send({ type: "add-message", message: { role: "system", content: context } }),
    stop: () => void vapi.stop().catch(() => {}),
  };
}

// Ask for the microphone at "Tap to start", so a permission prompt never appears at 3 AM.
export async function warmMicrophone() {
  if (!companionEnabled || !navigator.mediaDevices?.getUserMedia) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
  } catch {
    // Denied: the companion will fail to start and the scripted voice plays instead.
  }
}
