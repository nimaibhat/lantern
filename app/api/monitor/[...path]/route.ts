// Read-only pass-through to the monitor for pages opened over HTTPS, which cannot fetch http:// from the browser.
// Only what the dashboard reads; anything else is a 404.

export const dynamic = "force-dynamic";

const MONITOR = process.env.MONITOR_URL || `http://localhost:${process.env.MONITOR_PORT || 8787}`;
const ALLOWED = new Set(["health", "dwell", "world/rooms", "alerts", "analytics/summary", "debug/inference"]);

export async function GET(_request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const path = (await params).path.join("/");
  if (!ALLOWED.has(path)) return Response.json({ error: "not found" }, { status: 404 });
  try {
    const res = await fetch(`${MONITOR}/${path}`, { cache: "no-store", signal: AbortSignal.timeout(3000) });
    return new Response(await res.text(), { status: res.status, headers: { "Content-Type": "application/json" } });
  } catch {
    return Response.json({ error: "monitor unreachable" }, { status: 502 });
  }
}
