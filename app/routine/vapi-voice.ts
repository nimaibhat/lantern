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

// One voice at a time on this laptop, across tabs too (the Tracking page and a TV tab both speak): each line waits
// for the one before it to finish.
let local: Promise<unknown> = Promise.resolve();
export function inTurn<T>(fn: () => Promise<T>): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks) return navigator.locks.request("lantern-voice", fn) as Promise<T>;
  const turn = local.then(fn);
  local = turn.catch(() => {});
  return turn;
}

// One line, in turn: Layla, or the browser's own voice if she cannot connect. Never both at once.
export function sayLine(text: string, signal: AbortSignal): Promise<void> {
  return inTurn(async () => {
    if (signal.aborted || (await sayCalmly(text, signal))) return;
    await current; // a call that failed half way is fully hung up first
    if (signal.aborted || !("speechSynthesis" in window)) return;
    speechSynthesis.cancel();
    await new Promise<void>((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 0.85;
      u.onend = u.onerror = () => resolve();
      signal.addEventListener("abort", () => (speechSynthesis.cancel(), resolve()), { once: true });
      speechSynthesis.speak(u);
    });
  });
}

// Says `text` in the calm voice and resolves once the line is over, so a repeat never talks over it. Resolves false
// when Vapi is not set up or the call could not start, so the caller can fall back to the browser's voice.
// Aborting the signal hangs up.
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
  let finished = () => {};
  const done = new Promise<void>((resolve) => (finished = resolve));
  let hungUp = false;
  const hangUp = () => {
    if (hungUp) return;
    hungUp = true;
    clearTimeout(quiet);
    vapi.removeListener("speech-start", onStart);
    vapi.removeListener("speech-end", onEnd);
    vapi.removeListener("call-end", hangUp);
    current = vapi.stop().catch(() => {});
    void current.then(finished);
  };
  const onStart = () => clearTimeout(quiet);
  const onEnd = () => {
    clearTimeout(quiet);
    quiet = setTimeout(hangUp, HANG_UP_MS);
  };
  vapi.on("speech-start", onStart);
  vapi.on("speech-end", onEnd);
  vapi.on("call-end", hangUp); // the MAX_CALL_S cap, or Vapi ending it
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
    if (call) {
      await done;
      return true;
    }
  } catch (e) {
    console.warn("[vapi] call failed:", e);
  }
  hangUp();
  return false;
}
