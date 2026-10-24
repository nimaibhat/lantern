// Simulator: pretend the person is somewhere, so anyone can test without Bluetooth.
// Emits the same position and location events as the BLE pipeline, with source "sim".

import { randomUUID } from "node:crypto";
import { roomAt } from "@/lib/world/geometry";
import type { HomeRoom, Vec2 } from "@/lib/types";
import { HttpError, type ModuleCtx } from "../module";

// After a sim event, drop BLE position and location for this long so the two sources do not fight.
export const SIM_LOCK_MS = 10_000;

const num = (v: unknown, name: string) => {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new HttpError(400, `${name} must be a number`);
  return v;
};
const field = (body: unknown, key: string): unknown => (body && typeof body === "object" ? (body as Record<string, unknown>)[key] : undefined);

export function registerSim(ctx: ModuleCtx) {
  let lockedUntil = 0;

  ctx.bus.guard((event, payload) => {
    if (event !== "position" && event !== "location") return true;
    return (payload as { source: string }).source !== "ble" || Date.now() >= lockedUntil;
  });

  function moveTo(p: Vec2, room: HomeRoom) {
    lockedUntil = Date.now() + SIM_LOCK_MS;
    const ts = Date.now();
    ctx.bus.emit("position", { ts, x: p.x, y: p.y, roomId: room.id, confidence: 1, source: "sim" });
    const prev = ctx.store.room;
    if (prev !== room.id) {
      ctx.bus.emit("location", {
        id: randomUUID(),
        householdId: ctx.cfg.householdId,
        roomId: room.id,
        prevRoomId: prev,
        confidence: 1,
        source: "sim",
        ts: new Date(ts).toISOString(),
      });
    }
    ctx.log("sim", room.id, Math.round(p.x), Math.round(p.y));
    return { roomId: room.id, x: p.x, y: p.y };
  }

  ctx.http.post("/sim/position", ({ body }) => {
    const p = { x: num(field(body, "x"), "x"), y: num(field(body, "y"), "y") };
    const room = roomAt(ctx.world(), p);
    if (!room) throw new HttpError(400, "that point is outside every room");
    return moveTo(p, room);
  });

  ctx.http.post("/sim/room", ({ body }) => {
    const id = field(body, "roomId");
    const room = ctx.world().rooms.find((r) => r.id === id);
    if (!room) throw new HttpError(400, `unknown roomId; try one of ${ctx.world().rooms.map((r) => r.id).join(", ")}`);
    return moveTo(room.centroid, room);
  });
}
