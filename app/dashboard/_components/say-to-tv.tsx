"use client";

import { useState } from "react";
import { NOTE_MAX } from "@/lib/cues/script";

const MONITOR = process.env.NEXT_PUBLIC_MONITOR_URL || "http://localhost:8787";

// Type a message for the patient's TV (POST /patient/say). It is shown big, after a soft chime, and read aloud
// starting with their name. The monitor refuses while a reminder is playing, so two voices never overlap.
export function SayToTv({ name }: { name: string }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string }>();

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setStatus(undefined);
    try {
      const res = await fetch(`${MONITOR}/patient/say`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(4000),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error || `the monitor said ${res.status}`);
      setStatus({ ok: true, text: "On the TV now, for one minute." });
      setText("");
    } catch (err) {
      const offline = err instanceof TypeError || (err as Error).name === "TimeoutError";
      setStatus({ ok: false, text: offline ? "The monitor is offline, so the TV cannot be reached." : `Not sent: ${(err as Error).message}.` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card say-card">
      <div className="card-head">
        <h2>Say something on the TV</h2>
      </div>
      <form className="say-form" onSubmit={send}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={NOTE_MAX}
          rows={2}
          placeholder="Maria is coming at 9 with breakfast."
          aria-label={`Message for ${name}`}
        />
        <div className="say-row">
          <span className="muted">
            Read aloud as &ldquo;{name}, &hellip;&rdquo; after a soft chime.
          </span>
          <button className="btn" disabled={busy || !text.trim()}>
            {busy ? "Sending" : "Send"}
          </button>
        </div>
        {status && (
          <p role="status" className={status.ok ? "muted" : "error"}>
            {status.text}
          </p>
        )}
      </form>
    </section>
  );
}
