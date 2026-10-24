import { after } from "next/server";
import { auditRow, replaceRuleItems } from "@/lib/audit/store";
import { findHazards } from "@/lib/audit/vision";
import { householdForCode } from "@/lib/scan/pairing";
import { db } from "@/lib/supabase/server";
import type { Opening, Vec2 } from "@/lib/types";
import { buildHomeModel, normalize, slug } from "@/lib/world/build";
import { parseCapturedRoom } from "@/lib/world/parse";
import { roomsFromStructure, structurePath } from "@/lib/world/structure";
import { doorAxis } from "@/lib/world/walls";
import { getHomeModel, hazardsFrom, saveHomeModel, syncHazards } from "@/lib/world/store";

// Step 2 of an upload, called once the phone has PUT every file:
//   1. parse the rooms into one shared floor frame: the merged StructureBuilder file when the phone sent one,
//      otherwise each room's own file (they share a frame because they came from one AR session)
//   2. build the HomeModel (slug room ids, doors matched to rooms, listener anchors carried over) and save it
//   3. run the accessibility rules for how the person gets around, right away
//   4. run the Claude photo check after responding, since it takes a few seconds per room
//   5. (off for now) for the demo home, start a World Labs 3D preview per room (each one is a paid call)
//
// POST { code } -> { rooms, accessibilityItems, version }

type ManifestRoom = { name: string; jsonPath: string; usdzPath: string; photoPaths: string[] };
// Fixes for one scan, set by hand (0010_scan_layout.sql): turn the plan to match the paper floor plan, and leave out
// rooms that were scanned badly, draw rooms the scan missed (closets), correct outlines, and join open-plan rooms.
// Room names are fixed in the manifest itself.
type ScanLayout = {
  turnDeg?: 0 | 90 | 180 | 270;
  skip?: number[];
  drawn?: { name: string; polygon: Vec2[] }[];
  outlines?: Record<string, Vec2[]>; // by room name, in plan inches
  open?: [string, string][]; // by room name: no wall between them
};

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: scanId } = await params;
  const { code } = await request.json().catch(() => ({}));
  const household = await householdForCode(code);
  if (!household || !db) return Response.json({ error: "Pair the phone again." }, { status: 401 });
  const supabase = db;
  const hid = household.id;

  const { data: scan } = await supabase.from("scans").select("manifest, layout").eq("id", scanId).eq("household_id", hid).maybeSingle();
  if (!scan) return Response.json({ error: "Scan not found." }, { status: 404 });
  const uploaded = scan.manifest as ManifestRoom[];
  const layout = (scan.layout ?? {}) as ScanLayout;
  const keep = uploaded.map((_, i) => !layout.skip?.includes(i));
  const manifest = uploaded.filter((_, i) => keep[i]);
  await supabase.from("scans").update({ status: "processing" }).eq("id", scanId);

  try {
    // 1. Parse, all rooms in one frame
    const perRoom = await Promise.all(
      uploaded.map(async (m) => {
        const { data, error } = await supabase.storage.from("scans").download(m.jsonPath);
        if (error || !data) throw new Error(`Missing ${m.name} scan file. Upload it again.`);
        return JSON.parse(await data.text());
      }),
    );
    const { data: structureFile } = await supabase.storage.from("scans").download(structurePath(hid, scanId));
    const merged = structureFile ? roomsFromStructure(JSON.parse(await structureFile.text()), perRoom) : undefined;
    // Parse every uploaded room (the merged file lines up with all of them), then drop the skipped ones.
    const all = (merged ?? perRoom).map((json, i) => parseCapturedRoom(json, uploaded[i].name));
    const parsed = normalize(all.filter((_, i) => keep[i]), layout.turnDeg ?? 0);

    // 2. Room ids are slugs of the names. The rooms table is shared, so a slug another household owns gets a prefix.
    const wanted = uniqueSlugs(manifest.map((m) => m.name));
    const { data: taken } = await supabase.from("rooms").select("id, household_id").in("id", wanted);
    const foreign = new Set((taken ?? []).filter((r) => r.household_id !== hid).map((r) => r.id as string));
    const ids = wanted.map((id) => (foreign.has(id) ? `${slug(hid)}-${id}` : id));

    const { model: prev, saved } = await getHomeModel(hid);
    const home = buildHomeModel(parsed, { householdId: hid, prev: saved ? prev : undefined, ids, photoPaths: manifest.map((m) => m.photoPaths), hazards: [], drawn: layout.drawn, outlines: layout.outlines, open: layout.open });

    // The dashboard plan draws each room's doors as gaps, so an open-plan joint goes into both rooms' door lists.
    const joints = home.doors.filter((d) => d.id.endsWith("|open")).map((d) => {
      const ax = doorAxis(home, d), h = d.widthIn / 2;
      const seg: Opening = { id: d.id, heightIn: 80, start: { x: d.center.x - ax.x * h, y: d.center.y - ax.y * h }, end: { x: d.center.x + ax.x * h, y: d.center.y + ax.y * h }, widthIn: d.widthIn, kind: "opening" };
      return { rooms: [d.roomA, d.roomB], seg };
    });
    const jointsFor = (roomId: string) => joints.filter((j) => j.rooms.includes(roomId)).map((j) => j.seg);

    // The rooms table keeps per-room geometry and photos for the room pages and the audit foreign keys.
    const { error: roomError } = await supabase.from("rooms").upsert(
      home.rooms.map((r, i) => ({
        id: r.id,
        household_id: hid,
        scan_id: scanId,
        name: r.name,
        outline: r.polygon,
        doors: [...(parsed[i]?.openings ?? []), ...jointsFor(r.id)], // hand-drawn rooms have no scan of their own
        windows: parsed[i]?.windows ?? [],
        objects: r.objects ?? [],
        photo_paths: r.photoPaths ?? [],
      })),
    );
    if (roomError) throw new Error(roomError.message);

    // 3. Rules replace the previous rule results for these rooms
    const roomIds = home.rooms.map((r) => r.id);
    // Checked for how this person gets around (Settings); the 3D view can still show either route.
    const { data: who } = await supabase.from("households").select("mobility").eq("id", hid).maybeSingle();
    const ruleItems = await replaceRuleItems(hid, home, who?.mobility ?? "none");
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
        if (visionItems.length) await supabase.from("audit_items").insert(visionItems.map((item) => auditRow(item, hid)));
        await syncHazards(hid);
        await supabase.from("scans").update({ status: "done" }).eq("id", scanId);
      } catch (e) {
        console.error("Photo check failed:", (e as Error).message);
        await supabase.from("scans").update({ status: "failed" }).eq("id", scanId);
      }
    });

    // 5. One World Labs world per room. A world is one continuous space built around a viewpoint from up to four
    //    photos, so a whole-home world would blend the rooms together; the floor plan is the whole-home view.
    //    All photos are uploaded before this route is called, so the jobs can start now.
    //    Off for now to save World Labs credits; start previews by hand from each room page until this is turned back on.
    // if (hid === HOUSEHOLD_ID && worldLabsConfigured)
    //   after(async () => {
    //     const started = await Promise.allSettled(home.rooms.map((r) => startRoomPreview(r.id, hid)));
    //     const failed = started.filter((s) => s.status === "rejected");
    //     if (failed.length) console.error(`World Labs: ${failed.length} of ${started.length} previews did not start:`, (failed[0] as PromiseRejectedResult).reason?.message);
    //   });

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
