// World module (owner: Nimai). Serves the home model to the rest of the monitor.
// Loads the newest home_models row for the household from Supabase, or the fixture when there is none
// (no keys, no row yet, or HOME_MODEL_SOURCE=fixture).
// Listener placement (Saran) updates that same model so a restart still knows the anchors.

import { readFileSync, writeFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Anchor, HomeModel, Vec2 } from "@/lib/types";
import { bounds, innerPoint, pointInPolygon, roomAt, roomPath, routeBetween } from "@/lib/world/geometry";
import { HttpError, type ModuleCtx, type MonitorModule } from "../module";

type Source = "fixture" | "supabase";

function client(): SupabaseClient | undefined {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || process.env.HOME_MODEL_SOURCE === "fixture") return;
  return createClient(url, key, { auth: { persistSession: false } });
}

async function latestFromSupabase(householdId: string): Promise<HomeModel | undefined> {
  const db = client();
  if (!db) return;
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

async function load(ctx: ModuleCtx): Promise<{ label: string; source: Source }> {
  try {
    const model = await latestFromSupabase(ctx.cfg.householdId);
    if (model) {
      ctx.store.world = model;
      return { label: `supabase v${model.version}`, source: "supabase" };
    }
  } catch (e) {
    ctx.log("world", "supabase load failed, using the fixture:", (e as Error).message);
  }
  ctx.store.world = JSON.parse(readFileSync(ctx.cfg.homeModelPath, "utf8")) as HomeModel;
  return { label: ctx.cfg.homeModelPath, source: "fixture" };
}

async function persist(ctx: ModuleCtx, source: Source) {
  const model = ctx.world();
  if (source === "fixture") {
    writeFileSync(ctx.cfg.homeModelPath, JSON.stringify(model, null, 2));
    ctx.log("world", "saved home model");
    return;
  }
  const db = client();
  if (!db) throw new HttpError(500, "supabase is not configured");
  const { data: latest, error: readError } = await db
    .from("home_models")
    .select("version")
    .eq("household_id", model.householdId || ctx.cfg.householdId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (readError) throw new HttpError(500, readError.message);
  const version = Math.max(model.version, (latest?.version ?? 0) + 1);
  const next = { ...model, version };
  ctx.store.world = next;
  const { error } = await db.from("home_models").insert({
    household_id: next.householdId || ctx.cfg.householdId,
    version,
    model: next,
    note: "listener placement",
  });
  if (error) throw new HttpError(500, error.message);
  ctx.log("world", `saved home model v${version}`);
}

const world: MonitorModule = {
  name: "world",
  async register(ctx) {
    let loaded = await load(ctx);
    ctx.log("world", `loaded ${loaded.label}: ${ctx.world().rooms.length} rooms, ${ctx.world().anchors.length} anchors`);

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

    ctx.http.get("/world/rooms", () => {
      const h = ctx.world();
      return {
        rooms: h.rooms.map((r) => ({ id: r.id, name: r.name })),
        anchors: h.anchors.map((a) => ({ receiverId: a.receiverId, position: a.position, heightIn: a.heightIn })),
      };
    });

    // Stand a listener in a room (at its middle) or at an exact spot on the plan: { receiverId, roomId } or
    // { receiverId, position: { x, y } } in inches. The inference engine picks the change up on its next frame.
    ctx.http.post("/world/assign", async (req) => {
      const { receiverId, roomId, heightIn, position } = req.body as { receiverId?: string; roomId?: string; heightIn?: number; position?: Vec2 };
      if (!receiverId || typeof receiverId !== "string") throw new HttpError(400, "receiverId required");

      const h = ctx.world();
      let at: Vec2;
      if (position && Number.isFinite(position.x) && Number.isFinite(position.y)) {
        const b = bounds(h.rooms.flatMap((r) => r.polygon));
        if (position.x < b.minX - 60 || position.x > b.maxX + 60 || position.y < b.minY - 60 || position.y > b.maxY + 60)
          throw new HttpError(400, "that spot is outside the home");
        at = { x: Math.round(position.x), y: Math.round(position.y) };
      } else {
        if (!roomId || typeof roomId !== "string") throw new HttpError(400, "roomId or position required");
        const room = h.rooms.find((r) => r.id === roomId);
        if (!room) throw new HttpError(400, `room "${roomId}" not found`);
        // The middle of an L shaped room can fall outside it; then the most open point inside
        at = pointInPolygon(room.centroid, room.polygon) ? room.centroid : innerPoint(room.polygon);
      }

      const existing = h.anchors.findIndex((a) => a.receiverId === receiverId);
      const anchor: Anchor = { receiverId, position: at, heightIn: heightIn ?? h.anchors[existing]?.heightIn ?? 36 };
      if (existing >= 0) h.anchors[existing] = anchor;
      else h.anchors.push(anchor);
      h.version++;
      await persist(ctx, loaded.source);
      return { ok: true, anchor, roomId: roomAt(h, at)?.id, version: ctx.world().version };
    });

    ctx.http.post("/world/unassign", async (req) => {
      const { receiverId } = req.body as { receiverId?: string };
      if (!receiverId) throw new HttpError(400, "receiverId required");
      const h = ctx.world();
      h.anchors = h.anchors.filter((a) => a.receiverId !== receiverId);
      h.version++;
      await persist(ctx, loaded.source);
      return { ok: true, version: ctx.world().version };
    });

    ctx.http.post("/world/reload", async () => {
      loaded = await load(ctx);
      ctx.log("world", `reloaded ${loaded.label}`);
      return { version: ctx.world().version, source: loaded.label };
    });
  },
};

export default world;
