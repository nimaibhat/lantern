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

// All of a room's photos in parallel; the same hazard seen in two photos is reported once (the first photo wins).
export async function hazardsForRoom(
  room: { id: string; name: string; center?: Vec2 },
  photos: { path: string; jpeg: Buffer }[],
  ask: AskOne,
  cache: VisionCache,
  log?: (...a: unknown[]) => void,
): Promise<Item[]> {
  const perPhoto = await Promise.all(photos.map((p) => hazardsForPhoto(p.jpeg, room.name, ask, cache, log)));
  const seen = new Set<string>();
  const items: Item[] = [];
  perPhoto.forEach((hazards, i) => {
    for (const h of hazards) {
      const k = h.title.trim().toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      items.push({ roomId: room.id, source: "vision", ...h, photoPath: photos[i].path, location: room.center });
    }
  });
  return items;
}
