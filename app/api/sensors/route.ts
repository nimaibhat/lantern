// Every sensor the dashboard shows, and where each one stands. Tracking laptops live in Supabase; the monitor, which
// draws the dot from them, keeps where each stands. GET lists them (and hands new placements to the monitor); POST
// sets where one stands, by room or by its exact spot on the plan, in both places at once.

import { getReceivers } from "@/lib/dashboard/data";
import { currentHouseholdId, isReadOnly, READ_ONLY_MESSAGE } from "@/lib/households";
import { placeReceiver, syncPlacements } from "@/lib/sensing/monitor-sync";
import { db } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const ID = /^[\w.:-]{1,64}$/;

export async function GET() {
  const receivers = await getReceivers();
  void syncPlacements(receivers.map((r) => ({ id: r.id, label: r.label, room_id: r.roomId || null, online: r.online })));
  return Response.json({ receivers });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { receiverId?: unknown; roomId?: unknown; position?: { x?: unknown; y?: unknown } };
  const receiverId = typeof body.receiverId === "string" ? body.receiverId.trim() : "";
  if (!ID.test(receiverId)) return Response.json({ error: "Unknown device." }, { status: 400 });
  const roomId = typeof body.roomId === "string" && body.roomId ? body.roomId : undefined;
  const x = Number(body.position?.x), y = Number(body.position?.y);
  const position = body.position && Number.isFinite(x) && Number.isFinite(y) ? { x, y } : undefined;
  if (!roomId && !position) return Response.json({ error: "Pick a room or a spot on the plan." }, { status: 400 });
  const household = await currentHouseholdId();
  if (isReadOnly(household)) return Response.json({ error: READ_ONLY_MESSAGE }, { status: 403 });

  const placed = await placeReceiver(receiverId, { roomId, position });
  if (!placed.ok) return Response.json({ error: placed.error }, { status: 502 });

  // Saved with the device too, so Tracking and a restarted monitor agree. Devices that only ever reported to the
  // monitor (a listener script, the simulator) have no row, and that is fine.
  const room = placed.roomId ?? roomId;
  if (db && room) {
    const { error } = await db.from("receivers").update({ room_id: room }).eq("id", receiverId).eq("household_id", household);
    if (error) console.error("Could not save where a device stands:", error.message);
  }
  return Response.json({ ok: true, receiverId, position: placed.position, roomId: room });
}
