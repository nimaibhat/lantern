import type { Room } from "@/lib/types";

// Live events use the home model's room ids (tv-room, front-door); scanned rooms take their ids from the names typed
// on the phone (living, entry). Match one onto the other so the overview can name and highlight the live room.
const ALIASES: Record<string, string[]> = { "tv-room": ["living", "living-room"], "front-door": ["entry", "entryway"] };
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-");

export function resolveRoomId(rooms: Room[], id?: string): string | undefined {
  if (!id || rooms.some((r) => r.id === id)) return id;
  const want = [id, ...(ALIASES[id] ?? [])].map(norm);
  return rooms.find((r) => want.includes(norm(r.id)) || want.includes(norm(r.name)))?.id ?? id;
}

export const roomName = (rooms: Room[], id?: string) => {
  const room = rooms.find((r) => r.id === resolveRoomId(rooms, id));
  return room?.name ?? (id ? id.charAt(0).toUpperCase() + id.slice(1).replace(/-/g, " ") : "Unknown");
};
