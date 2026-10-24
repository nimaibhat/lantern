// Nearest-listener room estimate: pick the online receiver with the strongest RSSI,
// emit position at its room centroid + location on room change, source "ble".
// Fallback room estimate (strongest listener wins). Off by default because monitor/inference (Vineet's classifier)
// emits location and position from the same frames; two sources would double-report every room change.
// Turn it on with NEAREST_ROOM=1 only when the classifier is not loaded.

import { randomUUID } from "node:crypto";
import type { ModuleCtx } from "../module";

// Listener slug -> room id the dashboard floor plan uses.
// living-room is the second laptop in this test; the home model calls that space tv-room.
const DASHBOARD_ROOM: Record<string, string> = {
  bedroom: "bedroom",
  "living-room": "living",
  living: "living",
  "tv-room": "living",
};
const GEOMETRY_ROOM: Record<string, string> = {
  "living-room": "tv-room",
  living: "tv-room",
};
const SWITCH_MARGIN_DB = 5;

export function registerNearest(ctx: ModuleCtx) {
  const enabled = process.env.NEAREST_ROOM === "1";
  if (!enabled) {
    ctx.log("sensing", "nearest-room estimator off (the classifier decides the room; NEAREST_ROOM=1 turns it on)");
    return;
  }

  ctx.log("sensing", "nearest-room estimator enabled");

  ctx.bus.on("frame", (f) => {
    const home = ctx.world();

    // Find the online receiver with the strongest RSSI (closest to 0)
    let bestIdx = -1;
    let bestRssi = -100;
    for (let i = 0; i < f.order.length; i++) {
      const id = f.order[i];
      if (!f.online[id]) continue;
      if (f.rssi[i] > bestRssi) {
        bestRssi = f.rssi[i];
        bestIdx = i;
      }
    }

    // No useful signal
    if (bestIdx === -1 || bestRssi <= -100) return;

    let receiverId = f.order[bestIdx];
    const anchor = home.anchors.find((a) => a.receiverId === receiverId);
    if (!anchor) return;

    // Stay in the current room until another listener is clearly louder.
    const held = ctx.store.room;
    if (held) {
      const heldIdx = f.order.findIndex((id) => (DASHBOARD_ROOM[id] ?? id) === held);
      if (heldIdx >= 0 && f.online[f.order[heldIdx]] && f.rssi[heldIdx] > -100) {
        if (bestRssi < f.rssi[heldIdx] + SWITCH_MARGIN_DB) receiverId = f.order[heldIdx];
      }
    }

    const geometryId = GEOMETRY_ROOM[receiverId] ?? receiverId;
    const room = home.rooms.find((r) => r.id === geometryId) ?? home.rooms.find((r) => r.id === receiverId);
    if (!room) return;
    const roomId = DASHBOARD_ROOM[receiverId] ?? room.id;

    const ts = Date.now();
    // The sim lock guard in sim.ts will drop these if a sim event happened recently
    const chosenRssi = f.rssi[f.order.indexOf(receiverId)] ?? bestRssi;
    ctx.bus.emit("position", {
      ts,
      x: room.centroid.x,
      y: room.centroid.y,
      roomId,
      confidence: Math.min(1, (chosenRssi + 100) / 60),
      source: "ble",
    });

    const prev = ctx.store.room;
    if (prev !== roomId) {
      ctx.bus.emit("location", {
        id: randomUUID(),
        householdId: ctx.cfg.householdId,
        roomId,
        prevRoomId: prev,
        confidence: Math.min(1, (bestRssi + 100) / 60),
        source: "ble",
        ts: new Date(ts).toISOString(),
      });
    }
  });
}
