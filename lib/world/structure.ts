// Apple's StructureBuilder merges the rooms scanned in one session into a CapturedStructure:
// { rooms: [CapturedRoom], walls, doors, ... } with every room placed in one aligned frame.
// We use its rooms (same shape as a CapturedRoom file) in place of the per-room uploads.

type Json = Record<string, any>;

export const structurePath = (householdId: string, scanId: string) => `${householdId}/${scanId}/structure.json`;

// Put the structure's rooms in upload order by matching each room's identifier with the per-room files.
// RoomPlan's JSON can leave identifiers out, so only match on ids that are present and unique; otherwise
// use the order StructureBuilder returned (the upload order) when the counts agree, else undefined and the
// caller uses the per-room files.
export function roomsFromStructure(structure: Json, perRoom: Json[]): Json[] | undefined {
  const rooms: Json[] = Array.isArray(structure?.rooms) ? structure.rooms : [];
  if (rooms.length === 0) return;
  const ids = rooms.map((r) => (r.identifier ? String(r.identifier) : ""));
  if (ids.every(Boolean) && new Set(ids).size === ids.length) {
    const byId = new Map(rooms.map((r, i) => [ids[i], r]));
    const matched = perRoom.map((r) => (r.identifier ? byId.get(String(r.identifier)) : undefined));
    if (matched.every(Boolean)) return matched as Json[];
  }
  return rooms.length === perRoom.length ? rooms : undefined;
}
