import "server-only";
import fixture from "@/fixtures/home-model.json";
import { currentHouseholdId, DEMO_HOUSEHOLD_ID } from "@/lib/households";
import { db } from "@/lib/supabase/server";
import type { AuditItem, Hazard, HomeModel } from "@/lib/types";

// Reading and saving the shared home model. Each save is a new home_models row with the next version.
// Without Supabase (or before the demo home's first save) the demo home reads the fixture. Any other home starts
// empty until its first scan, so a new home never shows someone else's house.

export const demoHome = fixture as HomeModel;
export const emptyHome = (householdId: string): HomeModel => ({ householdId, version: 0, unit: "in", rooms: [], doors: [], anchors: [], hazards: [] });

export async function getHomeModel(id?: string): Promise<{ model: HomeModel; saved: boolean }> {
  const householdId = id ?? (await currentHouseholdId());
  if (!db) return { model: demoHome, saved: false };
  const { data, error } = await db
    .from("home_models")
    .select("model")
    .eq("household_id", householdId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Supabase: ${error.message}`);
  if (data) return { model: data.model as HomeModel, saved: true };
  return { model: householdId === DEMO_HOUSEHOLD_ID ? { ...demoHome, householdId } : emptyHome(householdId), saved: false };
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
export async function syncHazards(householdId: string): Promise<number> {
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

// Tell a running monitor to pick up the new model (or the saved Settings). Best effort: it may not be running.
export async function reloadMonitor(path: "/world/reload" | "/household/reload" = "/world/reload") {
  const url = process.env.MONITOR_URL || process.env.NEXT_PUBLIC_MONITOR_URL || "http://localhost:8787"; // same default as the dashboard
  try {
    await fetch(`${url}${path}`, { method: "POST", signal: AbortSignal.timeout(1500) });
  } catch {
    // Not running; it loads the newest model and settings on start.
  }
}
