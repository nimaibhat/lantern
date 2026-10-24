// Sensing module (owner: Saran). Listener ingest, RSSI window, sim routes, nearest-room.

import type { MonitorModule } from "../module";
import { HttpError } from "../module";
import { registerCalibration } from "./calibrate";
import { createIngest } from "./ingest";
import { registerNearest } from "./nearest";
import { registerReplay } from "./replay";
import { registerSim } from "./sim";

const sensing: MonitorModule = {
  name: "sensing",
  register(ctx) {
    registerSim(ctx);

    const home = ctx.world();
    const receiverOrder = home.anchors.map((a) => a.receiverId).sort();
    const ingest = createIngest(ctx.bus, ctx.store, ctx.log, ctx.cfg, receiverOrder);

    ctx.http.get("/debug/vector", () => {
      const f = ingest.window.frame(Date.now(), { ...ctx.store.listeners });
      return f;
    });

    // HTTP endpoint for browser-based Web Bluetooth listeners (avoids WS mixed-content issues).
    // The Next.js API route /api/listener/report proxies here.
    ctx.http.post("/listener/report", ({ body, query }) => {
      const token = query.get("token") ?? "";
      if (token !== ctx.cfg.listenerToken) throw new HttpError(401, "bad token");
      if (!body || typeof body !== "object") throw new HttpError(400, "body required");
      const ok = ingest.handleHttp(body);
      if (!ok) throw new HttpError(400, "invalid message or receiver id");
      return { ok: true };
    });

    // Expose ingest for the server to wire up /ws/listener
    (ctx as unknown as Record<string, unknown>)._ingest = ingest;

    // Labeled RSSI for training, and replays of recorded sessions
    registerCalibration(ctx);
    registerReplay(ctx);

    // Strongest-listener fallback room estimate (off unless NEAREST_ROOM=1; the classifier decides the room)
    registerNearest(ctx);
  },
};

export default sensing;
