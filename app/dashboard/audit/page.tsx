import { shareToken } from "@/lib/audit/share";
import { getAuditItems, getLatestScan, getRooms } from "@/lib/dashboard/data";
import { HOUSEHOLD_ID } from "@/lib/supabase/server";
import { AuditReport } from "./audit-report";

export default async function AuditPage() {
  const [items, rooms, scan] = await Promise.all([getAuditItems(), getRooms(), getLatestScan()]);
  return (
    <AuditReport
      initialItems={items}
      rooms={rooms}
      subtitle={scan ? `From the scan on ${scan.createdAt}.` : "Demo data until the first scan."}
      shareUrl={`/dashboard/audit/share/${shareToken(HOUSEHOLD_ID)}`}
    />
  );
}
