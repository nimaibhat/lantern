import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaJSONSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/beta/json-schema";
import { db } from "@/lib/supabase/server";
import type { Vec2 } from "@/lib/types";
import { hazardsForRoom, memoryCache, PROMPT_VERSION, type AskOne, type Hazard, type Item, type VisionCache } from "./vision-core";

// Claude looks at each room photo and lists hazards for a person living with dementia.
// Structured output guarantees the JSON shape. Each photo is checked once: results are cached by the image bytes
// (in memory, and in the vision_cache table when Supabase is configured), so re-processing a scan costs no API calls.

const SYSTEM = `You are an occupational therapist doing a home safety visit for an older adult living with dementia.
Look only at what is visible in the photo. Report concrete hazards a caregiver can fix, most serious first.

Look for:
- Trip and fall risks: loose rugs, cords, clutter on walking paths, thresholds, poor lighting, no handrails
- Wandering cues: keys, coats, shoes, or bags near an exit; exterior doors with simple locks
- Confusion: mirrors that may startle, dark mats or patterned floors that read as holes, low contrast between floor and walls
- Bathroom: missing grab bars, slippery surfaces, a toilet the same color as the floor
- Kitchen: reachable stove knobs, sharp objects, cleaning products or medication within reach

Write each fix as one practical sentence. Skip anything you cannot actually see. If the room looks safe, return no hazards.`;

const SCHEMA = {
  type: "object",
  properties: {
    hazards: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short, plain-language name of the hazard" },
          detail: { type: "string", description: "Why it matters for this person, one sentence" },
          fix: { type: "string", description: "What the caregiver should do, one sentence" },
          severity: { type: "string", enum: ["high", "medium", "low"] },
        },
        required: ["title", "detail", "fix", "severity"],
        additionalProperties: false,
      },
    },
  },
  required: ["hazards"],
  additionalProperties: false,
} as const;

let client: Anthropic | undefined; // created on first use so a missing key only matters when a photo is checked

const askClaude: AskOne = async (image, roomName) => {
  client ??= new Anthropic(); // reads ANTHROPIC_API_KEY
  const response = await client.beta.messages.parse({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    // If a safety classifier declines, the API retries on a fallback model inside the same call.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: betaJSONSchemaOutputFormat(SCHEMA) },
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: image.mediaType, data: image.data } },
          { type: "text", text: `This photo shows the ${roomName}.` },
        ],
      },
    ],
  });
  if (response.stop_reason === "refusal" || !response.parsed_output) return undefined;
  return response.parsed_output.hazards as Hazard[];
};

// Memory first, then the vision_cache table (0008_ml.sql). Cache trouble never blocks the check.
const memory = memoryCache();
const cache: VisionCache = {
  async get(key) {
    const hit = await memory.get(key);
    if (hit || !db) return hit;
    const { data } = await db.from("vision_cache").select("hazards").eq("key", key).maybeSingle();
    if (data) await memory.set(key, data.hazards as Hazard[]);
    return data?.hazards as Hazard[] | undefined;
  },
  async set(key, hazards) {
    await memory.set(key, hazards);
    if (db) await db.from("vision_cache").upsert({ key, hazards, prompt_version: PROMPT_VERSION });
  },
};

export function findHazards(room: { id: string; name: string; center?: Vec2 }, photos: { path: string; jpeg: Buffer }[]): Promise<Item[]> {
  if (photos.length === 0 || !process.env.ANTHROPIC_API_KEY) return Promise.resolve([]);
  return hazardsForRoom(room, photos, askClaude, cache);
}
