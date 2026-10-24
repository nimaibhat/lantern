import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaJSONSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/beta/json-schema";
import { db } from "@/lib/supabase/server";
import type { Vec2 } from "@/lib/types";
import { hazardsForRoom, MAX_PER_ROOM, memoryCache, PROMPT_VERSION, type AskOne, type Found, type Hazard, type Item, type MergeRoom, type VisionCache } from "./vision-core";

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

// Each photo is checked on its own, so one room can come back with dozens of overlapping findings. This pass
// reads them as text and keeps the few an occupational therapist would actually put on the list.
const MERGE_SYSTEM = `You are an occupational therapist writing the fix list for one room of a home where an older adult with dementia lives.
You get every finding from several photos of the same room. Many repeat the same problem in different words.

- Merge findings that describe the same thing into one.
- Keep only things in this room. Photos often look through a doorway into the next room; drop findings about what is over there.
- Keep at most ${MAX_PER_ROOM}, the ones most likely to cause a fall, an injury, a wandering exit, or real confusion. Fewer is better.
- Drop ordinary household items used in the ordinary way (a microwave on the counter, dish soap by the sink, a mirror over a vanity, a desk chair) unless a finding shows a specific danger.
- Severity: high only for something likely to cause serious harm soon, such as no grab bars by the tub, razors or medication out, a stove anyone can turn on, or cords across the main walking path. At most two highs per room. Clutter, glare, and low contrast are medium or low.
- For each item, set photo to the photo number of the finding that shows it best. Write the title, detail, and fix in plain words, one sentence each.`;

const MERGE_SCHEMA = {
  type: "object",
  properties: {
    hazards: {
      type: "array",
      items: {
        type: "object",
        properties: { ...SCHEMA.properties.hazards.items.properties, photo: { type: "integer", description: "Photo number of the best example" } },
        required: ["title", "detail", "fix", "severity", "photo"],
        additionalProperties: false,
      },
    },
  },
  required: ["hazards"],
  additionalProperties: false,
} as const;

const mergeWithClaude: MergeRoom = async (roomName, found) => {
  client ??= new Anthropic();
  const list = found.map((h) => `- photo ${h.photo} [${h.severity}] ${h.title}: ${h.detail} Fix: ${h.fix}`).join("\n");
  const response = await client.beta.messages.parse({
    model: "claude-opus-5-5",
    max_tokens: 8000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: betaJSONSchemaOutputFormat(MERGE_SCHEMA) },
    system: MERGE_SYSTEM,
    messages: [{ role: "user", content: `Room: ${roomName}\n\nFindings:\n${list}` }],
  });
  if (response.stop_reason === "refusal" || !response.parsed_output) return undefined;
  return response.parsed_output.hazards as Found[];
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
  return hazardsForRoom(room, photos, askClaude, cache, console.warn, mergeWithClaude);
}
