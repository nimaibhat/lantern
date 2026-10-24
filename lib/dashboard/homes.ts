import "server-only";
import metrics from "@/ml/out/metrics.json";
import { DEMO_HOUSEHOLD_ID, isReadOnly, myHouseholdIds } from "@/lib/households";
import { db } from "@/lib/supabase/server";
import type { HomeModel } from "@/lib/types";
import { polygonArea } from "@/lib/world/geometry";
import { demoHome, getHomeModel } from "@/lib/world/store";
import * as mock from "./mock";

// One card per home on the Homes page (/dashboard): the demo home first, then the homes this browser added.

const ADA_DOOR_MIN_IN = 32;

export interface HomeCard {
  id: string;
  name: string;
  patientName: string;
  demo: boolean; // the monitored home: live tracking and the night story
  readOnly: boolean;
  model: HomeModel;
  scanned: boolean; // false until the first scan is processed
  scanStatus?: string; // newest scan: processing, done or failed
  areaSqFt: number;
  narrowDoors: number;
  ruleIssues: number;
  photoHazards: number;
}

// Room accuracy from the last training run, and whether that run used real recordings.
export const roomAccuracy = { percent: Math.round(metrics.accuracy * 100), simulated: metrics.dataset === "synthetic" };

function summarize(model: HomeModel) {
  const rooms = model.rooms.filter((r) => !r.virtual);
  return {
    areaSqFt: Math.round(rooms.reduce((s, r) => s + polygonArea(r.polygon), 0) / 144),
    narrowDoors: model.doors.filter((d) => d.widthIn < ADA_DOOR_MIN_IN).length,
  };
}

export async function homeCard(id: string): Promise<HomeCard | null> {
  const demo = id === DEMO_HOUSEHOLD_ID;
  if (!db) {
    if (!demo) return null;
    const vision = mock.auditItems.filter((a) => a.source === "vision").length;
    return { id, name: mock.household.name, patientName: mock.household.patientName, demo, readOnly: isReadOnly(id), model: demoHome, scanned: true, ...summarize(demoHome), ruleIssues: mock.auditItems.length - vision, photoHazards: vision };
  }

  const [{ data: h }, { model }, { data: items }, { data: scan }] = await Promise.all([
    db.from("households").select("id, name, patient_name").eq("id", id).maybeSingle(),
    getHomeModel(id),
    db.from("audit_items").select("source").eq("household_id", id).in("status", ["open", "accepted"]),
    db.from("scans").select("status").eq("household_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (!h) return null;
  const sources = (items ?? []).map((i) => i.source as string);
  return {
    id,
    name: h.name,
    patientName: h.patient_name,
    demo,
    readOnly: isReadOnly(id),
    model,
    scanned: model.rooms.length > 0,
    scanStatus: scan?.status ?? undefined,
    ...summarize(model),
    ruleIssues: sources.filter((s) => s !== "vision").length,
    photoHazards: sources.filter((s) => s === "vision").length,
  };
}

export async function listHomes(): Promise<HomeCard[]> {
  const ids = [DEMO_HOUSEHOLD_ID, ...(await myHouseholdIds())];
  const cards = await Promise.all(ids.map(homeCard));
  return cards.filter((c): c is HomeCard => c !== null);
}
