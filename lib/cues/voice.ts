// The browser's text to speech, tuned to be calm: a slower, slightly lower voice, quieter at night.
// Used when there is no family recording and no companion voice. Pure picks so tests can pin them.

export interface VoiceLike {
  name: string;
  lang: string;
  localService?: boolean;
}

// Calm female English voices, natural-sounding ones first, to match the companion's voice. Names vary by browser
// and OS. A bare "Natural" match is not enough: Edge and Windows also have male natural voices (Guy, Andrew).
const PREFERRED = [/aria/i, /jenny/i, /samantha/i, /serena/i, /karen/i, /moira/i, /google us english/i, /google uk english female/i, /zira/i, /hazel/i, /susan/i];
// Windows' default is often a male voice (David), so never fall back to one while another voice exists.
const MALE = /\b(male|david|mark|guy|andrew|brian|christopher|eric|roger|steffan|george|james|daniel|fred|alex|tom|ryan)\b/i;

export function pickCalmVoice<V extends VoiceLike>(voices: V[]): V | undefined {
  const english = voices.filter((v) => /^en(-|_|$)/i.test(v.lang));
  for (const re of PREFERRED) {
    const hit = english.find((v) => re.test(v.name) && !MALE.test(v.name));
    if (hit) return hit;
  }
  return english.find((v) => !MALE.test(v.name)) ?? english[0];
}

export const calmSpeech = (night: boolean) => ({ rate: 0.85, pitch: 0.95, volume: night ? 0.7 : 1 });
