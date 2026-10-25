// The hub's Tracking page posts the closest laptop here; this forwards it to the monitor, which uses it as the
// person's room with ROOM_FROM=closest (monitor/sensing/closest.ts). The token never reaches the browser.

const MONITOR = process.env.MONITOR_URL || `http://localhost:${process.env.MONITOR_PORT || 8787}`;
const TOKEN = process.env.LISTENER_TOKEN || "change-me";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { label?: unknown; roomId?: unknown; rssi?: unknown } | null;
  if (!body) return Response.json({ error: "bad body" }, { status: 400 });
  try {
    const res = await fetch(`${MONITOR}/closest?token=${encodeURIComponent(TOKEN)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: body.label, roomId: body.roomId, rssi: body.rssi }),
      signal: AbortSignal.timeout(2000),
    });
    const data = await res.json().catch(() => ({ ok: false }));
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "monitor unreachable" }, { status: 502 });
  }
}
