// What Lantern tells the family (docs/cues.md): what happened, what Lantern already did, one next step.
// Plain words, no alarm language, and the person's name instead of pronouns.

import type { RiskKind } from "@/lib/types";

export interface FamilyFacts {
  name: string; // the person at home
  kind: RiskKind;
  room: string; // where they are now, as a name: "Kitchen"
  since: string; // "3:04 AM", household time
  reminders: number; // cues played so far
}

const lower = (room: string) => room.split(" ").map((w) => (w.length > 1 && w === w.toUpperCase() ? w : w.toLowerCase())).join(" ");
const times = (n: number) => (n === 1 ? "1 gentle reminder" : `${n} gentle reminders`);

// One sentence on what is happening, used by the text, the call and the voice agent.
export function situation(f: FamilyFacts): string {
  const room = lower(f.room);
  switch (f.kind) {
    case "kitchen-night":
    case "night-wandering":
      return f.reminders > 0
        ? `${f.name} has been up since ${f.since} and is in the ${room}. Lantern played ${times(f.reminders)} and ${f.name} has not gone back to bed yet.`
        : `${f.name} has been up since ${f.since} and is in the ${room}.`;
    case "exit-approach":
      return `${f.name} is at the front door (${f.since}). A gentle reminder is playing.`;
    case "long-bathroom-stay":
      return `${f.name} has been in the bathroom since ${f.since}.`;
    case "no-movement":
      return `${f.name} has not moved from the ${room} since ${f.since}.`;
  }
}

const ask = (f: FamilyFacts) => (f.kind === "exit-approach" ? `Please check on ${f.name} now.` : `Could you check on ${f.name}?`);

export const alertText = (f: FamilyFacts, ackUrl: string) => `Lantern: ${situation(f)} ${ask(f)} Tap when you are on it: ${ackUrl}`;

export const backupText = (f: FamilyFacts, ackUrl: string) =>
  `Lantern: ${situation(f)} The first contact has not been able to check. ${ask(f)} Tap when you are on it: ${ackUrl}`;

// Read aloud by a plain phone call when the voice agent is not set up.
export const callScript = (f: FamilyFacts) => `This is Lantern. ${situation(f)} ${ask(f)}`;

// Sent to everyone already texted once the person is back somewhere safe on their own.
export const allClearText = (name: string, room: string, at: string) => `Lantern update: ${name} is back in the ${lower(room)} (${at}). No need to check.`;

// Sent to the other contacts when one of them says they are on it.
export const handoffText = (name: string, who: string) => `Lantern update: ${who} is checking on ${name} now. No need to go.`;
