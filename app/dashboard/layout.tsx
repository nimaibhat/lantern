import { getHousehold } from "@/lib/dashboard/data";
import "./_components/dashboard.css";
import { Shell } from "./_components/shell";

// Always read fresh data; nothing here should be cached at build time.
export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const household = await getHousehold();
  return <Shell householdName={household.name}>{children}</Shell>;
}
