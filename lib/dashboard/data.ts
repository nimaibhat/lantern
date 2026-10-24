import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import * as mock from "./mock";
import { currentHouseholdId, DEMO_HOUSEHOLD_ID } from "@/lib/households";
import { db } from "@/lib/supabase/server";
import type { Activity, AuditItem, Contact, Household, Receiver, RiskEvent, Room, RoutineStep, ScanSummary } from "@/lib/types";
import type { RuleInput } from "./zone-rules";

// Reads for the dashboard. Each function maps database rows (snake_case) to the shared types.

type Result<T> = { data: T | null; error: { message: string } | null };

// Database rows are untyped until we generate types; this keeps the mappers readable.
type Row = Record<string, any>;

function rows(res: Result<Row[]>): Row[] {
  if (res.error) throw new Error(`Supabase: ${res.error.message}`);
  return res.data ?? [];
}

const hhmm = (time: string) => time.slice(0, 5); // "07:00:00" -> "07:00"

const clockIn = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(new Date(iso));

const RECEIVER_TIMEOUT_MS = 5 * 60 * 1000;
const PHOTO_URL_SECONDS = 60 * 60;

// Photos live in a private bucket, so the browser gets short-lived signed URLs.
async function signPhotos(paths: string[]): Promise<Map<string, string>> {
  if (!db || paths.length === 0) return new Map();
  const { data } = await db.storage.from("photos").createSignedUrls(paths, PHOTO_URL_SECONDS);
  return new Map((data ?? []).flatMap((d) => (d.signedUrl && d.path ? [[d.path, d.signedUrl] as const] : [])));
}

if (!db) console.warn("Supabase env is not set; the dashboard is using mock data.");

// cache() lets the layout and the page share one query per request.
export const getHousehold = cache(async (): Promise<Household> => {
  if (!db) return mock.household;
  const id = await currentHouseholdId();
  const [h] = rows(await db.from("households").select().eq("id", id));
  // A saved home that no longer exists: go back to the demo home (the route resets the cookie).
  if (!h && id !== DEMO_HOUSEHOLD_ID) redirect(`/dashboard/h/${DEMO_HOUSEHOLD_ID}`);
  if (!h) throw new Error(`Household ${id} not found. Run supabase/seed.sql.`);
  return {
    id: h.id,
    name: h.name,
    patientName: h.patient_name,
    mobility: h.mobility ?? "none",
    quietHoursStart: hhmm(h.quiet_hours_start),
    quietHoursEnd: hhmm(h.quiet_hours_end),
    timezone: h.timezone,
  };
});

// householdId: a specific home (the shared audit link); otherwise the home being viewed.
export const getRooms = cache(async (householdId?: string): Promise<Room[]> => {
  if (!db) return mock.rooms;
  const list = rows(await db.from("rooms").select().eq("household_id", householdId ?? (await currentHouseholdId())).order("name"));
  const urls = await signPhotos(list.flatMap((r) => r.photo_paths));
  return list.map((r) => ({
    id: r.id,
    scanId: r.scan_id ?? "",
    name: r.name,
    outline: r.outline,
    walls: [],
    doors: r.doors,
    windows: r.windows,
    objects: r.objects,
    photoPaths: r.photo_paths,
    photoUrls: r.photo_paths.map((p: string) => urls.get(p)).filter(Boolean),
    preview: {
      status: r.preview_status,
      worldUrl: r.preview_world_url ?? undefined,
      splatUrl: r.preview_splat_url ?? undefined,
      thumbnailUrl: r.preview_thumbnail_url ?? undefined,
      panoUrl: r.preview_pano_url ?? undefined,
    },
  }));
});

export async function getLatestScan(): Promise<ScanSummary | null> {
  if (!db) return null;
  const { timezone } = await getHousehold();
  const res = await db.from("scans").select().eq("household_id", await currentHouseholdId()).order("created_at", { ascending: false }).limit(1);
  const [scan] = rows(res);
  if (!scan) return null;
  const sameDay = new Date(scan.created_at).toDateString() === new Date().toDateString();
  return {
    id: scan.id,
    status: scan.status,
    rooms: (scan.manifest ?? []).length,
    createdAt: sameDay
      ? clockIn(scan.created_at, timezone)
      : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: timezone }).format(new Date(scan.created_at)),
  };
}

