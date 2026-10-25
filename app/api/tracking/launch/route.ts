import { earLaunch, originFor } from "@/lib/sensing/ear-bat";
import { earMacLaunch } from "@/lib/sensing/ear-mac";
import { db, HOUSEHOLD_ID } from "@/lib/supabase/server";

// The other laptop opens this link. The file is a short visible bat/command that downloads the scanner and runs it there.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const id = (url.searchParams.get("id") ?? "").toLowerCase();
  if (!/^ear-[a-f0-9]{8}$/.test(id)) return new Response("Unknown device.", { status: 400 });
  if (!db) return new Response("Supabase is not configured.", { status: 503 });
  const { data } = await db.from("receivers").select("id, label").eq("id", id).eq("household_id", HOUSEHOLD_ID).maybeSingle();
  if (!data) return new Response("Unknown device.", { status: 404 });
  const label = typeof data.label === "string" ? data.label : "laptop";
  const postUrl = `${originFor(request)}/api/tracking`;

  const ua = request.headers.get("user-agent") ?? "";
  const isMac = /Macintosh|Mac OS/i.test(ua) && !/iPhone|iPad|iPod/i.test(ua);

  if (isMac) {
    const body = earMacLaunch(id, postUrl, label);
    return new Response(body, {
      headers: {
        "content-type": "application/octet-stream",
        "content-disposition": 'attachment; filename="Lantern.command"',
        "cache-control": "no-store",
      },
    });
  }

  const body = earLaunch(id, postUrl, label);
  return new Response(body, {
    headers: {
      "content-type": "application/octet-stream",
      "content-disposition": 'attachment; filename="Lantern.bat"',
      "cache-control": "no-store",
    },
  });
}
