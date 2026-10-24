import { after } from "next/server";
import { auditHome, type AuditDraft } from "@/lib/audit/ada";
import { mobilityItems } from "@/lib/audit/mobility";
import { findHazards } from "@/lib/audit/vision";
import { householdForCode } from "@/lib/scan/pairing";
import { db } from "@/lib/supabase/server";
import { buildHomeModel, normalize, slug } from "@/lib/world/build";
import { parseCapturedRoom } from "@/lib/world/parse";
import { roomsFromStructure, structurePath } from "@/lib/world/structure";
import { getHomeModel, hazardsFrom, saveHomeModel, syncHazards } from "@/lib/world/store";

// Step 2 of an upload, called once the phone has PUT every file:
//   1. parse the rooms into one shared floor frame: the merged StructureBuilder file when the phone sent one,
//      otherwise each room's own file (they share a frame because they came from one AR session)
//   2. build the HomeModel (slug room ids, doors matched to rooms, listener anchors carried over) and save it
//   3. run the accessibility rules and the walker and wheelchair route checks right away
//   4. run the Claude photo check after responding, since it takes a few seconds per room
//
// POST { code } -> { rooms, accessibilityItems, version }

type ManifestRoom = { name: string; jsonPath: string; usdzPath: string; photoPaths: string[] };

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: scanId } = await params;
  const { code } = await request.json().catch(() => ({}));
  const household = await householdForCode(code);
  if (!household || !db) return Response.json({ error: "Pair the phone again." }, { status: 401 });
  const supabase = db;
  const hid = household.id;

  const { data: scan } = await supabase.from("scans").select("manifest").eq("id", scanId).eq("household_id", hid).maybeSingle();
  if (!scan) return Response.json({ error: "Scan not found." }, { status: 404 });
  const manifest = scan.manifest as ManifestRoom[];
  await supabase.from("scans").update({ status: "processing" }).eq("id", scanId);

  try {
    // 1. Parse, all rooms in one frame
    const perRoom = await Promise.all(
      manifest.map(async (m) => {
        const { data, error } = await supabase.storage.from("scans").download(m.jsonPath);
        if (error || !data) throw new Error(`Missing ${m.name} scan file. Upload it again.`);
        return JSON.parse(await data.text());
      }),
    );
    const { data: structureFile } = await supabase.storage.from("scans").download(structurePath(hid, scanId));
    const merged = structureFile ? roomsFromStructure(JSON.parse(await structureFile.text()), perRoom) : undefined;
    const parsed = normalize((merged ?? perRoom).map((json, i) => parseCapturedRoom(json, manifest[i].name)));

    // 2. Room ids are slugs of the names. The rooms table is shared, so a slug another household owns gets a prefix.
    const wanted = uniqueSlugs(manifest.map((m) => m.name));
    const { data: taken } = await supabase.from("rooms").select("id, household_id").in("id", wanted);
    const foreign = new Set((taken ?? []).filter((r) => r.household_id !== hid).map((r) => r.id as string));
    const ids = wanted.map((id) => (foreign.has(id) ? `${slug(hid)}-${id}` : id));

    const { model: prev, saved } = await getHomeModel(hid);
    const home = buildHomeModel(parsed, { householdId: hid, prev: saved ? prev : undefined, ids, photoPaths: manifest.map((m) => m.photoPaths), hazards: [] });

    // The rooms table keeps per-room geometry and photos for the room pages and the audit foreign keys.
    const { error: roomError } = await supabase.from("rooms").upsert(
      home.rooms.map((r, i) => ({
        id: r.id,
        household_id: hid,
        scan_id: scanId,
        name: r.name,
        outline: r.polygon,
        doors: parsed[i].openings,
        windows: parsed[i].windows,
        objects: r.objects ?? [],
        photo_paths: r.photoPaths ?? [],
      })),
    );
    if (roomError) throw new Error(roomError.message);

    // 3. Rules replace the previous rule results for these rooms
    const roomIds = home.rooms.map((r) => r.id);
    const ruleItems: AuditDraft[] = [...auditHome(home), ...mobilityItems(home, "walker"), ...mobilityItems(home, "wheelchair")];
    await supabase.from("audit_items").delete().in("room_id", roomIds).eq("source", "ada-rule");
    if (ruleItems.length) {
      const { error } = await supabase.from("audit_items").insert(ruleItems.map((item) => toRow(item, hid)));
      if (error) throw new Error(error.message);
    }
    const savedModel = await saveHomeModel({ ...home, hazards: hazardsFrom(ruleItems) }, { scanId, note: "scan" });

    // 4. Photo hazards, in the background
    after(async () => {
      try {
        const results = await Promise.all(
          home.rooms.map(async (room) => {
            const photos = await Promise.all(
              (room.photoPaths ?? []).map(async (path) => {
                const { data } = await supabase.storage.from("photos").download(path);
                return data ? { path, jpeg: Buffer.from(await data.arrayBuffer()) } : null;
              }),
            );
            return findHazards({ id: room.id, name: room.name, center: room.centroid }, photos.filter((p) => p !== null));
          }),
        );
        await supabase.from("audit_items").delete().in("room_id", roomIds).eq("source", "vision");
        const visionItems = results.flat();
        if (visionItems.length) await supabase.from("audit_items").insert(visionItems.map((item) => toRow(item, hid)));
        await syncHazards(hid);
        await supabase.from("scans").update({ status: "done" }).eq("id", scanId);
      } catch (e) {
        console.error("Photo check failed:", (e as Error).message);
        await supabase.from("scans").update({ status: "failed" }).eq("id", scanId);
      }
    });

    return Response.json({ rooms: home.rooms.length, accessibilityItems: ruleItems.length, version: savedModel.version });
  } catch (e) {
    await supabase.from("scans").update({ status: "failed" }).eq("id", scanId);
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}

function uniqueSlugs(names: string[]): string[] {
  const seen = new Set<string>();
  return names.map((name) => {
    let id = slug(name), n = 2;
    while (seen.has(id)) id = `${slug(name)}-${n++}`;
    seen.add(id);
    return id;
  });
}

function toRow(item: AuditDraft, householdId: string) {
  return {
    household_id: householdId,
    room_id: item.roomId,
    source: item.source,
    code: item.code ?? null,
    title: item.title,
    detail: item.detail,
    fix: item.fix,
    severity: item.severity,
    measured_in: item.measuredIn ?? null,
    required_in: item.requiredIn ?? null,
    photo_path: item.photoPath ?? null,
    location: item.location ?? null,
  };
}
