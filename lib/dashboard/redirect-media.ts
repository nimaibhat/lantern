// The familiar voice lines and photo the TV uses during a redirect. One fixed file per slot in Storage, so the
// monitor can point at it without a lookup; when a file is missing the TV reads the message aloud instead.
// VOICE_SLOT in monitor/actions/index.ts maps each risk to one of these slots.

export type VoiceSlot = "bedtime" | "kitchen" | "front-door" | "greeting";

export const VOICE_SLOTS: { slot: VoiceSlot; label: string; when: string; line: (name: string) => string }[] = [
  { slot: "bedtime", label: "Back to bed", when: "Up and about during quiet hours", line: (n) => `It's still night, ${n}. Let's go back to bed.` },
  { slot: "kitchen", label: "Kitchen at night", when: "In the kitchen during quiet hours", line: (n) => `It's still night, ${n}. Let's go back to bed.` },
  { slot: "front-door", label: "Front door", when: "Heading for the front door", line: (n) => `You're home, ${n}. Let's go back to your room.` },
  { slot: "greeting", label: "Daytime greeting", when: "Arriving in the TV room by day", line: (n) => `Good morning, ${n}. It's good to see you.` },
];

// Voice files keep a .m4a name whatever the browser recorded (webm or mp4); Storage serves the real content type.
export const voicePath = (householdId: string, slot: VoiceSlot) =>
  slot === "greeting" ? `${householdId}/greeting.m4a` : `${householdId}/redirect-${slot}.m4a`;

export const REDIRECT_PHOTO = "redirect-photo.jpg";
export const redirectPhotoPath = (householdId: string) => `${householdId}/${REDIRECT_PHOTO}`;

export const MAX_VOICE_BYTES = 3 * 1024 * 1024;
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
export const isVoiceSlot = (s: unknown): s is VoiceSlot => VOICE_SLOTS.some((v) => v.slot === s);

// Lines the caregiver typed, one per slot. A slot with no typed line uses the default above.
// Kept as a small JSON file next to the recordings so it needs no table.
export type VoiceLines = Partial<Record<VoiceSlot, string>>;
export const MAX_LINE_CHARS = 200;
export const linesPath = (householdId: string) => `${householdId}/lines.json`;

// Anything read from Storage or a request: keep known slots with short, non-empty text.
export function parseLines(raw: unknown): VoiceLines {
  if (!raw || typeof raw !== "object") return {};
  const lines: VoiceLines = {};
  for (const [slot, text] of Object.entries(raw)) {
    if (isVoiceSlot(slot) && typeof text === "string" && text.trim()) lines[slot] = text.trim().slice(0, MAX_LINE_CHARS);
  }
  return lines;
}
