import { notFound } from "next/navigation";
import { shareToken } from "@/lib/audit/share";
import { getAuditItems, getRooms } from "@/lib/dashboard/data";
import { HOUSEHOLD_ID } from "@/lib/supabase/server";
import { AuditReport } from "../audit-report";

// The report for one scan: only the rooms that scan produced.
export default async function ScanAuditPage({ params }: { params: Promise<{ scanId: string }> }) {
  const { scanId } = await params;
  const [items, allRooms] = await Promise.all([getAuditItems(), getRooms()]);
  const rooms = allRooms.filter((r) => r.scanId === scanId);
  if (rooms.length === 0) notFound();
  const ids = new Set(rooms.map((r) => r.id));
  return (
    <AuditReport
      initialItems={items.filter((a) => ids.has(a.roomId))}
      rooms={rooms}
      subtitle={`Scan ${scanId.slice(0, 8)}, ${rooms.length} rooms.`}
      shareUrl={`/dashboard/audit/share/${shareToken(HOUSEHOLD_ID)}`}
    />
  );
}
