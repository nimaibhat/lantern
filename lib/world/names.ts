// "Kitchen", "kitchen" and "Living Room" vs "living-room": one way to tell whether a name means a scanned room, shared
// by the monitor (a listener named after a room stands in it) and the Tracking sync (a laptop named after a room).

export const slug = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function roomNamed<T extends { id: string; name: string }>(rooms: T[], name: string): T | undefined {
  const want = slug(name);
  return want ? rooms.find((r) => slug(r.id) === want || slug(r.name) === want) : undefined;
}
