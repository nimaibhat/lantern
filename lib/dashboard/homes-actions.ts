"use server";

import { myHouseholdIds, rememberHousehold } from "@/lib/households";
import { createPairCode } from "@/lib/scan/pairing";
import { db } from "@/lib/supabase/server";
import type { HomeModel } from "@/lib/types";
import { getHomeModel } from "@/lib/world/store";

// Add a home (/dashboard/new): create the household, pair the scanning app, then watch the scan arrive.
// Only the browser that created a home can pair or poll it (its id is in that browser's cookie).

export type NewHome = { id: string; code: string; expiresAt: string };
export type ScanPhoto = { path: string; url: string; hazard?: string };
// The build view on /dashboard/new draws from this, so it carries the floor plan and photos, not just counts.
export type HomeProgress = {
  scan: "waiting" | "uploading" | "processing" | "done" | "failed";
  model?: HomeModel; // once the rooms are measured
  rooms: number;
  issues: number;
  photoHazards: number;
  photos: ScanPhoto[];
};

const PHOTO_URL_SECONDS = 60 * 60;

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
  const [{ data: scan }, { data: rooms }, { data: items }, { model, saved }] = await Promise.all([
    client.from("scans").select("status").eq("household_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    client.from("rooms").select("photo_paths").eq("household_id", id),
    client.from("audit_items").select("source, title, photo_path").eq("household_id", id),
    getHomeModel(id),
  ]);
  const status = scan?.status as HomeProgress["scan"] | undefined;
  const vision = (items ?? []).filter((i) => i.source === "vision");
  const flagged = new Map(vision.filter((i) => i.photo_path).map((i) => [i.photo_path as string, i.title as string]));

  const paths = (rooms ?? []).flatMap((r) => (r.photo_paths as string[] | null) ?? []);
  const { data: signed } = paths.length ? await client.storage.from("photos").createSignedUrls(paths, PHOTO_URL_SECONDS) : { data: [] };
  const photos = (signed ?? []).flatMap((d) => (d.signedUrl && d.path ? [{ path: d.path, url: d.signedUrl, hazard: flagged.get(d.path) }] : []));

  return {
    scan: status ?? "waiting",
    model: saved && model.rooms.length > 0 ? model : undefined,
    rooms: rooms?.length ?? 0,
    issues: (items ?? []).length - vision.length,
    photoHazards: vision.length,
    photos,
  };
}