// The home's zone rules for the Settings editor, in a stable order (by room, then start hour).
export async function getZoneRules(): Promise<RuleInput[]> {
  if (!db) return [];
  return rows(await db.from("zone_rules").select().eq("household_id", await currentHouseholdId()))
    .map((r) => ({ roomKind: r.room_kind, action: r.action, startHour: r.start_hour, endHour: r.end_hour }))
    .sort((a, b) => a.roomKind.localeCompare(b.roomKind) || a.startHour - b.startHour);
}

export async function getContacts(): Promise<Contact[]> {
  if (!db) return mock.contacts;
  return rows(await db.from("contacts").select().eq("household_id", await currentHouseholdId()).order("priority")).map((c) => ({
    id: c.id,
    name: c.name,
    relation: c.relation,
    phone: c.phone,
    priority: c.priority,
  }));
}

export async function getReceivers(): Promise<Receiver[]> {
  if (!db) return mock.receivers;
  const now = Date.now();
  return rows(await db.from("receivers").select().eq("household_id", await currentHouseholdId()).order("label")).map((r) => ({
    id: r.id,
    label: r.label,
    roomId: r.room_id,
    online: !!r.last_seen_at && now - new Date(r.last_seen_at).getTime() < RECEIVER_TIMEOUT_MS,
  }));
}

export async function getAuditItems(householdId?: string): Promise<AuditItem[]> {
  if (!db) return mock.auditItems;
  const list = rows(await db.from("audit_items").select().eq("household_id", householdId ?? (await currentHouseholdId())).order("created_at"));
  const urls = await signPhotos(list.map((a) => a.photo_path).filter(Boolean));
  return list.map((a) => ({
    id: a.id,
    roomId: a.room_id,
    source: a.source,
    code: a.code ?? undefined,
    title: a.title,
    detail: a.detail,
    fix: a.fix,
    severity: a.severity,
    measuredIn: a.measured_in ?? undefined,
    requiredIn: a.required_in ?? undefined,
    photoPath: a.photo_path ?? undefined,
    photoUrl: urls.get(a.photo_path),
    note: a.note ?? undefined,
    location: a.location ?? undefined,
    status: a.status,
  }));
}

export async function getRoutineSteps(): Promise<RoutineStep[]> {
  if (!db) return mock.routineSteps;
  return rows(await db.from("routine_steps").select().eq("household_id", await currentHouseholdId()).order("time")).map((s, i) => ({
    id: s.id,
    routineId: s.routine_id,
    order: i + 1,
    time: hhmm(s.time),
    title: s.title,
    roomId: s.room_id ?? undefined,
    photoPath: s.photo_path ?? undefined,
    voicePath: s.voice_path ?? undefined,
  }));
}

// The latest 50 lines, oldest first, so the UI can append live ones at the end.
export async function getActivity(): Promise<Activity[]> {
  if (!db) return mock.timeline;
  const { timezone } = await getHousehold();
  const res = await db.from("activity").select().eq("household_id", await currentHouseholdId()).order("ts", { ascending: false }).limit(50);
  return rows(res)
    .reverse()
    .map((a) => ({ id: a.id, kind: a.kind, text: a.text, time: clockIn(a.ts, timezone) }));
}

export async function getRiskEvents(): Promise<RiskEvent[]> {
  if (!db) return mock.riskEvents;
  const { timezone } = await getHousehold();
  const res = await db.from("risk_events").select().eq("household_id", await currentHouseholdId()).order("started_at", { ascending: false }).limit(10);
  return rows(res).map((r) => ({
    id: r.id,
    householdId: r.household_id,
    kind: r.kind,
    roomId: r.room_id,
    trigger: r.trigger ?? "detected",
    state: r.state,
    source: r.source ?? "ble",
    startedAt: clockIn(r.started_at, timezone),
    resolvedAt: r.resolved_at ? clockIn(r.resolved_at, timezone) : undefined,
  }));
}
