"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { roughFeet } from "@/lib/sensing/feet";
import { closestRoom, type Placement, type Reading } from "@/lib/sensing/nearest-room";
import type { Receiver } from "@/lib/types";

const WS_URL = process.env.NEXT_PUBLIC_MONITOR_WS || "ws://localhost:8787/ws/live";
const SERVICE = "4c414e54-4552-4e00-a000-000000000001";

type AdEvent = Event & { rssi?: number };
type BleDevice = {
  watchAdvertisements?: () => Promise<void>;
  addEventListener: (type: "advertisementreceived", listener: (event: AdEvent) => void) => void;
};
type Ble = {
  requestDevice: (options: { filters: Array<{ name?: string; namePrefix?: string; services?: string[] }> }) => Promise<BleDevice>;
};

function bluetooth(): Ble | null {
  const nav = navigator as Navigator & { bluetooth?: Ble };
  return nav.bluetooth ?? null;
}

function browserCanWatch(): boolean {
  if (!window.isSecureContext) return false;
  const bt = bluetooth();
  if (!bt?.requestDevice) return false;
  const proto = (globalThis as { BluetoothDevice?: { prototype?: { watchAdvertisements?: unknown } } }).BluetoothDevice?.prototype;
  return typeof proto?.watchAdvertisements === "function";
}

async function onHub(): Promise<boolean> {
  if (location.hostname === "localhost" || location.hostname === "127.0.0.1") return true;
  try {
    const res = await fetch("http://127.0.0.1:3010/", { signal: AbortSignal.timeout(800) });
    return res.ok;
  } catch {
    return false;
  }
}

