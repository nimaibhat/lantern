// Apple's StructureBuilder merges the rooms scanned in one session into a CapturedStructure:
// { rooms: [CapturedRoom], walls, doors, ... } with every room placed in one aligned frame.
// We use its rooms (same shape as a CapturedRoom file) in place of the per-room uploads.

type Json = Record<string, any>;

export const structurePath = (householdId: string, scanId: string) => `${householdId}/${scanId}/structure.json`;

// Put the structure's rooms in upload order by matching each room's identifier with the per-room files.
// If any room cannot be matched, fall back to the order StructureBuilder returned when the counts agree;
// otherwise return undefined and the caller uses the per-room files.
export function roomsFromStructure(structure: Json, perRoom: Json[]): Json[] | undefined {
  const rooms: Json[] = Array.isArray(structure?.rooms) ? structure.rooms : [];
  if (rooms.length === 0) return;
  const byId = new Map(rooms.map((r) => [String(r.identifier ?? ""), r]));
  const matched = perRoom.map((r) => byId.get(String(r.identifier ?? "")));
  if (matched.every(Boolean)) return matched as Json[];
  return rooms.length === perRoom.length ? rooms : undefined;
}
