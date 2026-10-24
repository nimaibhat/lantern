"use server";

import { revalidatePath } from "next/cache";
import { db, HOUSEHOLD_ID } from "@/lib/supabase/server";

// OT notes on audit items. Limited to the demo household until login exists.
export async function setAuditNote(id: string, note: string) {
  if (!db) return;
  const { error } = await db.from("audit_items").update({ note: note.slice(0, 500) || null }).eq("id", id).eq("household_id", HOUSEHOLD_ID);
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/audit", "layout");
}
