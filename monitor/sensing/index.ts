// Sensing module (owner: Saran). Listener ingest, RSSI window, sim routes, nearest-room.

import type { MonitorModule } from "../module";
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
