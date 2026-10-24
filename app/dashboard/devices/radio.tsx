"use client";

import { useEffect, useState } from "react";

const AGENT = "http://127.0.0.1:8791";

function deviceSlug(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 41);
}

// This page is the hub. Listen starts a scanner on the computer that is showing the page,
// never on the hub machine when someone else has the page open.
export function RadioControl({ defaultId = "bedroom" }: { defaultId?: string }) {
  const [id, setId] = useState(defaultId);
  const [tag, setTag] = useState(false);
  const [listenerId, setListenerId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const slug = deviceSlug(id);

  useEffect(() => {
    const local = location.hostname === "localhost" || location.hostname === "127.0.0.1";
    if (!local) return;
    fetch("/api/radio")
      .then((r) => r.json())
      .then((d) => {
        setTag(!!d.tag);
        if (d.listenerId) {
          setListenerId(d.listenerId);
          setId(d.listenerId);
        }
      })
      .catch(() => {});
    const monitor = process.env.NEXT_PUBLIC_MONITOR_URL || "http://localhost:8787";
    fetch(`${monitor}/health`)
      .then((r) => r.json())
      .then((d) => {
        const online = Object.entries(d.listeners ?? {}).find(([, up]) => up)?.[0];
        if (typeof online === "string") {
          setListenerId(online);
          setId(online);
        }
      })
      .catch(() => {});
    fetch(`${AGENT}/status`)
      .then((r) => r.json())
      .then((d) => {
        if (d.id) {
          setListenerId(d.id);
          setId(d.id);
        }
      })
      .catch(() => {});
  }, []);

  const onHubMachine = () => location.hostname === "localhost" || location.hostname === "127.0.0.1";

  async function agent(path: string, body: unknown) {
    const res = await fetch(`${AGENT}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error("agent");
    return res.json();
  }

  async function call(action: "tag" | "listen" | "stop") {
    setNote("");
    const deviceId = deviceSlug(id);
    if (action === "listen" && !deviceId) {
      setNote("Use a short name, like bedroom or living-room.");
      return;
    }
    const hub = `ws://${location.hostname}:8787/ws/listener`;

    if (action === "listen") {
      try {
        const data = await agent("/listen", { id: deviceId, url: hub });
        setTag(false);
        setListenerId(data.id);
        setId(data.id);
        return;
      } catch {
        if (!onHubMachine()) {
          setNote("Open Tracking and name this laptop.");
          return;
        }
      }
    }

    if (action === "stop" || action === "tag") {
      try { await agent("/stop", {}); } catch { /* agent is optional on the hub */ }
    }

    if (!onHubMachine()) {
      setListenerId(null);
      setTag(false);
      return;
    }

    const res = await fetch("/api/radio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, id: deviceId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setNote(data.error ?? "Could not start Bluetooth.");
      return;
    }
    setTag(!!data.tag);
    setListenerId(data.listenerId ?? null);
    if (data.listenerId) setId(data.listenerId);
  }

  return (
    <section className="card" style={{ marginBottom: "1.5rem" }}>
      <h2>This laptop</h2>
      <p className="muted">
        Room laptops use Tracking. Type a name for this laptop there. Keep LightBlue in the foreground, named LanternTag.
      </p>
      <div className="place-row" style={{ marginTop: 12 }}>
        <input value={id} onChange={(e) => setId(e.target.value)} aria-label="Listener name" placeholder="living-room" />
        <button className="btn" onClick={() => call("listen")} disabled={!!listenerId && listenerId === slug}>
          {listenerId ? `Listening as ${listenerId}` : "Listen for the tag"}
        </button>
        <button className="btn" onClick={() => call("tag")} disabled={tag}>
          {tag ? "Advertising as LanternTag" : "Be the Bluetooth tag"}
        </button>
        {(tag || listenerId) && (
          <button className="btn ghost" onClick={() => call("stop")}>Stop</button>
        )}
      </div>
      {tag && <p className="muted">This laptop is the tag, so it cannot hear the phone. Press Stop, then Listen.</p>}
      {listenerId && <p className="muted">Listening as {listenerId}. Keep LightBlue in the foreground, named LanternTag.</p>}
      {note && <p className="error">{note}</p>}
    </section>
  );
}
