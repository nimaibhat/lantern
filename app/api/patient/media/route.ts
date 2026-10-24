import { NextResponse, type NextRequest } from "next/server";
import { REDIRECT_PHOTO } from "@/lib/dashboard/redirect-media";
import { db } from "@/lib/supabase/server";
import { getHomeModel } from "@/lib/world/store";

// GET /api/patient/media?h=<householdId>&path=<storage path>
// The TV page has no login and only knows its household id, so a file is served only when its path sits in that
// household's folder, through a short-lived signed URL. Without Supabase there is nothing to serve; the TV page
// then speaks the message itself.
const AUDIO = /\.(m4a|mp3|wav|webm|ogg|aac)$/i;

export async function GET(req: NextRequest) {
  const h = req.nextUrl.searchParams.get("h") ?? "";
  const path = req.nextUrl.searchParams.get("path") ?? "";
  if (!h || !path.startsWith(`${h}/`) || path.includes("..")) return NextResponse.json({ error: "bad path" }, { status: 400 });
  if (!db) return NextResponse.json({ error: "storage is not configured" }, { status: 404 });

  const bucket = AUDIO.test(path) ? "voice" : "photos";
  let { data, error } = await db.storage.from(bucket).createSignedUrl(path, 300);
  // No photo chosen in Settings yet: show the scanned bedroom photo instead.
  if ((error || !data) && path === `${h}/${REDIRECT_PHOTO}`) {
    const { model } = await getHomeModel(h);
    const bedroom = model.rooms.find((r) => r.kind === "bedroom")?.photoPaths?.[0];
    if (bedroom) ({ data, error } = await db.storage.from("photos").createSignedUrl(bedroom, 300));
  }
  if (error || !data) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.redirect(data.signedUrl, { headers: { "Cache-Control": "private, max-age=240" } });
}
