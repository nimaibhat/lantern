"use client";

import { useEffect, useState } from "react";

const AGENT = "http://127.0.0.1:8791";

function deviceSlug(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 41);
}

// Listen starts a scanner on the computer that is showing the page via the local agent (127.0.0.1:8791).
// Works from both the hub and remote laptops: the browser always talks to its own machine's agent.
export function RadioControl({ defaultId = "bedroom" }: { defaultId?: string }) {
  const [id, setId] = useState(defaultId);
  const [tag, setTag] = useState(false);
  const [listenerId, setListenerId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const slug = deviceSlug(id);

  const onHubMachine = () => location.hostname === "localhost" || location.hostname === "127.0.0.1";

  // Derive the hub's monitor address: when opened from a remote laptop via the hub's IP,
  // location.hostname is the hub's IP, which is exactly what we need for the WS URL.
  // When opened locally, it's localhost, which also works.
  const hubHost = () => {
    // If opened via the hub's IP, use that. Otherwise fall back to localhost.
    return location.hostname;
  };

  useEffect(() => {
    // Always check the local agent (runs on whichever machine the browser is on).
    fetch(`${AGENT}/status`)
      .then((r) => r.json())
      .then((d) => {
        if (d.id) {
          setListenerId(d.id);
          setId(d.id);
        }
      })
      .catch(() => {});

    // Check the hub's radio API (only works when opened on the hub itself).
    if (onHubMachine()) {
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
    }

    // Check the monitor for any already-online listener (uses the hub hostname from the URL).
    const monitor = process.env.NEXT_PUBLIC_MONITOR_URL || `http://${hubHost()}:8787`;
    fetch(`${monitor}/health`)
      .then((r) => r.json())
      .then((d) => {
        const online = Object.entries(d.listeners ?? {}).find(([, up]) => up)?.[0];
        if (typeof online === "string" && !listenerId) {
          setListenerId(online);
          setId(online);
        }
      })
      .catch(() => {});
  }, []);

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
    // Point the listener at the hub's monitor. When a remote laptop opens
    // http://HUB_IP:3000/dashboard, location.hostname is the hub's IP.
    const hub = `ws://${hubHost()}:8787/ws/listener`;

    if (action === "listen") {
      try {
        // Try the local agent first (works on any laptop running agent.py).
        const data = await agent("/listen", { id: deviceId, url: hub });
        setTag(false);
        setListenerId(data.id);
        setId(data.id);
        return;
      } catch {
        if (!onHubMachine()) {
          setNote(
            "Could not reach the local agent. On this laptop, run:\n" +
            "  python listener/pair.py\n" +
            "or: python listener/agent.py"
          );
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
        Give this laptop a room name and press Listen. Keep LightBlue in the foreground on the phone, named LanternTag.
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
      {note && <p className="error" style={{ whiteSpace: "pre-wrap" }}>{note}</p>}
    </section>
  );
}
