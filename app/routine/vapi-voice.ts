// The calm voice on the TV: a short Vapi web call to the "Calm Voice" assistant (Layla) that says one line and
// hangs up. The TV's microphone stays off, so it speaks but never listens or replies.
// Only the public key is used here; the private key must never reach the browser.

import type Vapi from "@vapi-ai/web";

const KEY = process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY;
const ASSISTANT = process.env.NEXT_PUBLIC_VAPI_ASSISTANT_ID;
export const vapiConfigured = !!(KEY && ASSISTANT);

const MAX_CALL_S = 30; // a line is a few seconds; this caps the cost if a call never ends
const HANG_UP_MS = 900; // quiet this long after speaking means the line is done, not a pause between sentences
// Slower reads softer and is easier to follow at night. Vapi's own voices take speed but no volume or warmth setting.
const VOICE = { provider: "vapi", voiceId: "Layla", speed: 0.87 } as const;

let client: Promise<Vapi> | undefined;
const load = () =>
  (client ??= import("@vapi-ai/web").then(({ default: V }) => {
    const v = new V(KEY!, undefined, undefined, { startAudioOff: true });
    v.on("error", (e) => console.warn("[vapi]", e)); // EventEmitter throws on an unheard "error"
    return v;
  }));

// Load the SDK early (on "Tap to start") so the first redirect does not wait for the download.
export function preloadVapi() {
  if (vapiConfigured) load().catch(() => (client = undefined));
}

let current: Promise<unknown> = Promise.resolve();

// Says `text` in the calm voice. Resolves false when Vapi is not set up or the call could not start, so the caller
// can fall back to the browser's voice. Aborting the signal hangs up.
export async function sayCalmly(text: string, signal: AbortSignal): Promise<boolean> {
  if (!vapiConfigured) return false;
  let vapi: Vapi;
  try {
    vapi = await load();
    await current; // let the previous line hang up first; one call at a time
  } catch {
    client = undefined;
    return false;
  }
  if (signal.aborted) return true;

  let quiet: ReturnType<typeof setTimeout> | undefined;
  const hangUp = () => {
    clearTimeout(quiet);
    vapi.removeListener("speech-start", onStart);
    vapi.removeListener("speech-end", onEnd);
    current = vapi.stop().catch(() => {});
  };
  const onStart = () => clearTimeout(quiet);
  const onEnd = () => {
    clearTimeout(quiet);
    quiet = setTimeout(hangUp, HANG_UP_MS);
  };
  vapi.on("speech-start", onStart);
  vapi.on("speech-end", onEnd);
  signal.addEventListener("abort", hangUp, { once: true });

  try {
    const call = await vapi.start(
      ASSISTANT,
      { voice: VOICE, firstMessage: text, firstMessageMode: "assistant-speaks-first", firstMessageInterruptionsEnabled: false, maxDurationSeconds: MAX_CALL_S, backgroundSound: "off" },
      undefined,
      undefined,
      undefined,
      { microphonePreflightEnabled: false },
    );
    if (call) return true;
  } catch (e) {
    console.warn("[vapi] call failed:", e);
  }
  hangUp();
  return false;
}
