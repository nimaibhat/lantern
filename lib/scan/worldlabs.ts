import "server-only";

// World Labs Marble turns a room's photos into a 3D Gaussian splat world (about 5 minutes per room).
// Docs: https://docs.worldlabs.ai/api
// This is a visual preview for the caregiver; measurements always come from the RoomPlan scan.

const BASE = "https://api.worldlabs.ai/marble/v1";
const key = process.env.WORLD_LABS_API_KEY;

export const worldLabsConfigured = !!key;

type Operation = {
  operation_id: string;
  done: boolean;
  error?: { message?: string } | null;
  metadata?: { world_id?: string };
};

type World = {
  world_marble_url?: string;
  assets?: {
    splats?: { spz_urls?: Record<string, string> };
    imagery?: { pano_url?: string };
    thumbnail_url?: string;
  };
};

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  if (!key) throw new Error("WORLD_LABS_API_KEY is not set");
  const res = await fetch(`${BASE}/${path}`, {
    ...init,
    headers: { "WLT-Api-Key": key, "Content-Type": "application/json", ...init?.headers },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`World Labs ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// Photos must be URLs World Labs can download, so pass signed URLs.
// The photos are taken freely around the room, not at known headings, so they go in without directions and
// World Labs works out how they fit together (reconstruction mode, up to 8 photos).
const MAX_PHOTOS = 8;

export async function startWorld(roomName: string, photoUrls: string[]): Promise<string> {
  const text_prompt = `The ${roomName.toLowerCase()} of a real home. Keep the layout, furniture, and lighting as they appear in the photos.`;
  const photos = photoUrls.slice(0, MAX_PHOTOS);
  const world_prompt =
    photos.length === 1
      ? { type: "image", image_prompt: { source: "uri", uri: photos[0] }, text_prompt }
      : {
          type: "multi-image",
          multi_image_prompt: photos.map((uri) => ({ content: { source: "uri", uri } })),
          reconstruct_images: true,
          text_prompt,
        };

  const op = await call<Operation>("worlds:generate", {
    method: "POST",
    body: JSON.stringify({ display_name: `Lantern ${roomName}`, model: "marble-1.1", world_prompt }),
  });
  return op.operation_id;
}

export type WorldResult =
  | { status: "generating" }
  | { status: "failed"; error: string }
  | { status: "ready"; worldUrl?: string; splatUrl?: string; thumbnailUrl?: string; panoUrl?: string };

export async function checkWorld(operationId: string): Promise<WorldResult> {
  const op = await call<Operation>(`operations/${operationId}`);
  if (!op.done) return { status: "generating" };
  if (op.error || !op.metadata?.world_id) return { status: "failed", error: op.error?.message ?? "Generation failed" };

  // The finished operation can carry an incomplete snapshot, so read the world itself.
  const world = await call<World>(`worlds/${op.metadata.world_id}`);
  const spz = world.assets?.splats?.spz_urls ?? {};
  return {
    status: "ready",
    worldUrl: world.world_marble_url,
    splatUrl: spz["500k"] ?? spz["100k"] ?? spz["full_res"],
    thumbnailUrl: world.assets?.thumbnail_url,
    panoUrl: world.assets?.imagery?.pano_url,
  };
}
