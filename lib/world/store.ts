import "server-only";
import fixture from "@/fixtures/home-model.json";
import { db, HOUSEHOLD_ID } from "@/lib/supabase/server";
import type { AuditItem, Hazard, HomeModel } from "@/lib/types";

// Reading and saving the shared home model. Each save is a new home_models row with the next version.
// Without Supabase (or before the first save) everything reads the demo fixture.

export const demoHome = fixture as HomeModel;

export async function getHomeModel(householdId = HOUSEHOLD_ID): Promise<{ model: HomeModel; saved: boolean }> {
  if (!db) return { model: demoHome, saved: false };
  const { data, error } = await db
    .from("home_models")
    .select("model")
    .eq("household_id", householdId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Supabase: ${error.message}`);
  return data ? { model: data.model as HomeModel, saved: true } : { model: { ...demoHome, householdId }, saved: false };
}

export async function saveHomeModel(model: HomeModel, opts: { scanId?: string; note?: string } = {}): Promise<HomeModel> {
  if (!db) throw new Error("Supabase is not configured");
  const { model: latest, saved } = await getHomeModel(model.householdId);
  const version = Math.max(model.version, saved ? latest.version + 1 : 1);
  const next = { ...model, version };
  const { error } = await db.from("home_models").insert({
    household_id: model.householdId,
    version,
    model: next,
    scan_id: opts.scanId ?? null,
    note: opts.note ?? null,
  });
  if (error) throw new Error(error.message);
  await reloadMonitor();
  return next;
}

// Audit items with a position become hazard pins on the model.
export const hazardsFrom = (items: Pick<AuditItem, "roomId" | "title" | "severity" | "location">[], idPrefix = "h"): Hazard[] =>
  items
    .filter((i) => i.location)
    .map((i, n) => ({ id: `${idPrefix}${n + 1}`, roomId: i.roomId, position: i.location!, title: i.title, severity: i.severity }));

// After new audit items land (for example the photo check), refresh the pins on the newest model in place.
export async function syncHazards(householdId = HOUSEHOLD_ID): Promise<number> {
  if (!db) return 0;
  const { data: row } = await db
    .from("home_models")
    .select("id, model")
    .eq("household_id", householdId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!row) return 0;
  const { data: items } = await db
    .from("audit_items")
    .select("room_id, title, severity, location")
    .eq("household_id", householdId)
    .in("status", ["open", "accepted"])
    .not("location", "is", null);
  const hazards = hazardsFrom((items ?? []).map((i) => ({ roomId: i.room_id, title: i.title, severity: i.severity, location: i.location })));
  await db.from("home_models").update({ model: { ...(row.model as HomeModel), hazards } }).eq("id", row.id);
  await reloadMonitor();
  return hazards.length;
}

// Tell a running monitor to pick up the new model. Best effort: the monitor may not be running.
async function reloadMonitor() {
  const url = process.env.MONITOR_URL || process.env.NEXT_PUBLIC_MONITOR_URL;
  if (!url) return;
  try {
    await fetch(`${url}/world/reload`, { method: "POST", signal: AbortSignal.timeout(1500) });
  } catch {
    // Not running; it loads the newest model on start.
  }
}
