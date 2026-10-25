// "Kitchen", "kitchen" and "Living Room" vs "living-room": one way to tell whether a name means a scanned room, shared
// by the monitor (a listener named after a room stands in it) and the Tracking sync (a laptop named after a room).

export const slug = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// An exact name first. Otherwise a room named whole inside it ("Kitchen laptop", "esp32-kitchen"), the longest when
// one contains the others ("Back hallway device" is the back hallway, not the hallway). Two rooms that both fit
// ("Bedroom" in a home with five) is a guess, so nothing.
export function roomNamed<T extends { id: string; name: string }>(rooms: T[], name: string): T | undefined {
  const want = slug(name);
  if (!want) return;
  const exact = rooms.find((r) => slug(r.id) === want || slug(r.name) === want);
  if (exact) return exact;
  const padded = `-${want}-`;
  const fits = rooms
    .map((r) => ({ r, s: [slug(r.name), slug(r.id)].filter((s) => s && padded.includes(`-${s}-`)).sort((a, b) => b.length - a.length)[0] }))
    .filter((m): m is { r: T; s: string } => !!m.s)
    .sort((a, b) => b.s.length - a.s.length);
  if (!fits.length) return;
  const [best, ...rest] = fits;
  return rest.every((m) => m.r === best.r || best.s.includes(m.s)) ? best.r : undefined;
}
