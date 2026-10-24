// Acknowledgements over ntfy, so no tunnel is needed: the Acknowledge button on a push publishes "ack <alertId>" to a
// private ack topic (NTFY_ACK_TOPIC), and the monitor keeps one outgoing stream open to that topic. Nothing has to
// reach into the home. Topics are never logged.

type Log = (tag: string, ...args: unknown[]) => void;

const ACK = /^ack ([\w-]{1,80})$/;
export const ackBody = (alertId: string) => `ack ${alertId}`;

// One line of ntfy's JSON stream: its message id (to resume after a drop) and the alert id if it is an ack.
export function readLine(line: string): { id?: string; alertId?: string } {
  try {
    const m = JSON.parse(line) as { id?: unknown; event?: unknown; message?: unknown };
    if (m.event !== "message" || typeof m.id !== "string") return {};
    return { id: m.id, alertId: typeof m.message === "string" ? ACK.exec(m.message.trim())?.[1] : undefined };
  } catch {
    return {};
  }
}

export function listenForAcks(opts: { server: string; topic: string; token?: string; onAck(alertId: string): void; log: Log }): () => void {
  const stop = new AbortController();
  const hide = (s: string) => s.split(opts.topic).join("[topic]");
  let since = ""; // last message seen, so a reconnect also picks up a tap made while the stream was down
  let delay = 1000;

  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms).unref());

  (async () => {
    while (!stop.signal.aborted) {
      try {
        const res = await fetch(`${opts.server}/${opts.topic}/json${since ? `?since=${since}` : ""}`, {
          headers: opts.token ? { Authorization: `Bearer ${opts.token}` } : {},
          signal: stop.signal,
        });
        if (!res.ok || !res.body) throw new Error(`ntfy ${res.status}`);
        opts.log("ntfy", "listening for acknowledgements");
        delay = 1000;
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += value;
          for (let nl = buf.indexOf("\n"); nl >= 0; nl = buf.indexOf("\n")) {
            const { id, alertId } = readLine(buf.slice(0, nl));
            buf = buf.slice(nl + 1);
            if (id) since = id;
            if (alertId) opts.onAck(alertId);
          }
        }
      } catch (e) {
        if (stop.signal.aborted) return;
        opts.log("ntfy", "acknowledgement stream dropped:", hide((e as Error).message));
      }
      if (stop.signal.aborted) return;
      await wait(delay);
      delay = Math.min(delay * 2, 30_000);
    }
  })();

  return () => stop.abort();
}
