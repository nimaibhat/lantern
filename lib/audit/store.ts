import "server-only";
import { db } from "@/lib/supabase/server";
import type { HomeModel, Mobility } from "@/lib/types";
import type { AuditDraft } from "./ada";
import { ruleItems } from "./mobility";

export function auditRow(item: AuditDraft, householdId: string) {
  return {
    household_id: householdId,
    room_id: item.roomId,
    source: item.source,
    code: item.code ?? null,
    title: item.title,
    detail: item.detail,
    fix: item.fix,
    severity: item.severity,
    measured_in: item.measuredIn ?? null,
    required_in: item.requiredIn ?? null,
    photo_path: item.photoPath ?? null,
    location: item.location ?? null,
  };
}

// Runs the measurement rules for this person and replaces the previous rule results for the home's rooms.
// Photo findings are left alone.
export async function replaceRuleItems(householdId: string, home: HomeModel, mobility: Mobility): Promise<AuditDraft[]> {
  if (!db) throw new Error("Supabase is not configured");
  const items = ruleItems(home, mobility);
  await db.from("audit_items").delete().eq("household_id", householdId).in("room_id", home.rooms.map((r) => r.id)).eq("source", "ada-rule");
  if (items.length) {
    const { error } = await db.from("audit_items").insert(items.map((item) => auditRow(item, householdId)));
    if (error) throw new Error(error.message);
  }
  return items;
}
