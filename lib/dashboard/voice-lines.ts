import "server-only";
import { linesPath, parseLines, type VoiceLines } from "@/lib/dashboard/redirect-media";
import { db } from "@/lib/supabase/server";

// The caregiver's typed lines live in the private voice bucket as lines.json.

export async function readLines(householdId: string): Promise<VoiceLines> {
  if (!db) return {};
  const { data } = await db.storage.from("voice").download(linesPath(householdId));
  if (!data) return {}; // nothing typed yet
  return parseLines(await data.text().then(JSON.parse).catch(() => null));
}

export async function writeLines(householdId: string, lines: VoiceLines): Promise<string | null> {
  if (!db) return "Supabase is not configured.";
  const body = new Blob([JSON.stringify(lines)], { type: "application/json" });
  const { error } = await db.storage.from("voice").upload(linesPath(householdId), body, { upsert: true, contentType: "application/json" });
  return error?.message ?? null;
}

// Tell a running monitor right away so the next redirect uses the new words. The monitor also reads
// lines.json when it starts, so a monitor that is down now still catches up.
export async function pushLinesToMonitor(householdId: string, lines: VoiceLines): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_MONITOR_URL || "http://localhost:8787";
  try {
    const res = await fetch(`${url}/voice-lines`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ householdId, lines }),
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
