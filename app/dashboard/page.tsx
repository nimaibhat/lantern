import { getActivity, getAuditItems, getHousehold, getLatestScan, getReceivers, getRiskEvents, getRooms } from "@/lib/dashboard/data";
import { Overview } from "./_components/overview";

export default async function DashboardPage() {
  const [household, rooms, receivers, auditItems, activity, risks, scan] = await Promise.all([
    getHousehold(),
    getRooms(),
    getReceivers(),
    getAuditItems(),
    getActivity(),
    getRiskEvents(),
    getLatestScan(),
  ]);

  return <Overview household={household} rooms={rooms} receivers={receivers} auditItems={auditItems} activity={activity} risks={risks} scan={scan} />;
}
