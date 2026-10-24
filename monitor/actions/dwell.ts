// Time away (docs/cues.md): the room they are in and for how long, how long they have been out of bed during quiet
// hours, and minutes per room today (household time). Pure with an injected clock; GET /dwell serves it.

import type { RoomKind } from "@/lib/types";

export interface Dwell {
  roomId?: string;
  inRoomS: number;
  outOfBedS?: number; // only during quiet hours
  todayS: Record<string, number>;
}

export function createDwell(deps: { timeZone: string; quiet: (ts: number) => boolean; roomKind: (roomId: string) => RoomKind | undefined; now?: () => number }) {
  const now = deps.now ?? Date.now;
  const dayOf = (ts: number) => new Intl.DateTimeFormat("en-CA", { timeZone: deps.timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(ts);
  const today = new Map<string, number>(); // ms per room, settled up to countedFrom
  let room: string | undefined;
  let enteredAt = 0;
  let countedFrom = 0;
  let upSince: number | undefined;
  let day = "";

  // A new household day starts the totals again.
  function roll(t: number) {
    const d = dayOf(t);
    if (d === day) return;
    day = d;
    today.clear();
    countedFrom = t;
  }

  function settle(t: number) {
    if (room) today.set(room, (today.get(room) ?? 0) + Math.max(0, t - countedFrom));
    countedFrom = t;
  }

  return {
    onLocation(roomId: string) {
      const t = now();
      roll(t);
      settle(t);
      if (roomId !== room) enteredAt = t;
      room = roomId;
      upSince = deps.roomKind(roomId) === "bedroom" ? undefined : (upSince ?? t);
    },

    state(): Dwell {
      const t = now();
      roll(t);
      settle(t);
      const s = (ms: number) => Math.round(ms / 1000);
      return {
        roomId: room,
        inRoomS: room ? s(t - enteredAt) : 0,
        outOfBedS: upSince !== undefined && deps.quiet(t) ? s(t - upSince) : undefined,
        todayS: Object.fromEntries([...today].map(([id, ms]) => [id, s(ms)])),
      };
    },
  };
}
