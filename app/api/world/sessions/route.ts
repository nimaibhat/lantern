import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

// Recorded sessions for the replay page, read from fixtures/sessions/*.jsonl (Saran's recorder writes them).
// GET /api/world/sessions          -> { sessions: [{ id, bytes }] }
// GET /api/world/sessions?id=night -> the raw .jsonl text

const DIR = join(process.cwd(), "fixtures", "sessions");

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (id) {
    if (!/^[\w.-]+$/.test(id)) return Response.json({ error: "Bad session id" }, { status: 400 });
    try {
      return new Response(await readFile(join(DIR, `${id}.jsonl`), "utf8"), { headers: { "content-type": "application/x-ndjson" } });
    } catch {
      return Response.json({ error: "Session not found" }, { status: 404 });
    }
  }
  try {
    const files = (await readdir(DIR, { withFileTypes: true })).filter((f) => f.isFile() && f.name.endsWith(".jsonl"));
    return Response.json({ sessions: files.map((f) => ({ id: f.name.replace(/\.jsonl$/, "") })) });
  } catch {
    return Response.json({ sessions: [] }); // no recordings yet
  }
}
