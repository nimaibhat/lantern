// Closest laptop: with ROOM_FROM=closest, the hub's Tracking page posts the listener laptop that hears the phone best
// (with a margin, so it does not flicker) through /api/tracking/closest, and that laptop's room is the person's room
// for the risk rules and alerts. The same call decides which laptop says the bedtime line, so the two always agree.

import { randomUUID } from "node:crypto";
import type { HomeRoom } from "@/lib/types";
import { HttpError, type ModuleCtx } from "../module";

const field = (body: unknown, key: string): unknown => (body && typeof body === "object" ? (body as Record<string, unknown>)[key] : undefined);
const slug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// The room a laptop was placed in, else the room its name matches: "Bedroom 2" -> bedroom-2, "Living room" -> living-room.
export function roomForLaptop(rooms: HomeRoom[], roomId: unknown, label: unknown): HomeRoom | undefined {
  const byId = typeof roomId === "string" ? rooms.find((r) => r.id === roomId) : undefined;
  if (byId || typeof label !== "string" || !label.trim()) return byId;
  return rooms.find((r) => r.id === slug(label)) ?? rooms.find((r) => slug(r.name) === slug(label));
}

export function registerClosest(ctx: ModuleCtx) {
  ctx.http.post("/closest", ({ body, query }) => {
    if ((query.get("token") ?? "") !== ctx.cfg.listenerToken) throw new HttpError(401, "bad token");
    if (process.env.ROOM_FROM !== "closest") return { ignored: true }; // the inference engine decides the room
    const label = field(body, "label");
    const room = roomForLaptop(ctx.world().rooms, field(body, "roomId"), label);
    if (!room) throw new HttpError(400, `no room in the scan matches "${typeof label === "string" ? label : ""}"; name the laptop after a room or place it`);
    const rssi = Number(field(body, "rssi"));
    const confidence = Number.isFinite(rssi) ? Math.max(0, Math.min(1, (rssi + 100) / 60)) : 1;

    const prev = ctx.store.room;
    if (prev !== room.id) {
      ctx.bus.emit("location", { id: randomUUID(), householdId: ctx.cfg.householdId, roomId: room.id, prevRoomId: prev, confidence, source: "ble", ts: new Date().toISOString() });
      ctx.log("closest", `${typeof label === "string" ? label : "laptop"} -> ${room.id}`);
    }
    return { roomId: room.id };
  });
}
