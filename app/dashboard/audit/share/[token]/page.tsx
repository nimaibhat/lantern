import { notFound } from "next/navigation";
import { householdFromToken } from "@/lib/audit/share";
import { getAuditItems, getRooms } from "@/lib/dashboard/data";
import { HOUSEHOLD_ID } from "@/lib/supabase/server";
import { AuditReport } from "../../audit-report";

// Read-only copy of the report for an OT or family member. No buttons, notes shown as text.
export default async function SharedAuditPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (householdFromToken(token) !== HOUSEHOLD_ID) notFound();
  const [items, rooms] = await Promise.all([getAuditItems(), getRooms()]);
  return <AuditReport initialItems={items.filter((a) => a.status !== "dismissed")} rooms={rooms} subtitle="Shared read-only copy." readOnly />;
}
