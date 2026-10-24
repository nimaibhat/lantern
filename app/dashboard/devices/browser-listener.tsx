"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Zero-install BLE listener.  A new laptop opens the hub's dashboard in
 * Chrome / Edge, enters a room name, clicks "Pair & Listen", picks the
 * LanternTag from the browser Bluetooth picker, and RSSI readings flow
 * to the monitor automatically.
 *
 * Web Bluetooth requires a secure context (HTTPS or localhost).
 * Start the hub with `npm run dev:https` so remote laptops can pair.
 */

const MIN_SEND_MS = 400; // throttle: at most ~2.5 reports / second

function slugify(v: string) {
  return v.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 41);
}

export function BrowserListener() {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [secure, setSecure] = useState<boolean | null>(null);
  const [roomId, setRoomId] = useState("");
  const [scanning, setScanning] = useState(false);
  const [rssi, setRssi] = useState<number | null>(null);
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const hbRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastSendRef = useRef(0);

  useEffect(() => {
    const hasBt = typeof navigator !== "undefined" && "bluetooth" in navigator;
    setSupported(hasBt);
    setSecure(typeof window !== "undefined" && window.isSecureContext);
  }, []);

  const send = useCallback(async (msg: Record<string, unknown>) => {
    try {
      await fetch("/api/listener/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(msg),
      });
    } catch {
      // monitor handles gaps
    }
  }, []);

  async function startScanning() {
    const slug = slugify(roomId);
    if (!slug) { setError("Enter a room name first (e.g. kitchen)."); return; }
    setError("");

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bt = (navigator as any).bluetooth;
      if (!bt) throw new Error("Bluetooth not available in this browser.");

      // Browser shows a picker — user selects "LanternTag"
      const device = await bt.requestDevice({
        filters: [{ name: "LanternTag" }],
        optionalServices: ["4c414e54-4552-4e00-a000-000000000001"],
      });

      // Tell the monitor this listener exists
      await send({ type: "hello", receiverId: slug, kind: "web-bluetooth" });

      // Heartbeat so the monitor keeps us "online"
      hbRef.current = setInterval(() => {
        send({ type: "hb", receiverId: slug, ts: Date.now() });
      }, 5000);

      // Watch advertisements — each event carries the RSSI
      const controller = new AbortController();
      abortRef.current = controller;

      device.addEventListener("advertisementreceived", (event: Event) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const r: number | undefined = (event as any).rssi;
        if (r == null) return;
        setRssi(r);

        // Throttle HTTP posts
        const now = Date.now();
        if (now - lastSendRef.current < MIN_SEND_MS) return;
        lastSendRef.current = now;
        send({ type: "rssi", receiverId: slug, tagId: "tag-1", rssi: r, ts: now });
      });

      await device.watchAdvertisements({ signal: controller.signal });
      setScanning(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/cancel/i.test(msg)) {
        // user dismissed the picker
        setError("");
      } else {
        setError(msg);
      }
    }
  }

  function stopScanning() {
    abortRef.current?.abort();
    abortRef.current = null;
    if (hbRef.current) clearInterval(hbRef.current);
    hbRef.current = null;
    setScanning(false);
    setRssi(null);
  }

  useEffect(() => () => {
    abortRef.current?.abort();
    if (hbRef.current) clearInterval(hbRef.current);
  }, []);

  if (supported === null) return null;

  const hubHost = typeof window !== "undefined" ? window.location.hostname : "localhost";

  if (!supported) {
    // Safari (macOS default) and Firefox do not support Web Bluetooth.
    const isSafari = typeof navigator !== "undefined" && /safari/i.test(navigator.userAgent) && !/chrome|chromium/i.test(navigator.userAgent);
    return (
      <section className="card" style={{ marginBottom: "1.5rem" }}>
        <h2>Pair This Laptop</h2>
        <p style={{ color: "var(--red, #ef4444)" }}>
          {isSafari
            ? "Safari does not support Bluetooth scanning."
            : "This browser does not support Bluetooth scanning."}
          {" "}Open this same page in <strong>Google Chrome</strong>{" "}
          {process.platform !== "darwin" && <>or <strong>Microsoft Edge</strong></>}.
        </p>
        <p className="muted" style={{ fontSize: "0.85rem", marginTop: 8 }}>
          Copy this URL and paste it into Chrome:
        </p>
        <p style={{ fontFamily: "monospace", margin: "0.25rem 0", padding: "0.5rem", background: "var(--d-border, #e5e5e5)", borderRadius: 4, wordBreak: "break-all", fontSize: "0.85rem", userSelect: "all" }}>
          {typeof window !== "undefined" ? window.location.href : ""}
        </p>
      </section>
    );
  }

  if (!secure) {
    return (
      <section className="card" style={{ marginBottom: "1.5rem" }}>
        <h2>Pair This Laptop</h2>
        <p>Bluetooth requires a secure connection. Open this page at:</p>
        <p style={{ fontFamily: "monospace", margin: "0.5rem 0", padding: "0.5rem", background: "var(--d-border, #e5e5e5)", borderRadius: 4, wordBreak: "break-all", fontSize: "0.85rem", userSelect: "all" }}>
          https://{hubHost}:3000/dashboard/devices
        </p>
        <p className="muted" style={{ fontSize: "0.82rem" }}>
          On the hub laptop, start with: <code style={{ padding: "2px 6px", background: "var(--d-border, #e5e5e5)", borderRadius: 3 }}>npm run dev:https</code>{" "}
          then click &quot;Advanced&quot; and &quot;Proceed&quot; when Chrome shows the certificate warning.
        </p>
      </section>
    );
  }

  const slug = slugify(roomId);

  return (
    <section className="card" style={{ marginBottom: "1.5rem" }}>
      <h2>Pair This Laptop</h2>
      <p className="muted">
        Enter the room this laptop is in, then click <strong>Pair &amp; Listen</strong>.
        Your browser will detect the phone&apos;s Bluetooth signal and send the readings to the hub automatically.
      </p>

      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
        <input
          value={roomId}
          onChange={(e) => setRoomId(e.target.value)}
          placeholder="Room name (e.g. kitchen)"
          aria-label="Room name"
          disabled={scanning}
          style={{ padding: "0.4rem 0.6rem", minWidth: 180 }}
        />
        {scanning ? (
          <button className="btn" onClick={stopScanning} style={{ background: "var(--red, #ef4444)" }}>
            Stop
          </button>
        ) : (
          <button className="btn" onClick={startScanning} disabled={!slug}>
            Pair &amp; Listen
          </button>
        )}
      </div>

      {scanning && (
        <div style={{ marginTop: 12 }}>
          <p>
            Listening as <strong>{slug}</strong>.{" "}
            {rssi !== null ? (
              <span style={{ fontFamily: "monospace" }}>
                Signal: <strong>{rssi} dBm</strong>
              </span>
            ) : (
              <span style={{ color: "var(--muted)" }}>Waiting for phone signal&hellip;</span>
            )}
          </p>
          <p className="muted" style={{ fontSize: "0.82rem" }}>
            Keep this tab open and in the foreground. Bluetooth scanning pauses in background tabs.
          </p>
        </div>
      )}

      {error && <p className="error">{error}</p>}
    </section>
  );
}
