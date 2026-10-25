// The monitor's live frames (/ws/live) as Server-Sent Events from this origin. A page opened over HTTPS (Bluetooth
// on the other laptops needs it) cannot open ws:// to the monitor, but it can read this. Reconnects to the monitor on
// its own; each reconnect starts with a fresh snapshot frame.

export const dynamic = "force-dynamic";

const LIVE = process.env.MONITOR_WS_INTERNAL || `ws://localhost:${process.env.MONITOR_PORT || 8787}/ws/live`;

export function GET(request: Request) {
  const enc = new TextEncoder();
  let ws: WebSocket | undefined;
  let ping: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream({
    start(controller) {
      const send = (text: string) => {
        try {
          controller.enqueue(enc.encode(text));
        } catch {
          // the page went away
        }
      };
      const open = () => {
        if (request.signal.aborted) return;
        ws = new WebSocket(LIVE);
        ws.onmessage = (e) => typeof e.data === "string" && send(`data: ${e.data}\n\n`);
        ws.onclose = () => setTimeout(open, 2000);
        ws.onerror = () => ws?.close();
      };
      open();
      ping = setInterval(() => send(": ping\n\n"), 15_000); // keeps proxies from closing a quiet stream
      request.signal.addEventListener("abort", () => {
        clearInterval(ping);
        if (ws) ws.onclose = null;
        ws?.close();
        try {
          controller.close();
        } catch {}
      });
    },
    cancel() {
      clearInterval(ping);
      if (ws) ws.onclose = null;
      ws?.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } });
}
