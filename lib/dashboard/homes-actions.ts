"use server";

import { myHouseholdIds, rememberHousehold } from "@/lib/households";
import { createPairCode } from "@/lib/scan/pairing";
import { db } from "@/lib/supabase/server";

// Add a home (/dashboard/new): create the household, pair the scanning app, then watch the scan arrive.
// Only the browser that created a home can pair or poll it (its id is in that browser's cookie).

export type NewHome = { id: string; code: string; expiresAt: string };
export type HomeProgress = { scan: "waiting" | "processing" | "done" | "failed"; rooms: number; issues: number; photoHazards: number };

const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

export async function createHome(input: { name: string; patientName: string; timezone?: string }): Promise<NewHome> {
  if (!db) throw new Error("Adding a home needs the database. Fill in the Supabase keys in .env.local.");
  const name = clean(input.name, 60);
  const patientName = clean(input.patientName, 40);
  if (!name || !patientName) throw new Error("Give the home a name and say who lives there.");
  const timezone = clean(input.timezone, 60);
  const validZone = (() => {
    try {
      return !!timezone && !!new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    } catch {
      return false;
    }
  })();

  const { data, error } = await db
    .from("households")
    .insert({ name, patient_name: patientName, ...(validZone ? { timezone } : {}) })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Could not add the home.");
  await rememberHousehold(data.id);
  return { id: data.id, ...(await createPairCode(data.id)) };
}

async function mine(id: string) {
  if (!db || !(await myHouseholdIds()).includes(id)) throw new Error("This home was added in another browser.");
  return db;
}

export async function newPairCode(id: string): Promise<NewHome> {
  await mine(id);
  return { id, ...(await createPairCode(id)) };
}

export async function homeProgress(id: string): Promise<HomeProgress> {
  const client = await mine(id);
  const [{ data: scan }, { count: rooms }, { data: items }] = await Promise.all([
    client.from("scans").select("status").eq("household_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    client.from("rooms").select("id", { count: "exact", head: true }).eq("household_id", id),
    client.from("audit_items").select("source").eq("household_id", id),
  ]);
  const status = scan?.status as string | undefined;
  const sources = (items ?? []).map((i) => i.source as string);
  return {
    scan: !status ? "waiting" : status === "done" || status === "failed" ? status : "processing",
    rooms: rooms ?? 0,
    issues: sources.filter((s) => s !== "vision").length,
    photoHazards: sources.filter((s) => s === "vision").length,
  };
}
