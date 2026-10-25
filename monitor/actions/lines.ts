// The redirect words the caregiver typed in Settings. The web app pushes them here on every save
// (POST /voice-lines), and the monitor reads lines.json from Storage once at start so a restart keeps them.

import { createClient } from "@supabase/supabase-js";
import { linesPath, parseLines, type VoiceLines, type VoiceSlot } from "@/lib/dashboard/redirect-media";

export function createLines() {
  let lines: VoiceLines = {};
  let pushed = false;
  return {
    get: (slot: VoiceSlot): string | undefined => lines[slot],
    // A save from Settings.
    set(raw: unknown): VoiceLines {
      pushed = true;
      lines = parseLines(raw);
      return lines;
    },
    // The startup read. Ignored if a save already arrived, since that one is newer.
    load(saved: VoiceLines) {
      if (!pushed) lines = saved;
    },
  };
}

export async function loadLines(householdId: string): Promise<VoiceLines | undefined> {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;
  const db = createClient(url, key, { auth: { persistSession: false } });
  const { data } = await db.storage.from("voice").download(linesPath(householdId));
  if (!data) return; // nothing typed yet
  return parseLines(JSON.parse(await data.text()));
}
