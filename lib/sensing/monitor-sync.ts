// Saran's Tracking laptops report to /api/tracking and live in Supabase. The monitor draws the dot, the 3D view and
// the alerts, so it needs the same readings and to know which room each laptop is in. These hand both over.
// Server only. Nothing here waits on the monitor or fails the Tracking page when it is not running.

import type { Vec2 } from "@/lib/types";
import { roomNamed } from "@/lib/world/names";

const MONITOR = process.env.MONITOR_URL || `http://localhost:${process.env.MONITOR_PORT || 8787}`;
const TOKEN = process.env.LISTENER_TOKEN || "change-me";
const SYNC_MS = 20_000;

type MonitorWorld = { rooms: { id: string; name: string }[]; anchors: { receiverId: string }[] };

const post = (path: string, body: unknown) =>
  fetch(`${MONITOR}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(2000) });

async function world(): Promise<MonitorWorld | undefined> {
  const res = await fetch(`${MONITOR}/world/rooms`, { signal: AbortSignal.timeout(2000) });
  return res.ok ? ((await res.json()) as MonitorWorld) : undefined;
}

// The monitor's room for a Supabase room id, or failing that a name ("Kitchen", "Kitchen device").
const roomFor = (w: MonitorWorld, roomId?: string | null, name?: string | null) =>
  (roomId && w.rooms.find((x) => x.id === roomId)) || (name ? roomNamed(w.rooms, name) ?? roomNamed(w.rooms, name.replace(/\s+device$/i, "")) : undefined);

// One reading, as it arrives, under the laptop's own id.
export function forwardReading(receiverId: string, rssi: number) {
  post(`/listener/report?token=${encodeURIComponent(TOKEN)}`, { type: "rssi", receiverId, tagId: "lantern-tag", rssi, ts: Date.now() }).catch(() => {});
}

export function forgetReceiver(receiverId: string) {
  post("/world/unassign", { receiverId }).catch(() => {});
}

export type Placement = { ok: true; position: Vec2; roomId?: string } | { ok: false; error: string };

// The caregiver set where a device stands, by room or by its exact spot on the plan: it stands there for the monitor
// too, even if it stood elsewhere.
export async function placeReceiver(receiverId: string, where: { roomId?: string; roomName?: string; position?: Vec2 }): Promise<Placement> {
  try {
    let body: Record<string, unknown> = { receiverId, position: where.position };
    if (!where.position) {
      const w = await world();
      if (!w) return { ok: false, error: "The monitor is not answering." };
      const room = roomFor(w, where.roomId, where.roomName);
      if (!room) return { ok: false, error: "The monitor does not know that room. Reload the home model." };
      body = { receiverId, roomId: room.id };
    }
    const res = await post("/world/assign", body);
    const data = (await res.json().catch(() => ({}))) as { anchor?: { position: Vec2 }; roomId?: string; error?: string };
    if (!res.ok || !data.anchor) return { ok: false, error: data.error ?? "The monitor could not place it." };
    return { ok: true, position: data.anchor.position, roomId: data.roomId };
  } catch {
    return { ok: false, error: "The monitor is not running. Start it with npm run dev:monitor." };
  }
}

// Every laptop placed in a room, or named after one ("Kitchen"), stands in that room for the monitor too. Laptops the
// monitor already has, perhaps pinned to their exact spot, are left alone, and so are rows nothing has reported from
// lately (online false), so an old device does not end up on the plan. At most every 20 s unless forced (a laptop
// just joined).
export async function syncPlacements(receivers: { id: string; label?: string | null; room_id?: string | null; online?: boolean }[], force = false) {
  const g = globalThis as typeof globalThis & { __lanternPlaceSync?: number };
  if (!force && Date.now() - (g.__lanternPlaceSync ?? 0) < SYNC_MS) return;
  g.__lanternPlaceSync = Date.now();
  try {
    const w = await world();
    if (!w) return;
    const placed = new Set(w.anchors.map((a) => a.receiverId));
    for (const r of receivers) {
      if (placed.has(r.id) || r.online === false) continue;
      const room = roomFor(w, r.room_id, r.label);
      if (room) await post("/world/assign", { receiverId: r.id, roomId: room.id }).catch(() => {});
    }
  } catch {
    // The monitor is not running; the next call tries again.
  }
}
