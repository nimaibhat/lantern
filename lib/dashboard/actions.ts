"use server";

import { revalidatePath } from "next/cache";
import { createPairCode } from "@/lib/scan/pairing";
import { currentHouseholdId, writableHouseholdId } from "@/lib/households";
import { db } from "@/lib/supabase/server";
import type { AuditStatus, RoomPreview, RoutineStep } from "@/lib/types";
import { startRoomPreview } from "@/lib/scan/room-preview";
import { checkWorld } from "@/lib/scan/worldlabs";

// Writes from the dashboard. These run on the server with the secret key, scoped to the home being viewed
// (lib/households.ts). On the public deploy the demo home is read-only, so these throw there.

const STATUSES: AuditStatus[] = ["open", "accepted", "dismissed", "fixed"];

export async function setAuditStatus(id: string, status: AuditStatus) {
  if (!STATUSES.includes(status)) throw new Error("Invalid status");
  if (!db) return;
  const householdId = await writableHouseholdId();
  const { error } = await db.from("audit_items").update({ status }).eq("id", id).eq("household_id", householdId);
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard", "layout");
}

export async function addRoutineStep(input: { time: string; title: string; roomId: string }): Promise<RoutineStep> {
  const title = input.title.trim().slice(0, 200);
  if (!title || !/^\d{2}:\d{2}$/.test(input.time)) throw new Error("A step needs a time and a title");

  const step = { id: crypto.randomUUID(), routineId: "rt1", order: 0, time: input.time, title, roomId: input.roomId };
  if (!db) return step;

  const { error } = await db.from("routine_steps").insert({
    id: step.id,
    household_id: await writableHouseholdId(),
    routine_id: step.routineId,
    time: step.time,
    title: step.title,
    room_id: step.roomId,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/routine");
  return step;
}

export async function removeRoutineStep(id: string) {
  if (!db) return;
  const { error } = await db.from("routine_steps").delete().eq("id", id).eq("household_id", await writableHouseholdId());
  if (error) throw new Error(error.message);
  revalidatePath("/routine");
}

// A short code the caregiver types into the iPhone scanning app.
export async function pairPhone() {
  return createPairCode(await writableHouseholdId());
}

// Starts a World Labs 3D preview from the room's photos. Takes about 5 minutes; the page polls refreshRoomPreview.
export async function generateRoomPreview(roomId: string): Promise<RoomPreview> {
  if (!(await startRoomPreview(roomId, await writableHouseholdId()))) throw new Error("Scan this room with photos first");
  return { status: "generating" };
}

export async function refreshRoomPreview(roomId: string): Promise<RoomPreview> {
  if (!db) throw new Error("Supabase is not configured");
  const { data: room } = await db.from("rooms").select("preview_status, preview_operation_id").eq("id", roomId).eq("household_id", await currentHouseholdId()).maybeSingle();
  if (!room?.preview_operation_id || room.preview_status !== "generating") return { status: room?.preview_status ?? "none" };

  const result = await checkWorld(room.preview_operation_id);
  if (result.status === "generating") return result;
  if (result.status === "failed") {
    await db.from("rooms").update({ preview_status: "failed" }).eq("id", roomId);
    return { status: "failed" };
  }
  await db.from("rooms").update({
    preview_status: "ready",
    preview_world_url: result.worldUrl ?? null,
    preview_splat_url: result.splatUrl ?? null,
    preview_thumbnail_url: result.thumbnailUrl ?? null,
    preview_pano_url: result.panoUrl ?? null,
  }).eq("id", roomId);
  revalidatePath("/dashboard/rooms", "layout");
  return { ...result, status: "ready" };
}
