"use server";

import { revalidatePath } from "next/cache";
import { writableHouseholdId } from "@/lib/households";
import { db } from "@/lib/supabase/server";

// OT notes on audit items, for the home being viewed.
export async function setAuditNote(id: string, note: string) {
  if (!db) return;
  const { error } = await db.from("audit_items").update({ note: note.slice(0, 500) || null }).eq("id", id).eq("household_id", await writableHouseholdId());
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/audit", "layout");
}
