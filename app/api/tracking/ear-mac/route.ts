import { originFor } from "@/lib/sensing/ear-mac";
import { earMacScript } from "@/lib/sensing/ear-mac";
import { db, HOUSEHOLD_ID } from "@/lib/supabase/server";

// The Mac laptop downloads this script (via the launcher .command or a curl one-liner).
export async function GET(request: Request) {
  const url = new URL(request.url);
  const id = (url.searchParams.get("id") ?? "").toLowerCase();
  if (!/^ear-[a-f0-9]{8}$/.test(id)) return new Response("Unknown device.", { status: 400 });
  if (!db) return new Response("Supabase is not configured.", { status: 503 });
  const { data } = await db.from("receivers").select("id").eq("id", id).eq("household_id", HOUSEHOLD_ID).maybeSingle();
  if (!data) return new Response("Unknown device.", { status: 404 });
  return new Response(earMacScript(id, `${originFor(request)}/api/tracking`), {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}