async function askAgent(deviceId: string): Promise<boolean> {
  try {
    const res = await fetch("http://127.0.0.1:8791/listen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: deviceId, post: `${location.origin}/api/tracking` }),
      signal: AbortSignal.timeout(1200),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function ears(list: { id: string }[]): Placement[] {
  return list.filter((r) => r.id && !/^r\d+$/.test(r.id)).map((r) => ({ id: r.id, roomId: r.id }));
}

export function Tracker({ receivers }: { receivers: Receiver[] }) {
  const [placed, setPlaced] = useState<Placement[]>(ears(receivers));
  const [labels, setLabels] = useState<Record<string, string>>(Object.fromEntries(receivers.map((r) => [r.id, r.label])));
  const [readings, setReadings] = useState<Record<string, Reading>>({});
  const [connected, setConnected] = useState(true);
  const [mineId, setMineId] = useState<string | null>(null);
  const [mineName, setMineName] = useState("");
  const [hub, setHub] = useState(true);
  const [draft, setDraft] = useState("");
  const [watching, setWatching] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const held = useRef<string | null>(null);
  const savedRoom = useRef<string | null>(null);
  const browserIds = useRef(new Set<string>());
  const deviceIdRef = useRef<string | null>(null);
  const latest = useRef<{ rssi: number; at: number } | null>(null);
  const watchingRef = useRef(false);

  useEffect(() => {
    const saved = sessionStorage.getItem("lantern-ear");
    const name = sessionStorage.getItem("lantern-ear-name");
    if (saved && name) {
      deviceIdRef.current = saved;
      setMineId(saved);
      setMineName(name);
      setDraft(name);
      watchingRef.current = true;
      setWatching(true);
    }
    onHub().then((here) => {
      setHub(here);
      const hostLocal = location.hostname === "localhost" || location.hostname === "127.0.0.1";
      // #region agent log
      fetch("/api/tracking", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "view", hub: here, hostLocal, pairShown: true }) }).catch(() => {});
      // #endregion
      // This computer hears in a hidden listener. Opening the page keeps that going.
      if (here && saved && name) {
        fetch("/api/tracking", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "join", name, deviceId: saved, listen: true, hub: true, replace: false }),
        }).catch(() => {});
      }
    });
  }, []);

  useEffect(() => {
    let ws: WebSocket;
    let retry: ReturnType<typeof setTimeout>;
    const connect = () => {
      ws = new WebSocket(WS_URL);
      ws.onopen = () => setConnected(true);
      ws.onclose = () => { retry = setTimeout(connect, 2000); };
      ws.onerror = () => ws.close();
      ws.onmessage = (e) => {
        try {
          const frame = JSON.parse(e.data);
          if (frame.t !== "listener") return;
          if (browserIds.current.has(frame.receiverId)) return;
          setReadings((prev) => ({
            ...prev,
            [frame.receiverId]: {
              id: frame.receiverId,
              online: !!frame.online,
              rssi: typeof frame.rssi === "number" ? frame.rssi : prev[frame.receiverId]?.rssi ?? -100,
            },
          }));
        } catch {}
      };
    };
    connect();
    return () => { clearTimeout(retry); ws?.close(); };
  }, []);

  const list = useMemo(() => Object.values(readings), [readings]);
  const call = closestRoom(list, placed, held.current);
  if (call) held.current = call.roomId;

  useEffect(() => {
    let stop = false;
    const pull = async () => {
      try {
        const res = await fetch("/api/tracking");
        if (!res.ok) {
          setConnected(false);
          return;
        }
        setConnected(true);
        const data = await res.json();
        if (stop) return;
        if (Array.isArray(data.receivers)) {
          setPlaced(ears(data.receivers));
          setLabels(Object.fromEntries(data.receivers.map((r: { id: string; label: string }) => [r.id, r.label])));
        }
        if (Array.isArray(data.devices)) {
          setReadings((prev) => {
            const next = { ...prev };
            for (const d of data.devices as { id: string; rssi: number; ageMs: number }[]) {
              browserIds.current.add(d.id);
              const fresh = d.ageMs < 5000 && d.rssi > -100;
              next[d.id] = { id: d.id, online: fresh, rssi: fresh ? d.rssi : -100 };
            }
            return next;
          });
        }
      } catch {}
    };
    pull();
    const id = setInterval(pull, 1000);
    return () => { stop = true; clearInterval(id); };
  }, []);

  const readingsRef = useRef(readings);
  const placedRef = useRef(placed);
  const labelsRef = useRef(labels);
  readingsRef.current = readings;
  placedRef.current = placed;
  labelsRef.current = labels;

  useEffect(() => {
    if (!call || savedRoom.current === call.roomId) return;
    const prev = savedRoom.current;
    savedRoom.current = call.roomId;
    const from = prev ? labelsRef.current[prev] ?? "" : "";
    const to = labelsRef.current[call.receiverId] ?? "";
    fetch("/api/tracking", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "sample",
        readings: list.filter((r) => r.rssi > -100).map((r) => ({ id: r.id, rssi: r.rssi })),
        roomId: call.roomId,
        prevRoomId: prev,
        from: from && from !== "Unknown" ? from : "",
        to: to !== "Unknown" ? to : "",
      }),
    }).catch(() => {});
  }, [call?.roomId, call?.receiverId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const id = setInterval(() => {
      const dev = deviceIdRef.current;
      const heard = latest.current;
      if (dev && heard && Date.now() - heard.at <= 3000) {
        fetch("/api/tracking", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "hear", deviceId: dev, rssi: heard.rssi }),
        }).catch(() => {});
      }
    }, 1000);
    const samples = setInterval(() => {
      const ids = new Set(placedRef.current.map((p) => p.id));
      const now = Object.values(readingsRef.current).filter((r) => ids.has(r.id) && r.rssi > -100);
      if (now.length === 0) return;
      fetch("/api/tracking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sample", readings: now.map((r) => ({ id: r.id, rssi: r.rssi })) }),
      }).catch(() => {});
    }, 8000);
    return () => { clearInterval(id); clearInterval(samples); };
  }, []);

  function remember(id: string, rssi: number) {
    browserIds.current.add(id);
    setReadings((prev) => ({ ...prev, [id]: { id, online: true, rssi } }));
  }

  async function saveLaptop(name: string, listen: boolean, hubMachine: boolean, replace = false) {
    const res = await fetch("/api/tracking", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "join", name, deviceId: deviceIdRef.current, listen, hub: hubMachine, replace }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || typeof data.deviceId !== "string") {
      setNote(typeof data.error === "string" ? data.error : "Could not save this laptop.");
      return false;
    }
    const label = typeof data.label === "string" ? data.label : name;
    deviceIdRef.current = data.deviceId;
    setMineId(data.deviceId);
    watchingRef.current = true;
    setWatching(true);
    setMineName(label);
    setDraft(label);
    sessionStorage.setItem("lantern-ear", data.deviceId);
    sessionStorage.setItem("lantern-ear-name", label);
    setPlaced((prev) => [...prev.filter((p) => p.id !== data.deviceId), { id: data.deviceId, roomId: data.deviceId }]);
    setLabels((prev) => ({ ...prev, [data.deviceId]: label }));
    const heard = latest.current;
    if (heard) remember(data.deviceId, heard.rssi);
    if (listen && data.listening === false) setNote("Turn Bluetooth on for this computer.");
    return true;
  }

  // Chrome on a Mac can hear the iPhone from this page. A downloaded script cannot run there.
  async function listenInPage(): Promise<"watching" | "cancelled" | "unavailable"> {
    if (!browserCanWatch()) return "unavailable";
    try {
      const device = await bluetooth()!.requestDevice({
        filters: [{ namePrefix: "Lantern" }, { services: [SERVICE] }],
      });
      device.addEventListener("advertisementreceived", (event) => {
        if (typeof event.rssi !== "number") return;
        latest.current = { rssi: event.rssi, at: Date.now() };
        const id = deviceIdRef.current;
        if (id) remember(id, event.rssi);
      });
      await device.watchAdvertisements?.();
      return "watching";
    } catch (err) {
      const picked = err instanceof DOMException ? err.name : "";
      if (picked === "NotFoundError" || picked === "AbortError") return "cancelled";
      return "unavailable";
    }
  }

  async function pairLaptop(label: string, existingId?: string) {
    const trimmed = label.replace(/\s+/g, " ").trim();
    if (!trimmed) {
      setNote("Type a name.");
      return;
    }
    setNote("");
    setBusy(true);
    if (existingId) deviceIdRef.current = existingId;
    try {
      const watched = await listenInPage();
      if (watched === "cancelled") {
        setNote("Pick LanternTag in the list.");
        return;
      }
      if (watched === "watching") {
        const saved = await saveLaptop(trimmed, false, false);
        if (saved) setNote("This laptop is listening. Leave this page open.");
        return;
      }
      const saved = await saveLaptop(trimmed, false, false);
      const id = deviceIdRef.current;
      if (!saved || !id) return;
      if (await askAgent(id)) {
        setNote("This laptop is listening. Leave this page open.");
        return;
      }
      const here = await onHub();
      setHub(here);
      if (here) {
        await saveLaptop(trimmed, true, true, true);
        setNote("This laptop is listening.");
        return;
      }
      if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) {
        setNote("This iPhone is the beacon. Open Tracking in Chrome on the Mac and press Pair.");
      } else if (/Mac/i.test(navigator.userAgent)) {
        setNote("Open this page in Chrome on the Mac, then press Pair.");
      } else {
        setNote("This Windows browser cannot hear the phone. Listening runs on the computer where the site is open.");
      }
    } catch {
      setNote("Could not start listening. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function claim(id: string, label: string) {
    if (!/^ear-[a-f0-9]{8}$/i.test(id)) return;
    void pairLaptop(label, id);
  }

  async function connect(name: string) {
    if (watchingRef.current) return;
    await pairLaptop(name);
  }

  async function remove(id: string) {
    setBusy(true);
    setNote("");
    try {
      const res = await fetch("/api/tracking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "remove", receiverId: id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setNote(data.error ?? "Could not remove that device.");
        return;
      }
      setPlaced((prev) => prev.filter((p) => p.id !== id));
      if (deviceIdRef.current === id) {
        deviceIdRef.current = null;
        setMineId(null);
        watchingRef.current = false;
        setWatching(false);
        setMineName("");
        setDraft("");
        sessionStorage.removeItem("lantern-ear");
        sessionStorage.removeItem("lantern-ear-name");
      }
    } catch {
      setNote("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  const cards = placed
    .filter((p) => !/^r\d+$/.test(p.id))
    .map((p) => ({ ...p, reading: readings[p.id], label: labels[p.id] ?? p.id }))
    .sort((a, b) => (b.reading?.rssi ?? -100) - (a.reading?.rssi ?? -100));

  const heardCards = cards.filter((c) => c.reading?.online && (c.reading?.rssi ?? -100) > -100);
  const lead = heardCards.find((c) => c.id === call?.receiverId);
  const others = heardCards.filter((c) => c.id !== call?.receiverId);
  const nameOf = (id: string) => labels[id] || "Unnamed";
  const mineReading = mineId ? readings[mineId] : undefined;
  const mineHears = !!mineReading?.online && (mineReading?.rssi ?? -100) > -100;
  const detail = lead
    ? `About ${Math.round(roughFeet(lead.reading!.rssi))} ft from ${nameOf(lead.id)}.${others.map((o) => ` ${nameOf(o.id)} is about ${Math.round(roughFeet(o.reading!.rssi))} ft.`).join("")}`
    : "";

  return (
    <div className="tracking">
      <div className="page-head">
        <div>
          <p className="eyebrow">Tracking {connected ? "live" : "offline"}</p>
          <h1>{call ? nameOf(call.receiverId) : "Waiting for the phone"}</h1>
          {detail && <p className="muted">{detail}</p>}
        </div>
      </div>

      <div className="track-grid">
        {cards.map((c) => {
          const rssi = c.reading?.rssi ?? -100;
          const heard = !!c.reading?.online && rssi > -100;
          const silent = !!c.reading && !c.reading.online;
          const pct = heard ? Math.min(100, Math.max(0, ((rssi + 100) / 70) * 100)) : 0;
          const isLead = call?.receiverId === c.id;
          return (
            <section key={c.id} className={isLead ? "card track-card lead" : "card track-card"}>
              <div className="track-top">
                <p className="eyebrow">{isLead ? "Closest" : nameOf(c.id)}</p>
                <button className="btn ghost small" disabled={busy} onClick={() => remove(c.id)} suppressHydrationWarning>Remove</button>
              </div>
              <h2>{nameOf(c.id)}</h2>
              <p className="track-dbm">{heard ? Math.round(rssi) : silent ? "No signal" : "Waiting"}</p>
              <p className="muted">dBm</p>
              <div className="track-bar"><span style={{ width: `${pct}%` }} /></div>
              <p>{heard ? `about ${Math.round(roughFeet(rssi))} ft` : silent ? "Not hearing the phone" : "Waiting for LanternTag"}</p>
              {!heard && (
                <button className="btn small" disabled={busy} suppressHydrationWarning onClick={() => claim(c.id, nameOf(c.id))}>
                  Pair
                </button>
              )}
            </section>
          );
        })}
      </div>

      {watching && mineName ? (
        <div className="muted">
          This laptop is {mineName}.{" "}
          <button
            className="btn ghost small"
            disabled={busy}
            suppressHydrationWarning
            onClick={() => {
              watchingRef.current = false;
              setWatching(false);
            }}
          >
            Rename
          </button>
          {!mineHears && mineId && (
            <button className="btn small" disabled={busy} suppressHydrationWarning onClick={() => claim(mineId, mineName)}>
              Pair
            </button>
          )}
        </div>
      ) : (
        <form
          className="room-pick"
          onSubmit={(e) => {
            e.preventDefault();
            connect(draft);
          }}
        >
          <p className="muted">Name this laptop</p>
          <div className="room-picks">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Kitchen, porch, Mom's room"
              maxLength={40}
              aria-label="Name this laptop"
              disabled={busy}
              suppressHydrationWarning
            />
            <button className="btn" disabled={busy || !draft.trim()} suppressHydrationWarning>Add</button>
          </div>
        </form>
      )}
      {note && <p>{note}</p>}
    </div>
  );
}
