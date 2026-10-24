"use client";

// Sound for the patient screen: a soft two-note chime, then the words (docs/cues.md). The chime is made with
// Web Audio, so there is no file to load; it is quiet and low, and quieter at night, so it never startles.

import { calmSpeech, pickCalmVoice } from "@/lib/cues/voice";

let ctx: AudioContext | undefined;

// Call from a tap: browsers only allow sound after the person has touched the page.
export function unlockAudio() {
  try {
    ctx ??= new AudioContext();
    void ctx.resume();
  } catch {
    // No Web Audio: the words still play.
  }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function chime(night: boolean): Promise<void> {
  if (!ctx) return;
  const peak = night ? 0.08 : 0.14;
  const start = ctx.currentTime + 0.05;
  // E5 then C5: a descending pair reads as gentle, a rising one as an alarm.
  [659.25, 523.25].forEach((freq, i) => {
    const t = start + i * 0.45;
    const osc = ctx!.createOscillator();
    const gain = ctx!.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(peak, t + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
    osc.connect(gain).connect(ctx!.destination);
    osc.start(t);
    osc.stop(t + 1.2);
  });
  await wait(1600); // both notes, then a breath before the words
}

// Resolves when done (or at once without speech support), so the caller can keep the order chime, words, pause.
export function speak(text: string, night: boolean): Promise<void> {
  if (!text || typeof window === "undefined" || !("speechSynthesis" in window)) return Promise.resolve();
  return new Promise((resolve) => {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const voice = pickCalmVoice(speechSynthesis.getVoices());
    if (voice) u.voice = voice;
    Object.assign(u, calmSpeech(night));
    u.onend = u.onerror = () => resolve();
    speechSynthesis.speak(u);
  });
}

export function hush() {
  if (typeof window !== "undefined" && "speechSynthesis" in window) speechSynthesis.cancel();
}
