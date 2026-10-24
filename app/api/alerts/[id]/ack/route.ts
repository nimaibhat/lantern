// GET /api/alerts/<id>/ack: the link in the caregiver's SMS. Tells the monitor to stop escalating, then shows a
// plain page on the phone. Idempotent: tapping it twice is fine.

const MONITOR = process.env.NEXT_PUBLIC_MONITOR_URL || "http://localhost:8787";

const page = (title: string, body: string, status = 200) =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Lantern</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#ebe6de;color:#3b342d;font:18px/1.5 system-ui,sans-serif}
main{max-width:28rem;padding:2rem;text-align:center}h1{font-weight:500;margin:0 0 .5rem}p{color:#7a7067;margin:0}</style></head>
<body><main><h1>${title}</h1><p>${body}</p></main></body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
  );

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[\w-]{1,80}$/.test(id)) return page("That link is not valid", "Open the latest message from Lantern and try again.", 400);
  try {
    const res = await fetch(`${MONITOR}/ack/${encodeURIComponent(id)}`, { method: "POST", cache: "no-store", signal: AbortSignal.timeout(5000) });
    if (res.ok) return page("Thank you", "Lantern has stopped the alerts for this event. No one else will be called.");
    if (res.status === 404) return page("Already handled", "This alert was already acknowledged or has ended.");
    return page("Could not reach Lantern", "Please check on them directly. Lantern will keep trying the next contact.", 502);
  } catch {
    return page("Could not reach Lantern", "Please check on them directly. Lantern will keep trying the next contact.", 502);
  }
}
