// Which placed device hears the phone most clearly. The room is that device's room.
// A few dB of margin keeps the call from flickering when the phone is between rooms.

export type Reading = { id: string; rssi: number; online: boolean };
export type Placement = { id: string; roomId: string };

const USEFUL = -100;

export function closestRoom(
  readings: Reading[],
  placements: Placement[],
  heldRoomId: string | null,
  marginDb = 5,
): { roomId: string; receiverId: string; rssi: number } | null {
  const roomOf = new Map(placements.filter((p) => p.roomId).map((p) => [p.id, p.roomId]));
  const heard = readings.filter((r) => r.online && r.rssi > USEFUL && roomOf.has(r.id));
  if (heard.length === 0) return null;

  const best = heard.reduce((a, b) => (b.rssi > a.rssi ? b : a));
  const bestRoom = roomOf.get(best.id)!;
  if (!heldRoomId || heldRoomId === bestRoom) {
    return { roomId: bestRoom, receiverId: best.id, rssi: best.rssi };
  }
  const held = heard.find((r) => roomOf.get(r.id) === heldRoomId);
  if (held && best.rssi < held.rssi + marginDb) {
    return { roomId: heldRoomId, receiverId: held.id, rssi: held.rssi };
  }
  return { roomId: bestRoom, receiverId: best.id, rssi: best.rssi };
}
