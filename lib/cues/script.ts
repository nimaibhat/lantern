// What Lantern says to the person (docs/cues.md). Pure, so the monitor and the screens share one wording and the
// tests pin it. Invite, never command; name first; name the room only when the classifier is sure of it.

import type { HomeModel, HomeRoom, RiskKind, RoomKind } from "@/lib/types";
import { roomPath } from "@/lib/world/geometry";

export interface CueScript {
  message: string; // shown big and said first
  detail?: string; // shown smaller and said after: where they are and the way back
  route: string[]; // room names from here to where we invite them; empty when we do not name rooms
}

export interface CueInput {
  kind: RiskKind;
  name: string;
  home: HomeModel;
  roomId?: string; // where they are now
  confident: boolean; // false: say the message only, without rooms or directions
  night: boolean;
}

// The name always comes first: it is the most personal word and it gets their attention before the rest.
const MESSAGE: Record<RiskKind, (name: string) => string> = {
  "kitchen-night": (n) => `${n}, it's still nighttime. Let's go back to bed.`,
  "night-wandering": (n) => `${n}, it's still nighttime. Let's go back to bed.`,
  "exit-approach": (n) => `${n}, you're home. Let's go back to your room.`,
  "long-bathroom-stay": (n) => `${n}, are you all right?`,
  "no-movement": (n) => `${n}, how about a glass of water?`,
};

// Where each risk invites them to go. The front door leads to the bedroom at night and the TV room by day.
function targetKinds(kind: RiskKind, night: boolean): RoomKind[] {
  switch (kind) {
    case "kitchen-night":
    case "night-wandering":
      return ["bedroom"];
    case "exit-approach":
      return night ? ["bedroom"] : ["tv-room", "living", "bedroom"];
    case "no-movement":
      return ["kitchen"];
    default:
      return [];
  }
}

// "Kitchen" -> "kitchen", "TV room" -> "TV room": keep words that are all capitals.
export const inSentence = (name: string) => name.split(" ").map((w) => (w.length > 1 && w === w.toUpperCase() ? w : w.toLowerCase())).join(" ");

const here = (room: HomeRoom) => (room.kind === "front-door" ? `You're at the ${inSentence(room.name)}.` : `You're in the ${inSentence(room.name)}.`);
const label = (room: HomeRoom) => (room.kind === "bedroom" ? "Your bed" : `The ${inSentence(room.name)}`);

export function cueScript(input: CueInput): CueScript {
  const message = MESSAGE[input.kind](input.name);
  if (input.kind === "long-bathroom-stay") return { message, detail: "Take your time.", route: [] };

  const rooms = input.home.rooms;
  const from = rooms.find((r) => r.id === input.roomId);
  if (!input.confident || !from) return { message, route: [] };

  const kinds = targetKinds(input.kind, input.night);
  const target = kinds.map((k) => rooms.find((r) => r.kind === k)).find(Boolean);
  const path = target ? roomPath(input.home, from.id, target.id) : [];
  if (!target || path.length < 2) return { message, detail: here(from), route: [] };

  const through = path.slice(1, -1).map((id) => `the ${inSentence(rooms.find((r) => r.id === id)?.name ?? id)}`);
  const back = target.kind === "bedroom" ? "back " : "";
  const way = through.length ? `${label(target)} is ${back}through ${through.join(" and ")}.` : `${label(target)} is just next door.`;
  return { message, detail: `${here(from)} ${way}`, route: path.map((id) => rooms.find((r) => r.id === id)?.name ?? id) };
}

// Said once they are back where they should be.
export const closingLine = (name: string, night: boolean) => (night ? `${name}, good night. Sleep well.` : `${name}, thank you.`);

// The TV-room welcome by time of day (hour 0 to 23, household time).
export const greetingLine = (name: string, hour: number) => `${name}, ${hour < 12 ? "good morning" : hour < 17 ? "good afternoon" : "good evening"}.`;

// A routine step said aloud, name first: "Rosa, breakfast is in the kitchen." A title that calls them by name later
// ("Good morning, Rosa. Time to get up.") moves the name to the front instead of saying it twice.
export function routinePrompt(name: string, title: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!title.trim() || new RegExp(`^${escaped}\\b`, "i").test(title.trim())) return title.trim();
  const t = title.replace(new RegExp(`,\\s*${escaped}(?=[.!?,])`, "i"), "").trim();
  const first = t.split(" ")[0];
  const keep = /^I\b/.test(t) || (first.length > 1 && first === first.toUpperCase());
  return `${name}, ${keep ? t : t.charAt(0).toLowerCase() + t.slice(1)}`;
}

export const NOTE_MAX = 200;

// A message a caregiver typed for the TV: one line, no control characters, short enough to read at a glance.
export function cleanNote(text: unknown): string | undefined {
  if (typeof text !== "string") return;
  const t = text.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, NOTE_MAX);
  return t || undefined;
}
