// Photo hazard check, the parts that do not need the network: one photo at a time, cached by the image bytes.
// lib/audit/vision.ts wires in the Anthropic client and the Supabase cache.
//
// - A photo that is not a JPEG or PNG (or is empty) returns [] without an API call.
// - An API error or refusal returns [] for that photo and is not cached, so a later run can still succeed.
// - A photo already checked (same bytes, same prompt version) returns the cached hazards with no API call.

import { createHash } from "node:crypto";
import type { AuditItem, Vec2 } from "@/lib/types";

export type Item = Omit<AuditItem, "id" | "status">;
export type Hazard = { title: string; detail: string; fix: string; severity: "high" | "medium" | "low" };

// Bump when the prompt or schema changes so old answers are not reused.
export const PROMPT_VERSION = "v2";
export const MERGE_VERSION = "m2"; // the same for the room merge prompt

export interface VisionCache {
  get(key: string): Promise<Hazard[] | undefined>;
  set(key: string, hazards: Hazard[]): Promise<void>;
}

// Asks the model about one photo. Returns undefined on a refusal or empty answer (not cached).
export type AskOne = (image: { data: string; mediaType: "image/jpeg" | "image/png" }, roomName: string) => Promise<Hazard[] | undefined>;

export function imageType(bytes: Buffer): "image/jpeg" | "image/png" | undefined {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
}

export const cacheKey = (bytes: Buffer, roomName: string) =>
  createHash("sha256").update(PROMPT_VERSION).update("\0").update(roomName.toLowerCase()).update("\0").update(bytes).digest("hex");

export function memoryCache(): VisionCache {
  const m = new Map<string, Hazard[]>();
  return { get: async (k) => m.get(k), set: async (k, v) => void m.set(k, v) };
}

export async function hazardsForPhoto(bytes: Buffer, roomName: string, ask: AskOne, cache: VisionCache, log = console.warn): Promise<Hazard[]> {
  const mediaType = imageType(bytes);
  if (!mediaType) return [];
  const key = cacheKey(bytes, roomName);
  const hit = await cache.get(key).catch(() => undefined);
  if (hit) return hit;
  try {
    const found = await ask({ data: bytes.toString("base64"), mediaType }, roomName);
    if (!found) return [];
    await cache.set(key, found).catch(() => {});
    return found;
  } catch (e) {
    log("Photo check failed for one photo:", (e as Error).message);
    return [];
  }
}

// A room gets a short list, not every finding from every photo: a caregiver acts on a handful of fixes.
export const MAX_PER_ROOM = 5;

// A finding plus the index of the photo that shows it.
export type Found = Hazard & { photo: number };

// Merges one room's findings from all its photos into at most MAX_PER_ROOM real fixes (text only, no images).
// Returns undefined on a refusal or empty answer (not cached).
export type MergeRoom = (roomName: string, found: Found[]) => Promise<Found[] | undefined>;

const SEVERITY = ["high", "medium", "low"];

// Without the merge step: drop exact repeats, keep the most serious.
export function topFindings(found: Found[]): Found[] {
  const seen = new Set<string>();
  return found
    .filter((h) => {
      const k = h.title.trim().toLowerCase();
      return !seen.has(k) && !!seen.add(k);
    })
    .sort((a, b) => SEVERITY.indexOf(a.severity) - SEVERITY.indexOf(b.severity))
    .slice(0, MAX_PER_ROOM);
}

async function mergeFindings(roomName: string, found: Found[], merge: MergeRoom, cache: VisionCache, log: (...a: unknown[]) => void): Promise<Found[]> {
  if (found.length <= 1) return found;
  const key = createHash("sha256").update(PROMPT_VERSION).update("\0").update(MERGE_VERSION).update("\0").update(roomName.toLowerCase()).update(JSON.stringify(found)).digest("hex");
  const hit = (await cache.get(key).catch(() => undefined)) as Found[] | undefined;
  if (hit) return hit;
  try {
    const merged = (await merge(roomName, found))?.filter((h) => found.some((f) => f.photo === h.photo));
    if (!merged) return topFindings(found);
    const kept = merged.slice(0, MAX_PER_ROOM);
    await cache.set(key, kept).catch(() => {});
    return kept;
  } catch (e) {
    log("Merging photo findings failed:", (e as Error).message);
    return topFindings(found);
  }
}

// All of a room's photos in parallel, then one merged list for the room, each item tied to the photo that shows it.
export async function hazardsForRoom(
  room: { id: string; name: string; center?: Vec2 },
  photos: { path: string; jpeg: Buffer }[],
  ask: AskOne,
  cache: VisionCache,
  log: (...a: unknown[]) => void = console.warn,
  merge?: MergeRoom,
): Promise<Item[]> {
  const perPhoto = await Promise.all(photos.map((p) => hazardsForPhoto(p.jpeg, room.name, ask, cache, log)));
  const found = perPhoto.flatMap((hazards, photo) => hazards.map((h) => ({ ...h, photo })));
  const kept = merge ? await mergeFindings(room.name, found, merge, cache, log) : topFindings(found);
  return kept.map(({ photo, ...h }) => ({ roomId: room.id, source: "vision", ...h, photoPath: photos[photo]?.path ?? photos[0]?.path, location: room.center }));
}
