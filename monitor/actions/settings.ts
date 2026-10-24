// The household (name, quiet hours, time zone) and zone rules come from Supabase, as saved in Settings. The monitor
// loads them on start and again on POST /household/reload. Without keys, or with HOME_MODEL_SOURCE=fixture (tests
// and offline runs), it keeps the built-in defaults.

import { createClient } from "@supabase/supabase-js";
import type { RiskKind, RoomKind, ZoneRule } from "@/lib/types";

export type HouseholdSettings = { patientName: string; quietHoursStart: string; quietHoursEnd: string; timezone: string };

type RuleRow = { id: string; household_id: string; room_kind: RoomKind; kind: RiskKind | null; start_hour: number; end_hour: number; action: ZoneRule["action"] };

export const ruleFromRow = (r: RuleRow): ZoneRule => ({
  id: r.id,
  householdId: r.household_id,
  roomKind: r.room_kind,
  ...(r.kind ? { kind: r.kind } : {}),
  startHour: r.start_hour,
  endHour: r.end_hour,
  action: r.action,
});

const hhmm = (t: string) => t.slice(0, 5); // "07:00:00" -> "07:00"

export async function loadSettings(householdId: string): Promise<{ household?: HouseholdSettings; rules?: ZoneRule[] } | undefined> {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || process.env.HOME_MODEL_SOURCE === "fixture") return;
  const db = createClient(url, key, { auth: { persistSession: false } });
  const [h, z] = await Promise.all([
    db.from("households").select("patient_name, quiet_hours_start, quiet_hours_end, timezone").eq("id", householdId).maybeSingle(),
    db.from("zone_rules").select().eq("household_id", householdId),
  ]);
  if (h.error) throw new Error(h.error.message);
  if (z.error) throw new Error(z.error.message);
  return {
    household: h.data
      ? { patientName: h.data.patient_name, quietHoursStart: hhmm(h.data.quiet_hours_start), quietHoursEnd: hhmm(h.data.quiet_hours_end), timezone: h.data.timezone }
      : undefined,
    // A home with no rules saved keeps the defaults rather than running with none.
    rules: z.data?.length ? (z.data as RuleRow[]).map(ruleFromRow) : undefined,
  };
}
