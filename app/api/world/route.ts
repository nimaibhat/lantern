import { HOUSEHOLD_ID } from "@/lib/supabase/server";
import type { HomeModel } from "@/lib/types";
import { pointInPolygon } from "@/lib/world/geometry";
import { getHomeModel, saveHomeModel } from "@/lib/world/store";

// GET  /api/world          -> { model, saved }   newest home model (or the demo fixture)
// POST /api/world {model}  -> { version }        save the zone editor's model as the next version
// No login yet, so this only ever touches the demo household.

export async function GET() {
  return Response.json(await getHomeModel());
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const model = body?.model as HomeModel | undefined;
  const problem = check(model);
  if (problem) return Response.json({ error: problem }, { status: 400 });
  try {
    const saved = await saveHomeModel({ ...model!, householdId: HOUSEHOLD_ID }, { note: String(body.note ?? "zone editor").slice(0, 80) });
    return Response.json({ version: saved.version });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}

function check(m: HomeModel | undefined): string | undefined {
  if (!m || m.unit !== "in" || !Array.isArray(m.rooms) || !Array.isArray(m.doors) || !Array.isArray(m.anchors)) return "Send a HomeModel";
  const ids = new Set<string>();
  for (const r of m.rooms) {
    if (!/^[a-z0-9-]+$/.test(r.id)) return `Room id "${r.id}" must be a slug like tv-room`;
    if (ids.has(r.id)) return `Room id "${r.id}" is used twice`;
    ids.add(r.id);
    if (!Array.isArray(r.polygon) || r.polygon.length < 3) return `${r.name} needs at least 3 corners`;
    if (!pointInPolygon(r.centroid, r.polygon)) return `${r.name}'s center point is outside its outline`;
  }
  for (const d of m.doors) if (!ids.has(d.roomA) || (!ids.has(d.roomB) && d.roomB !== "outside")) return `Door ${d.id} points at a missing room`;
  const receivers = new Set<string>();
  for (const a of m.anchors) {
    if (!/^[a-z0-9-]+$/.test(a.receiverId)) return `Listener id "${a.receiverId}" must be a slug`;
    if (receivers.has(a.receiverId)) return `Listener "${a.receiverId}" is placed twice`;
    receivers.add(a.receiverId);
  }
}
