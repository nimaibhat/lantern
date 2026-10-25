// Inference module (owner: Vineet). SensorFrame in; position (about 5 Hz), location (room changes) and
// prediction out (Part 5). Models come from ml/out (python ml/train.py, python ml/train_markov.py);
// POST /model/reload picks up new ones.

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { localMinutes } from "../actions/risk";
import type { MonitorModule } from "../module";
import { InferenceEngine, type InferenceEvent, type Models } from "./engine";

const TICK_MS = 100; // the fast dot steps ten times a second (inference/fast.ts)

export function loadModels(dir = process.env.ML_OUT_DIR ?? "ml/out", log?: (msg: string) => void): Models {
  const read = (file: string) => {
    const p = join(dir, file);
    try {
      return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : undefined;
    } catch (e) {
      log?.(`could not read ${p}: ${(e as Error).message}`);
    }
  };
  return { knn: read("knn.json"), markov: read("markov.json") };
}

// The predictor reads the same household clock as the risk rules: the household's timezone, not the laptop's, and
// DEMO_HOUR (0 to 23) pins the hour so an afternoon demo plays the 3 AM story. A bad DEMO_HOUR is ignored there
// instead of turning every prediction into NaN.
const TIME_ZONE = "America/New_York"; // the seeded household's timezone (monitor/actions HOUSEHOLD)
export const hourOf = (ts: number) => localMinutes(ts, TIME_ZONE) / 60;

const inference: MonitorModule = {
  name: "inference",
  register(ctx) {
    let home = ctx.world();
    const models = () => loadModels(undefined, (msg) => ctx.log("inference", msg));
    const engine = new InferenceEngine(home, models(), { hourOf, newId: randomUUID });
    ctx.log("inference", JSON.stringify(engine.describe()));

    ctx.bus.on("reading", (r) => engine.onReading(r));

    const send = (e: InferenceEvent) => {
      if (e.k === "location") {
        ctx.log("loc", `${e.d.prevRoomId ?? "-"} > ${e.d.roomId} (${e.d.confidence})`);
        ctx.bus.emit("location", e.d);
      } else {
        ctx.log("predict", `${e.d.fromRoomId} > ${e.d.nextRoomId} ${e.d.probability}`);
        ctx.bus.emit("prediction", e.d);
      }
    };

    ctx.bus.on("frame", (f) => {
      if (ctx.world().version !== home.version) { // the home model was reloaded: rebuild the door graph
        home = ctx.world();
        engine.setHome(home);
      }
      engine.onFrame(f).forEach(send);
    });

    // unref: the HTTP server keeps the monitor alive; this timer alone must not (tests, shutdown)
    setInterval(() => {
      const p = engine.tick(Date.now());
      if (p) ctx.bus.emit("position", p);
      engine.drain().forEach(send); // room changes the live dot settled on
    }, TICK_MS).unref();

    ctx.http.post("/model/reload", () => {
      engine.setModels(models());
      return engine.describe();
    });
    ctx.http.get("/debug/inference", () => ({ ...engine.debug(), serverTs: Date.now() })); // the models page polls this
  },
};

export default inference;
