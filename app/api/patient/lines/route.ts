import { isVoiceSlot, MAX_LINE_CHARS } from "@/lib/dashboard/redirect-media";
import { pushLinesToMonitor, readLines, writeLines } from "@/lib/dashboard/voice-lines";
import { currentHouseholdId, isReadOnly, READ_ONLY_MESSAGE } from "@/lib/households";

// The words the TV says during a redirect, typed by the caregiver in Settings.
// PUT { slot, line }   -> saves that slot's line; an empty line goes back to the default
// For the home being viewed; the demo home is read-only on the public deploy.

export async function PUT(request: Request) {
  const hid = await currentHouseholdId();
  if (isReadOnly(hid)) return Response.json({ error: READ_ONLY_MESSAGE }, { status: 403 });
  const body = (await request.json().catch(() => null)) as { slot?: unknown; line?: unknown } | null;
  const slot = body?.slot, typed = body?.line;
  if (!isVoiceSlot(slot)) return Response.json({ error: "Unknown voice slot." }, { status: 400 });
  if (typeof typed !== "string") return Response.json({ error: "Type what the TV should say." }, { status: 400 });
  const line = typed.trim();
  if (line.length > MAX_LINE_CHARS) return Response.json({ error: `Keep it under ${MAX_LINE_CHARS} characters, one or two short sentences.` }, { status: 400 });

  const lines = await readLines(hid);
  if (line) lines[slot] = line;
  else delete lines[slot];
  const error = await writeLines(hid, lines);
  if (error) return Response.json({ error }, { status: 500 });

  return Response.json({ ok: true, monitor: await pushLinesToMonitor(hid, lines) });
}
