// Proxy for browser-based Web Bluetooth listeners.
// The dashboard page POSTs RSSI readings here (same HTTPS origin),
// and this route forwards them to the monitor over internal HTTP.

const MONITOR = process.env.MONITOR_URL || `http://localhost:${process.env.MONITOR_PORT || 8787}`;
const TOKEN = process.env.LISTENER_TOKEN || "change-me";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body) return Response.json({ error: "bad body" }, { status: 400 });
  try {
    const res = await fetch(`${MONITOR}/listener/report?token=${TOKEN}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({ ok: false }));
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "monitor unreachable" }, { status: 502 });
  }
}
