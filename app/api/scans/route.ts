import { householdForCode } from "@/lib/scan/pairing";
import { structurePath } from "@/lib/world/structure";
import { db } from "@/lib/supabase/server";

// Step 1 of an upload from the phone: create the scan and hand back one signed upload URL per file.
// The phone PUTs each file straight to Supabase Storage, so large files never pass through this server.
//
// POST { code, rooms: [{ name, photos }] }
//   -> { scanId, rooms: [{ name, json, usdz, photos: [url] }], structure }   (each url accepts a PUT of the file body)
// structure is for the merged CapturedStructure from Apple's StructureBuilder; the phone uploads it when the merge works.

const MAX_ROOMS = 20;
const MAX_PHOTOS = 6;

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const household = await householdForCode(body.code);
  if (!household || !db) return Response.json({ error: "Pair the phone again." }, { status: 401 });

  const rooms: { name: string; photos: number }[] = Array.isArray(body.rooms) ? body.rooms : [];
  const valid = rooms.length > 0 && rooms.length <= MAX_ROOMS && rooms.every(
    (r) => typeof r.name === "string" && r.name.trim() && Number.isInteger(r.photos) && r.photos >= 0 && r.photos <= MAX_PHOTOS,
  );
  if (!valid) return Response.json({ error: "Send 1 to 20 named rooms with up to 6 photos each." }, { status: 400 });

  const scanId = crypto.randomUUID();
  const base = `${household.id}/${scanId}`;
  const manifest = rooms.map((r, i) => ({
    name: r.name.trim().slice(0, 60),
    jsonPath: `${base}/room-${i}.json`,
    usdzPath: `${base}/room-${i}.usdz`,
    photoPaths: Array.from({ length: r.photos }, (_, p) => `${base}/room-${i}-photo-${p}.jpg`),
  }));

  const { error } = await db.from("scans").insert({
    id: scanId,
    household_id: household.id,
    json_path: `${base}/`,
    manifest,
  });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const sign = async (bucket: string, path: string) => {
    const { data, error } = await db!.storage.from(bucket).createSignedUploadUrl(path);
    if (error) throw new Error(error.message);
    return data.signedUrl;
  };

  try {
    const signed = await Promise.all(
      manifest.map(async (room) => ({
        name: room.name,
        json: await sign("scans", room.jsonPath),
        usdz: await sign("scans", room.usdzPath),
        photos: await Promise.all(room.photoPaths.map((p) => sign("photos", p))),
      })),
    );
    return Response.json({ scanId, rooms: signed, structure: await sign("scans", structurePath(household.id, scanId)) });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
