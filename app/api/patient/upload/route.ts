import { getHousehold } from "@/lib/dashboard/data";
import {
  isVoiceSlot,
  MAX_PHOTO_BYTES,
  MAX_VOICE_BYTES,
  redirectPhotoPath,
  VOICE_SLOTS,
  voicePath,
} from "@/lib/dashboard/redirect-media";
import { currentHouseholdId, isReadOnly, READ_ONLY_MESSAGE } from "@/lib/households";
import { db } from "@/lib/supabase/server";

// The caregiver's familiar voice lines and the redirect photo for the TV screen.
// GET                                   -> { patientName, slots: [{ slot, label, when, line, url }], photo: url | null }
// POST  form: kind=voice, slot, file    -> stores the recording in that slot
// POST  form: kind=photo, file          -> stores the redirect photo
// DELETE ?kind=voice&slot=... | ?kind=photo
// For the home being viewed; the demo home is read-only on the public deploy.

const PREVIEW_SECONDS = 300;

async function signed(bucket: string, path: string): Promise<string | null> {
  const { data } = await db!.storage.from(bucket).createSignedUrl(path, PREVIEW_SECONDS);
  return data?.signedUrl ?? null;
}

export async function GET() {
  if (!db) return Response.json({ error: "Supabase is not configured." }, { status: 503 });
  const [{ patientName }, hid] = await Promise.all([getHousehold(), currentHouseholdId()]);
  const slots = await Promise.all(
    VOICE_SLOTS.map(async (v) => ({ slot: v.slot, label: v.label, when: v.when, line: v.line(patientName), url: await signed("voice", voicePath(hid, v.slot)) })),
  );
  return Response.json({ patientName, slots, photo: await signed("photos", redirectPhotoPath(hid)) });
}

export async function POST(request: Request) {
  if (!db) return Response.json({ error: "Supabase is not configured." }, { status: 503 });
  const hid = await currentHouseholdId();
  if (isReadOnly(hid)) return Response.json({ error: READ_ONLY_MESSAGE }, { status: 403 });
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const kind = form?.get("kind");
  if (!(file instanceof File) || file.size === 0) return Response.json({ error: "Choose a file or record one." }, { status: 400 });

  if (kind === "voice") {
    const slot = form?.get("slot");
    if (!isVoiceSlot(slot)) return Response.json({ error: "Unknown voice slot." }, { status: 400 });
    if (!file.type.startsWith("audio/")) return Response.json({ error: "That is not an audio file." }, { status: 400 });
    if (file.size > MAX_VOICE_BYTES) return Response.json({ error: "Keep recordings under 3 MB (about 30 seconds)." }, { status: 400 });
    const { error } = await db.storage.from("voice").upload(voicePath(hid, slot), file, { upsert: true, contentType: file.type });
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ ok: true, url: await signed("voice", voicePath(hid, slot)) });
  }

  if (kind === "photo") {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return Response.json({ error: "Use a JPEG, PNG or WebP photo." }, { status: 400 });
    if (file.size > MAX_PHOTO_BYTES) return Response.json({ error: "Keep photos under 8 MB." }, { status: 400 });
    const { error } = await db.storage.from("photos").upload(redirectPhotoPath(hid), file, { upsert: true, contentType: file.type });
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ ok: true, url: await signed("photos", redirectPhotoPath(hid)) });
  }

  return Response.json({ error: "kind must be voice or photo." }, { status: 400 });
}

export async function DELETE(request: Request) {
  if (!db) return Response.json({ error: "Supabase is not configured." }, { status: 503 });
  const hid = await currentHouseholdId();
  if (isReadOnly(hid)) return Response.json({ error: READ_ONLY_MESSAGE }, { status: 403 });
  const params = new URL(request.url).searchParams;
  const kind = params.get("kind"), slot = params.get("slot");
  if (kind === "voice" && isVoiceSlot(slot)) await db.storage.from("voice").remove([voicePath(hid, slot)]);
  else if (kind === "photo") await db.storage.from("photos").remove([redirectPhotoPath(hid)]);
  else return Response.json({ error: "Say which file to remove." }, { status: 400 });
  return Response.json({ ok: true });
}
