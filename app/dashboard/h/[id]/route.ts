import { NextResponse, type NextRequest } from "next/server";
import { DEMO_HOUSEHOLD_ID, isHouseholdId, openHousehold } from "@/lib/households";
import { db } from "@/lib/supabase/server";

// GET /dashboard/h/<householdId>: open that home in the dashboard (remembered in a cookie), then go to its overview.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const home = new URL("/dashboard", req.url);
  if (!isHouseholdId(id)) return NextResponse.redirect(home);
  if (id !== DEMO_HOUSEHOLD_ID) {
    const { data } = db ? await db.from("households").select("id").eq("id", id).maybeSingle() : { data: null };
    if (!data) return NextResponse.redirect(home);
  }
  await openHousehold(id);
  return NextResponse.redirect(new URL("/dashboard/overview", req.url));
}
