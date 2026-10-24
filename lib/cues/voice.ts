// The browser's text to speech, tuned to be calm: a slower, slightly lower voice, quieter at night.
// Used when there is no family recording and no companion voice. Pure picks so tests can pin them.

export interface VoiceLike {
  name: string;
  lang: string;
  localService?: boolean;
}

// Natural-sounding English voices first, then any English voice. Names vary by browser and OS.
const PREFERRED = [/natural/i, /samantha/i, /serena/i, /karen/i, /moira/i, /google us english/i, /aria/i, /jenny/i];

export function pickCalmVoice<V extends VoiceLike>(voices: V[]): V | undefined {
  const english = voices.filter((v) => /^en(-|_|$)/i.test(v.lang));
  for (const re of PREFERRED) {
    const hit = english.find((v) => re.test(v.name));
    if (hit) return hit;
  }
  return english[0];
}

export const calmSpeech = (night: boolean) => ({ rate: 0.85, pitch: 0.95, volume: night ? 0.7 : 1 });
