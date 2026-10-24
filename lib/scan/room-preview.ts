import "server-only";
import { db } from "@/lib/supabase/server";
import { startWorld } from "./worldlabs";

// Starts the World Labs 3D preview for one room from its photos. The rooms table tracks the job; the room page
// polls refreshRoomPreview until it is ready (about 5 minutes).
export async function startRoomPreview(roomId: string, householdId: string): Promise<boolean> {
  if (!db) throw new Error("Supabase is not configured");
  const { data: room } = await db.from("rooms").select("name, photo_paths").eq("id", roomId).eq("household_id", householdId).maybeSingle();
  if (!room) throw new Error("Room not found");
  if (!room.photo_paths?.length) return false;

  // World Labs downloads the photos itself, so give it signed links that outlive the generation.
  const { data: signed } = await db.storage.from("photos").createSignedUrls(room.photo_paths, 6 * 60 * 60);
  const urls = (signed ?? []).flatMap((s) => (s.signedUrl ? [s.signedUrl] : []));
  if (!urls.length) return false;
  const operationId = await startWorld(room.name, urls);
  await db.from("rooms").update({ preview_status: "generating", preview_operation_id: operationId }).eq("id", roomId);
  return true;
}
