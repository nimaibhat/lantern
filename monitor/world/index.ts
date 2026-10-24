// World module (owner: Nimai). Serves the home model to the rest of the monitor.
// Loads the newest home_models row for the household from Supabase, or the fixture when there is none
// (no keys, no row yet, or HOME_MODEL_SOURCE=fixture).

import { roomPath, routeBetween } from "@/lib/world/geometry";
import { HttpError, type ModuleCtx, type MonitorModule } from "../module";

  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || process.env.HOME_MODEL_SOURCE === "fixture") return;
  const { data, error } = await db
    .from("home_models")
    .select("model")
    .eq("household_id", householdId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.model as HomeModel | undefined;
}

  try {
    const model = await latestFromSupabase(ctx.cfg.householdId);
    if (model) {
      ctx.store.world = model;
    }
  } catch (e) {
    ctx.log("world", "supabase load failed, using the fixture:", (e as Error).message);
  }
  ctx.store.world = JSON.parse(readFileSync(ctx.cfg.homeModelPath, "utf8")) as HomeModel;
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
}

const world: MonitorModule = {
  name: "world",
  async register(ctx) {

    ctx.http.get("/debug/world", () => {
      const h = ctx.world();
      return {
        version: h.version,
        rooms: h.rooms.map((r) => r.id),
        doors: h.doors.map((d) => d.id),
        anchors: h.anchors.map((a) => a.receiverId),
        hazards: h.hazards.length,
      };
    });

    ctx.http.get("/world", () => ctx.world());

    // Walking route through doors: GET /world/route?from=bedroom&to=kitchen
    ctx.http.get("/world/route", ({ query }) => {
      const from = query.get("from") ?? "", to = query.get("to") ?? "";
      const rooms = roomPath(ctx.world(), from, to);
      if (rooms.length === 0) throw new HttpError(400, `no route from "${from}" to "${to}"`);
      return { rooms, points: routeBetween(ctx.world(), from, to) };
    });

    ctx.http.post("/world/reload", async () => {
    });
  },
};

export default world;
