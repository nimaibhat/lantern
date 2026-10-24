// Listener ingest: validate incoming WS messages, maintain online state, feed the RSSI window.

import { z } from "zod";
import type { WebSocket } from "ws";
import type { Bus } from "../bus";
import type { Store } from "../store";
import type { Logger } from "../log";
import type { Config } from "../config";
import { RssiWindow } from "./window";

const ListenerMsgSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("hello"), receiverId: z.string(), kind: z.enum(["mac-bleak", "iphone", "replay"]) }),
  z.object({ type: z.literal("rssi"), receiverId: z.string(), tagId: z.string(), rssi: z.number(), ts: z.number() }),
  z.object({ type: z.literal("hb"), receiverId: z.string(), ts: z.number() }),
]);

const STALE_MS = 5_000;
const OFFLINE_MS = 15_000;
const TAG_OFFLINE_MS = 60_000; // taken off, battery flat, or LanternTag left the foreground

export function createIngest(bus: Bus, store: Store, log: Logger, cfg: Config, receiverOrder: string[]) {
  const window = new RssiWindow(receiverOrder);
  const lastSeen = new Map<string, number>();
  const knownReceivers = new Set(receiverOrder);
  const warnedUnknown = new Set<string>();
  const slug = /^[a-z0-9][a-z0-9-]{0,40}$/i;

  // A laptop that joins after startup is still a device. The hub compares whoever is connected.
  function admit(id: string) {
    if (!slug.test(id)) return false;
    if (!knownReceivers.has(id)) {
      knownReceivers.add(id);
      receiverOrder.push(id);
      log("sensing", `receiver joined: ${id}`);
    }
    return true;
  }

  const frameInterval = setInterval(() => {
    const now = Date.now();
    for (const id of receiverOrder) {
      const ls = lastSeen.get(id);
      const wasOnline = store.listeners[id] ?? false;
      const isOnline = ls != null && now - ls < OFFLINE_MS;
      store.listeners[id] = isOnline;
      if (wasOnline && !isOnline) {
        log("sensing", `listener ${id} offline`);
      }
    }
    const tagOnline = store.tagLastSeen != null && now - store.tagLastSeen < TAG_OFFLINE_MS;
    if (store.tagOnline && !tagOnline) log("sensing", "tag offline: no listener has heard it for 60 s");
    else if (!store.tagOnline && tagOnline) log("sensing", "tag heard");
    store.tagOnline = tagOnline;
    const f = window.frame(now, { ...store.listeners });
    bus.emit("frame", f);
  }, 1000);

  function handleMessage(ws: WebSocket, raw: string) {
    const url = new URL(ws.url ?? "ws://x", "ws://x");
    const token = url.searchParams.get("token") ?? (ws as unknown as { _token?: string })._token ?? "";

    let msg;
    try {
      msg = ListenerMsgSchema.parse(JSON.parse(raw));
    } catch {
      return;
    }

    if (!admit(msg.receiverId)) {
      if (!warnedUnknown.has(msg.receiverId)) {
        log("sensing", `ignored receiver id: ${msg.receiverId}`);
        warnedUnknown.add(msg.receiverId);
      }
      return;
    }

    const now = Date.now();

    if (msg.type === "hello") {
      log("sensing", `listener connected: ${msg.receiverId} (${msg.kind})`);
      lastSeen.set(msg.receiverId, now);
      store.listeners[msg.receiverId] = true;
    } else if (msg.type === "hb") {
      lastSeen.set(msg.receiverId, now);
      store.listeners[msg.receiverId] = true;
    } else if (msg.type === "rssi") {
      if (now - msg.ts > STALE_MS) return;
      lastSeen.set(msg.receiverId, now);
      store.listeners[msg.receiverId] = true;
      store.tagLastSeen = now;
      window.push({ receiverId: msg.receiverId, rssi: msg.rssi, ts: msg.ts });
    }
  }

  function handleRaw(ws: WebSocket, raw: string, token: string) {
    if (token !== cfg.listenerToken) {
      ws.close(1008, "bad token");
      return;
    }
    handleMessage(ws, raw);
  }

  function stop() {
    clearInterval(frameInterval);
  }

  return { handleRaw, window, stop };
}
