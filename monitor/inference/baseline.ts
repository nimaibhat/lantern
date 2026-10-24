// Strongest receiver wins. Used when no kNN is trained yet, or when train.py found kNN no better.
// Listener --offset is applied at the listener, so readings arrive already aligned.

import { MISSING, flat } from "./knn";

export function baselinePosterior(
  order: string[],
  rssi: number[],
  rooms: string[],
  receiverRoom: Record<string, string>, // receiver id -> room it sits in
): Record<string, number> {
  let top = -1;
  rssi.forEach((v, i) => { if (v > MISSING && (top < 0 || v > rssi[top])) top = i; });
  const room = top >= 0 ? receiverRoom[order[top]] : undefined;
  if (!room || !rooms.includes(room)) return flat(rooms);
  // Not one-hot, so the HMM can still weigh it against the door graph
  const rest = 0.15 / Math.max(rooms.length - 1, 1);
  return Object.fromEntries(rooms.map((r) => [r, r === room ? 0.85 : rest]));
}
