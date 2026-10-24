import Link from "next/link";
import { getHomeModel } from "@/lib/world/store";
import { WorldView } from "./world-view";

// /dashboard/world: the live home in 3D or 2D. ?mock=1 plays the scripted walk with no backend; ?view=2d or
// ?view=3d opens that view (otherwise the last one used in this browser).
export default async function WorldPage({ searchParams }: { searchParams: Promise<{ mock?: string; view?: string }> }) {
  const [{ model }, { mock, view }] = await Promise.all([getHomeModel(), searchParams]);
  if (model.rooms.length === 0)
    return (
      <div className="card">
        <h2>No scan yet</h2>
        <p className="muted">Scan the home with the Lantern app to see it here in 3D.</p>
        <Link href="/dashboard/settings" className="btn">
          Pair a phone
        </Link>
      </div>
    );
  const initialView = view === "2d" || view === "3d" ? view : undefined;
  return <WorldView home={model} mock={mock === "1" || process.env.NEXT_PUBLIC_MOCK === "1"} initialView={initialView} />;
}
