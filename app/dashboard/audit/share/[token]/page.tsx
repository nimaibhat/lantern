import { notFound } from "next/navigation";
import { householdFromToken } from "@/lib/audit/share";
import { getAuditItems, getRooms } from "@/lib/dashboard/data";
import { AuditReport } from "../../audit-report";

// Read-only copy of the report for an OT or family member. No buttons, notes shown as text.
export default async function SharedAuditPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const householdId = householdFromToken(token);
  if (!householdId) notFound();
  const [items, rooms] = await Promise.all([getAuditItems(householdId), getRooms(householdId)]);
  return <AuditReport initialItems={items.filter((a) => a.status !== "dismissed")} rooms={rooms} subtitle="Shared read-only copy." readOnly />;
}
