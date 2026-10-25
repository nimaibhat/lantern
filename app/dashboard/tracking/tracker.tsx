"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { roughFeet } from "@/lib/sensing/feet";
import { closestRoom, type Placement, type Reading } from "@/lib/sensing/nearest-room";
import type { Receiver } from "@/lib/types";
import { bedtimeLine } from "@/lib/cues/script";
import { sayLine } from "../../routine/vapi-voice";
import "../../routine/patient.css";

const WS_URL = process.env.NEXT_PUBLIC_MONITOR_WS || "ws://localhost:8787/ws/live";
const SERVICE = "4c414e54-4552-4e00-a000-000000000001";

type AdEvent = Event & {
  rssi?: number;
  name?: string;
  uuids?: string[];
  device?: { name?: string };
  manufacturerData?: { forEach: (fn: (value: DataView, key: number) => void) => void };
  serviceData?: { forEach: (fn: (value: DataView, key: string) => void) => void };
};
type BleDevice = {
  name?: string;
  watchAdvertisements?: () => Promise<void>;
  addEventListener: (type: "advertisementreceived", listener: (event: AdEvent) => void) => void;
};
type ScanOptions = {
  filters?: Array<{ namePrefix?: string; services?: string[] }>;
  acceptAllAdvertisements?: boolean;
  keepRepeatedDevices?: boolean;
};
type Ble = {
  requestDevice: (options: { filters: Array<{ name?: string; namePrefix?: string; services?: string[] }> }) => Promise<BleDevice>;
  requestLEScan?: (options: ScanOptions) => Promise<unknown>;
  getDevices?: () => Promise<BleDevice[]>;
  addEventListener?: (type: "advertisementreceived", listener: (event: AdEvent) => void) => void;
};

type LaptopKind = "windows" | "mac" | "ios" | "other";

function laptopKind(): LaptopKind {
  const ua = navigator.userAgent;
  const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform || "";
  // iPadOS calls itself a Mac. A touchscreen Mac is an iPad, and it cannot scan.
  if (/iPhone|iPad|iPod/i.test(ua) || (platform === "MacIntel" && navigator.maxTouchPoints > 1)) return "ios";
  if (/^Win/i.test(platform) || /Windows/i.test(ua)) return "windows";
  if (/^Mac/i.test(platform) || /Mac/i.test(ua)) return "mac";
  return "other";
}

function bluetooth(): Ble | null {
  const nav = navigator as Navigator & { bluetooth?: Ble };
  return nav.bluetooth ?? null;
}

function browserCanWatch(): boolean {
  if (!window.isSecureContext) return false;
  const bt = bluetooth();
  if (!bt) return false;
  if (typeof bt.requestLEScan === "function") return true;
  if (!bt.requestDevice) return false;
  const proto = (globalThis as { BluetoothDevice?: { prototype?: { watchAdvertisements?: unknown } } }).BluetoothDevice?.prototype;
  return typeof proto?.watchAdvertisements === "function";
}

function bytesToText(view: DataView): string {
  let text = "";
  for (let i = 0; i < view.byteLength; i++) text += String.fromCharCode(view.getUint8(i));
  return text.toLowerCase();
}

function adMatches(event: AdEvent): boolean {
  const chunks = [event.name ?? "", event.device?.name ?? ""];
  event.manufacturerData?.forEach((value) => chunks.push(bytesToText(value)));
  event.serviceData?.forEach((value, key) => chunks.push(key, bytesToText(value)));
  const name = chunks.join(" ").toLowerCase();
  const uuids = (event.uuids ?? []).map((id) => id.toLowerCase());
  return name.includes("lantern") || uuids.includes(SERVICE) || name.includes(SERVICE);
}

function pageIsHub(): boolean {
  if (typeof location === "undefined") return false;
  return location.hostname === "localhost" || location.hostname === "127.0.0.1";
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

type Patient = { name: string; quietStart: string; quietEnd: string; bedroomId?: string; householdId: string };

// The bedtime line: said this many times, this far apart, then not again for a while from the same laptop
const SAY_TIMES = 2;
const SAY_GAP_MS = 5000;
const SAY_AGAIN_MS = 60_000; // from the first word, so while they stay it comes about once a minute
const RECHECK_MS = 5000;
// The calm screen (app/routine/patient.css): nothing at first, then a slow fade; the voice starts as the photo
// appears, and the screen stays a little after the last word before fading away.
const SCREEN_LEAD_MS = 5000;
const SCREEN_AFTER_MS = 6000;
const SCREEN_FADE_MS = 2500;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Quiet hours on this laptop's clock: "21:00" to "07:00" wraps past midnight
function isNight(p: Patient) {
  const now = new Date().toTimeString().slice(0, 5);
  return p.quietStart > p.quietEnd ? now >= p.quietStart || now < p.quietEnd : now >= p.quietStart && now < p.quietEnd;
}

const slug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function ears(list: { id: string }[]): Placement[] {
  return list.filter((r) => r.id && !/^r\d+$/.test(r.id)).map((r) => ({ id: r.id, roomId: r.id }));
}

export function Tracker({ receivers, rooms = [], patient }: { receivers: Receiver[]; rooms?: { id: string; name: string }[]; patient?: Patient }) {
  const [placed, setPlaced] = useState<Placement[]>(ears(receivers));
  // The room each laptop stands in. The monitor gets the same, so the dot on the Now page is worked out from it.
  const [roomOf, setRoomOf] = useState<Record<string, string>>(Object.fromEntries(receivers.map((r) => [r.id, r.roomId ?? ""])));
  const [labels, setLabels] = useState<Record<string, string>>(Object.fromEntries(receivers.map((r) => [r.id, r.label])));
  const [readings, setReadings] = useState<Record<string, Reading>>({});
  const [connected, setConnected] = useState(true);
  const [mineId, setMineId] = useState<string | null>(null);
  const [mineName, setMineName] = useState("");
  const [hub, setHub] = useState(false);
  const [hubId, setHubId] = useState<string | null>(null); // the laptop the server itself listens as
  const [launchId, setLaunchId] = useState<string | null>(null);
  const [termCmd, setTermCmd] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [draft, setDraft] = useState("");
  const [watching, setWatching] = useState(false);
  const [note, setNote] = useState("");
  const [shareUrl, setShareUrl] = useState("");
  const [wantedIds, setWantedIds] = useState<string[]>([]);
  const [askId, setAskId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const held = useRef<string | null>(null);
  const savedRoom = useRef<string | null>(null);
  const browserIds = useRef(new Set<string>());
  const deviceIdRef = useRef<string | null>(null);
  const latest = useRef<{ rssi: number; at: number } | null>(null);
  const watchingRef = useRef(false);
  const bleDeviceRef = useRef<BleDevice | null>(null);
  const adCountRef = useRef(0);
  const noScannerRef = useRef(false); // this hub has no Python scanner; the PowerShell listener does the job

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
    const bt = bluetooth();
    if (saved && bt?.getDevices) {
      bt.getDevices().then((devices) => {
        for (const device of devices) {
          if (typeof device.watchAdvertisements !== "function") continue;
          device.addEventListener("advertisementreceived", (event) => {
            if (typeof event.rssi !== "number") return;
            latest.current = { rssi: event.rssi, at: Date.now() };
            const id = deviceIdRef.current;
            if (!id) return;
            fetch("/api/tracking", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "hear", deviceId: id, rssi: event.rssi }),
            }).catch(() => {});
          });
          device.watchAdvertisements?.().catch(() => {});
        }
      }).catch(() => {});
    }
    const as = new URLSearchParams(location.search).get("as");
    if (as && /^ear-[a-f0-9]{8}$/i.test(as)) setAskId(as);
    const here = pageIsHub();
    setHub(here);
    // This computer hears in a listener. Opening the page on the server machine keeps that going.
    if (here && saved && name) {
      fetch("/api/tracking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "join", name, deviceId: saved, listen: true, hub: true, replace: false, protocol: location.protocol }),
      }).catch(() => {});
    }
  }, []);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout>;
    const connect = () => {
      try {
        ws = new WebSocket(WS_URL);
      } catch {
        // Mixed content (ws:// from https:// page) — fall back to HTTP polling only
        return;
      }
      ws.onopen = () => setConnected(true);
      ws.onclose = () => { retry = setTimeout(connect, 2000); };
      ws.onerror = () => ws?.close();
      ws.onmessage = (e) => {
        try {
          const frame = JSON.parse(e.data);
          if (frame.t !== "listener") return;
          if (browserIds.current.has(frame.receiverId)) return;
          // Laptops report here and this server hands their readings on to the monitor. The monitor's copy is
          // smoothed over a few seconds and says -100 until it has enough of them, so it must not override the
          // signal this page already gets from /api/tracking.
          if (/^ear-/.test(frame.receiverId)) return;
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

  // At night, when the phone is closest to this laptop, this laptop asks them to go back to bed. Each laptop decides
  // for itself from the same readings, so it works in any room and whichever laptop is the hub. The laptop in their
  // own bedroom stays quiet. Moving on to another laptop stops the line here.
  const spokeAt = useRef(0);
  const [bedtime, setBedtime] = useState<{ at: number; leaving: boolean } | null>(null); // the calm screen
  // This tab's own laptop: the one paired here, the one named in ?laptop= (tools/open-tracking opens it that way),
  // or on the hub the one the server listens as
  const [asLaptop] = useState(() => (typeof location === "undefined" ? null : new URLSearchParams(location.search).get("laptop")));
  // ?black=1: a plain black screen (for filming) that still listens; only the calm screen ever shows on it
  const [black] = useState(() => typeof location !== "undefined" && new URLSearchParams(location.search).get("black") === "1");
  const namedId = asLaptop ? Object.keys(labels).find((id) => slug(labels[id] ?? "") === slug(asLaptop)) : undefined;
  const selfId = mineId ?? namedId ?? (hub ? hubId : null);
  const closestIsMine = !!call && !!selfId && call.receiverId === selfId;
  // Only another laptop taking over stops the line. A phone that goes quiet (its screen locks, the app goes to the
  // background) is still where it was, so the screen and the second line carry on.
  const closestElsewhere = !!call && !!selfId && call.receiverId !== selfId;
  const running = useRef<AbortController | null>(null);
  useEffect(() => {
    if (closestElsewhere) running.current?.abort();
  }, [closestElsewhere]);
  useEffect(() => () => running.current?.abort(), []);
  // Still here after the line: look again every few seconds, so staying out of bed gets the reminder again once
  // SAY_AGAIN_MS has passed, not only arriving
  const [recheck, setRecheck] = useState(0);
  useEffect(() => {
    if (!closestIsMine) return;
    const id = setInterval(() => setRecheck(Date.now()), RECHECK_MS);
    return () => clearInterval(id);
  }, [closestIsMine]);
  useEffect(() => {
    if (!closestIsMine || !patient || !selfId || !isNight(patient) || running.current) return;
    const here = roomOf[selfId] || slug(labels[selfId] ?? "");
    if (patient.bedroomId && here === patient.bedroomId) return;
    if (Date.now() - spokeAt.current < SAY_AGAIN_MS) return;
    const line = new AbortController();
    running.current = line;
    const at = Date.now();
    line.signal.addEventListener("abort", () => {
      if (running.current === line) running.current = null;
      setBedtime((b) => (b?.at === at ? null : b));
    }, { once: true });
    setBedtime({ at, leaving: false });
    void (async () => {
      await wait(SCREEN_LEAD_MS);
      // Counted from the first word, so a run cut short before it (React's dev double run, a brief brush past) retries
      if (!line.signal.aborted) spokeAt.current = Date.now();
      for (let i = 0; i < SAY_TIMES && !line.signal.aborted; i++) {
        if (i > 0) await wait(SAY_GAP_MS);
        if (!line.signal.aborted) await sayLine(bedtimeLine(patient.name), line.signal);
      }
      if (line.signal.aborted) return;
      await wait(SCREEN_AFTER_MS);
      if (line.signal.aborted) return;
      setBedtime({ at, leaving: true });
      await wait(SCREEN_FADE_MS);
      setBedtime((b) => (b?.at === at ? null : b));
    })().finally(() => {
      if (running.current === line) running.current = null;
    });
  }, [closestIsMine, recheck]); // eslint-disable-line react-hooks/exhaustive-deps

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
          setRoomOf(Object.fromEntries(data.receivers.map((r: { id: string; roomId?: string }) => [r.id, r.roomId ?? ""])));
        }
        if (typeof data.shareUrl === "string" && data.shareUrl) setShareUrl(data.shareUrl);
        setHubId(typeof data.hubId === "string" ? data.hubId : null);
        if (Array.isArray(data.wanted)) {
          setWantedIds((data.wanted as unknown[]).filter((id): id is string => typeof id === "string" && /^ear-[a-f0-9]{8}$/i.test(id)));
        }
        if (Array.isArray(data.devices)) {
          const freshIds = new Set<string>();
          setReadings((prev) => {
            const next = { ...prev };
            for (const d of data.devices as { id: string; rssi: number; ageMs: number }[]) {
              browserIds.current.add(d.id);
              const fresh = d.ageMs < 5000 && d.rssi > -100;
              if (fresh) freshIds.add(d.id);
              next[d.id] = { id: d.id, online: fresh, rssi: fresh ? d.rssi : -100 };
            }
            return next;
          });
          setLaunchId((current) => (current && freshIds.has(current) ? null : current));
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
    // The hub tells the monitor, so with ROOM_FROM=closest the alerts follow the same laptop that speaks. Only the
    // hub, or every open Tracking page would report the same move.
    if (hub) {
      fetch("/api/tracking/closest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: to, roomId: roomOf[call.receiverId] || undefined, rssi: call.rssi }),
      }).catch(() => {});
    }
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
    const local = pageIsHub();
    const res = await fetch("/api/tracking", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "join", name, deviceId: deviceIdRef.current, listen: listen && local, hub: hubMachine && local, replace, protocol: location.protocol }),
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
    noScannerRef.current = data.scanner === false;
    if (listen && local && data.listening === false) {
      if (!noScannerRef.current) setNote("The background listener could not start. Press Pair again — Chrome will scan directly.");
      return false;
    }
    return true;
  }

  function takeRssi(rssi: number) {
    latest.current = { rssi, at: Date.now() };
    const id = deviceIdRef.current;
    if (!id) return;
    remember(id, rssi);
    fetch("/api/tracking", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "hear", deviceId: id, rssi }),
    }).catch(() => {});
  }

  function onAd(event: AdEvent, strict: boolean) {
    adCountRef.current += 1;
    const rssi = event.rssi;
    const matched = !strict || adMatches(event);
    // #region agent log
    fetch("/api/tracking", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "view", hub: false, hostLocal: false, pairShown: true, error: `ad rssi ${typeof rssi === "number" ? rssi : "none"} id ${deviceIdRef.current ? "set" : "missing"} match ${matched}`, protocol: location.protocol }) }).catch(() => {});
    // #endregion
    if (typeof rssi !== "number" || !matched) return;
    takeRssi(rssi);
  }

  async function watchDevice(device: BleDevice): Promise<boolean> {
    if (typeof device.watchAdvertisements !== "function") return false;
    // Store device ref so it's never garbage-collected while scanning
    bleDeviceRef.current = device;
    device.addEventListener("advertisementreceived", (event) => onAd(event, false));
    await device.watchAdvertisements();
    return true;
  }

  // Pick LanternTag itself. A broad scan marks the page as listening and then drops the phone.
  async function listenInPage(): Promise<"watching" | "cancelled" | "unavailable"> {
    const bt = bluetooth();
    if (!browserCanWatch() || !bt) return "unavailable";
    adCountRef.current = 0;
    try {
      const device = await bt.requestDevice({
        filters: [{ namePrefix: "Lantern" }, { namePrefix: "lantern" }, { services: [SERVICE] }],
      });
      bleDeviceRef.current = device;
      bt.addEventListener?.("advertisementreceived", (event) => onAd(event, false));
      const watching = await watchDevice(device);
      if (!watching && typeof bt.requestLEScan === "function" && bt.addEventListener) {
        await bt.requestLEScan({
          filters: [{ namePrefix: "Lantern" }, { services: [SERVICE] }],
          keepRepeatedDevices: true,
        });
        bt.addEventListener("advertisementreceived", (event) => onAd(event, true));
        return "watching";
      }
      return watching ? "watching" : "unavailable";
    } catch (err) {
      const picked = err instanceof DOMException ? err.name : "";
      // #region agent log
      fetch("/api/tracking", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "view", hub: false, hostLocal: false, pairShown: true, error: `scan-fail ${picked || "error"}`, protocol: location.protocol }) }).catch(() => {});
      // #endregion
      if (picked === "NotFoundError" || picked === "AbortError") return "cancelled";
      if (picked === "NotSupportedError" && bt.requestDevice) {
        try {
          const device = await bt.requestDevice({
            filters: [{ namePrefix: "Lantern" }, { services: [SERVICE] }],
          });
          bleDeviceRef.current = device;
          return (await watchDevice(device)) ? "watching" : "unavailable";
        } catch (again) {
          const name = again instanceof DOMException ? again.name : "";
          if (name === "NotFoundError" || name === "AbortError") return "cancelled";
        }
      }
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
    setLaunchId(null);
    setTermCmd(null);
    setCopied(false);
    setBusy(true);
    if (existingId) deviceIdRef.current = existingId;
    try {
      const bt = bluetooth();
      const kind = laptopKind();
      const here = pageIsHub();
      setHub(here);
      // #region agent log
      fetch("/api/tracking", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "view", hub: here, hostLocal: here, pairShown: true, error: `pair-start kind ${kind} lescan ${typeof bt?.requestLEScan === "function"} watch ${browserCanWatch()}`, protocol: location.protocol }) }).catch(() => {});
      // #endregion
      if (kind === "ios") {
        setNote("This iPhone is the beacon. Pair from Chrome on a Mac, or from the Windows laptop in that room.");
        return;
      }
      // Mac and Windows Chrome can both hear the phone via Web Bluetooth (watchAdvertisements).
      if (kind === "mac") {
        if (!window.isSecureContext) {
          setNote("Bluetooth requires HTTPS. Open this page at: https://" + location.hostname + ":" + (location.port || "3000") + location.pathname);
          return;
        }
        if (!bluetooth()) {
          // No Web Bluetooth (older Chrome, or Bluetooth permission denied) — fall back to Terminal command
          const saved = await saveLaptop(trimmed, false, false);
          if (!saved) return;
          const id = deviceIdRef.current;
          setLaunchId(id);
          setTermCmd(`bash <(curl -sk '${location.origin}/api/tracking/ear-mac?id=${id}')`);
          setNote("Chrome cannot access Bluetooth on this Mac. Copy the command below, paste it in Terminal, and leave it running.");
          return;
        }
        const watched = await listenInPage();
        // #region agent log
        fetch("/api/tracking", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "view", hub: here, hostLocal: here, pairShown: true, error: `pair-branch ${watched}`, protocol: location.protocol }) }).catch(() => {});
        // #endregion
        if (watched === "cancelled") {
          setNote("Pick LanternTag in the list. Make sure LightBlue is running on the phone with LanternTag advertising.");
          return;
        }
        if (watched === "watching") {
          const saved = await saveLaptop(trimmed, false, false);
          if (!saved) return;
          setNote("Scanning for signal... keep this tab in the foreground.");
          const before = adCountRef.current;
          await new Promise((r) => setTimeout(r, 6000));
          if (adCountRef.current > before && latest.current && Date.now() - latest.current.at < 8000) {
            setNote("Connected and hearing the phone. Leave this tab open.");
            return;
          }
          // Web Bluetooth paired but no signal — offer Terminal command
          const id = deviceIdRef.current;
          setLaunchId(id);
          setTermCmd(`bash <(curl -sk '${location.origin}/api/tracking/ear-mac?id=${id}')`);
          setNote("Chrome paired but the signal isn't coming through. Copy the command below and paste it in Terminal.");
          return;
        }
        // Web Bluetooth unavailable — show Terminal command
        {
          const saved = await saveLaptop(trimmed, false, false);
          if (!saved) return;
          const id = deviceIdRef.current;
          setLaunchId(id);
          setTermCmd(`bash <(curl -sk '${location.origin}/api/tracking/ear-mac?id=${id}')`);
          setNote("Copy the command below and paste it in Terminal. It will install what it needs and start listening.");
        }
        return;
      }
      if (kind !== "windows") {
        setNote("Pair from a Mac in Chrome, or from the Windows laptop in that room.");
        return;
      }
      // Hub Windows: use the Python scanner (runs in background, reliable)
      if (here) {
        const saved = await saveLaptop(trimmed, true, true, true);
        if (saved) {
          setNote("This laptop is listening. Leave this page open.");
          return;
        }
        // No Python scanner here: the PowerShell listener (or Lantern.bat) is what works on Windows, so go straight to it
        if (noScannerRef.current && deviceIdRef.current) {
          const id = deviceIdRef.current;
          const earUrl = `${location.origin}/api/tracking/ear?id=${id}`;
          setLaunchId(id);
          setTermCmd(`powershell -NoProfile -ExecutionPolicy Bypass -Command "[System.Net.ServicePointManager]::ServerCertificateValidationCallback={$true}; [System.Net.ServicePointManager]::SecurityProtocol=[System.Net.SecurityProtocolType]::Tls12; $p=Join-Path $env:TEMP 'lantern-ear.ps1'; Invoke-WebRequest -UseBasicParsing -Uri '${earUrl}' -OutFile $p; Unblock-File $p; powershell -NoProfile -ExecutionPolicy Bypass -File $p"`);
          setNote("Open PowerShell on this laptop, paste the command below, and leave it running.");
          return;
        }
        // Python failed — fall through to try Web Bluetooth
      }
      // Non-hub (or hub Python failed): use Web Bluetooth — zero install
      if (!window.isSecureContext) {
        setNote("Bluetooth requires HTTPS. Open this page at: https://" + location.hostname + ":" + (location.port || "3000") + location.pathname);
        return;
      }
      if (!bluetooth()) {
        // No Web Bluetooth — offer PowerShell command
        const saved = await saveLaptop(trimmed, false, false);
        if (!saved) return;
        const id = deviceIdRef.current;
        const earUrl = `${location.origin}/api/tracking/ear?id=${id}`;
        setLaunchId(id);
        setTermCmd(`powershell -NoProfile -ExecutionPolicy Bypass -Command "[System.Net.ServicePointManager]::ServerCertificateValidationCallback={$true}; [System.Net.ServicePointManager]::SecurityProtocol=[System.Net.SecurityProtocolType]::Tls12; $p=Join-Path $env:TEMP 'lantern-ear.ps1'; Invoke-WebRequest -UseBasicParsing -Uri '${earUrl}' -OutFile $p; Unblock-File $p; powershell -NoProfile -ExecutionPolicy Bypass -File $p"`);
        setNote("This browser does not support Bluetooth. Open PowerShell on this laptop, paste the command below, and leave it running.");
        return;
      }
      if (browserCanWatch()) {
        adCountRef.current = 0;
        const watched = await listenInPage();
        if (watched === "cancelled") {
          setNote("Pick LanternTag in the list. Make sure LightBlue is running on the phone with LanternTag advertising.");
          return;
        }
        if (watched === "watching") {
          const saved = await saveLaptop(trimmed, false, false);
          if (!saved) return;
          setNote("Scanning for signal... keep this tab in the foreground.");
          // Check that ads actually arrive — if not, fall back to .bat
          const before = adCountRef.current;
          await new Promise((r) => setTimeout(r, 6000));
          if (adCountRef.current > before && latest.current && Date.now() - latest.current.at < 8000) {
            setNote("Connected and hearing the phone. Leave this tab open.");
            return;
          }
          // Web Bluetooth isn't delivering signal — offer PowerShell command
          const id = deviceIdRef.current;
          const earUrl = `${location.origin}/api/tracking/ear?id=${id}`;
          setLaunchId(id);
          setTermCmd(`powershell -NoProfile -ExecutionPolicy Bypass -Command "[System.Net.ServicePointManager]::ServerCertificateValidationCallback={$true}; [System.Net.ServicePointManager]::SecurityProtocol=[System.Net.SecurityProtocolType]::Tls12; $p=Join-Path $env:TEMP 'lantern-ear.ps1'; Invoke-WebRequest -UseBasicParsing -Uri '${earUrl}' -OutFile $p; Unblock-File $p; powershell -NoProfile -ExecutionPolicy Bypass -File $p"`);
          setNote("Chrome paired but can't read the signal on this laptop. Open PowerShell, paste the command below, and leave it running.");
          return;
        }
      }
      // Web Bluetooth not available at all — show PowerShell command
      {
        const saved = await saveLaptop(trimmed, false, false);
        if (!saved) return;
        const id = deviceIdRef.current;
        const earUrl = `${location.origin}/api/tracking/ear?id=${id}`;
        setLaunchId(id);
        setTermCmd(`powershell -NoProfile -ExecutionPolicy Bypass -Command "[System.Net.ServicePointManager]::ServerCertificateValidationCallback={$true}; [System.Net.ServicePointManager]::SecurityProtocol=[System.Net.SecurityProtocolType]::Tls12; $p=Join-Path $env:TEMP 'lantern-ear.ps1'; Invoke-WebRequest -UseBasicParsing -Uri '${earUrl}' -OutFile $p; Unblock-File $p; powershell -NoProfile -ExecutionPolicy Bypass -File $p"`);
        setNote("Open PowerShell on this laptop, paste the command below, and leave it running. It will scan Bluetooth and send the signal to the hub.");
      }
    } catch {
      setNote("Could not start listening. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function connect(name: string) {
    if (watchingRef.current) return;
    await pairLaptop(name);
  }

  async function setRoom(id: string, roomId: string) {
    setNote("");
    setRoomOf((prev) => ({ ...prev, [id]: roomId }));
    try {
      const res = await fetch("/api/sensors", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ receiverId: id, roomId }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setNote(data.error ?? "Could not set where that device is.");
    } catch {
      setNote("Could not reach the server.");
    }
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
    // A steady order: cards that re-sort by signal every second slide under the pointer, and a room picked for one
    // laptop lands on another. The closest one is still marked.
    .sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));

  const heardCards = cards.filter((c) => c.reading?.online && (c.reading?.rssi ?? -100) > -100);
  const lead = heardCards.find((c) => c.id === call?.receiverId);
  const others = heardCards.filter((c) => c.id !== call?.receiverId);
  const shownNote = lead && /looking for the phone/.test(note) ? "" : note;
  const nameOf = (id: string) => labels[id] || "Unnamed";
  const mineReading = mineId ? readings[mineId] : undefined;
  const mineHears = !!mineReading?.online && (mineReading?.rssi ?? -100) > -100;
  const detail = lead
    ? `About ${Math.round(roughFeet(lead.reading!.rssi))} ft from ${nameOf(lead.id)}.${others.map((o) => ` ${nameOf(o.id)} is about ${Math.round(roughFeet(o.reading!.rssi))} ft.`).join("")}`
    : "";
  const inviteId = [askId, ...wantedIds].find((id) => id && !readings[id]?.online) ?? null;
  const showStart = !hub && !!inviteId;

  return (
    <div className="tracking">
      {black && <div className="pt-black" />}
      {/* The calm screen while the line is said: the photo of where to go, then the words. A tap closes it. */}
      {bedtime && patient && (
        <div className={bedtime.leaving ? "pt-overlay pt-voice pt-leaving" : "pt-overlay pt-voice"} key={bedtime.at} onClick={() => running.current?.abort()}>
          <img
            className="pt-photo"
            src={`/api/patient/media?h=${encodeURIComponent(patient.householdId)}&path=${encodeURIComponent(`${patient.householdId}/redirect-photo.jpg`)}`}
            alt=""
            onError={(e) => (e.currentTarget.style.display = "none")}
          />
          <p className="pt-message">{bedtimeLine(patient.name)}</p>
        </div>
      )}
      <div className="page-head">
        <div>
          <p className="eyebrow">Tracking {connected ? "live" : "offline"}</p>
          <h1>{call ? nameOf(call.receiverId) : "Waiting for the phone"}</h1>
          {detail && <p className="muted">{detail}</p>}
        </div>
      </div>

      {showStart && inviteId && (
        <div className="card track-card lead">
          <p className="eyebrow">This laptop</p>
          <h2>{nameOf(inviteId)}</h2>
          <p>Press Start so this computer hears the phone and sends its own signal.</p>
          {launchId === inviteId ? (
            <a className="btn" href={`/api/tracking/launch?id=${inviteId}`}>Open listener</a>
          ) : (
            <button className="btn" disabled={busy} suppressHydrationWarning onClick={() => pairLaptop(nameOf(inviteId), inviteId)}>
              Start
            </button>
          )}
        </div>
      )}

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
              {rooms.length > 0 && (
                <label className="track-where">
                  <span className="muted">Location</span>
                  <select
                    value={roomOf[c.id] ?? ""}
                    onChange={(e) => e.target.value && setRoom(c.id, e.target.value)}
                    aria-label={`Where ${nameOf(c.id)} is`}
                    suppressHydrationWarning
                  >
                    <option value="">Pick a room</option>
                    {rooms.map((r) => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </select>
                </label>
              )}
              {!heard && (launchId === c.id ? (
                <a className="btn small" href={`/api/tracking/launch?id=${c.id}`}>Open listener</a>
              ) : (
                <button className="btn small" disabled={busy} suppressHydrationWarning onClick={() => pairLaptop(nameOf(c.id), c.id)}>
                  Pair
                </button>
              ))}
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
          {!mineHears && mineId && (launchId === mineId ? (
            <a className="btn small" href={`/api/tracking/launch?id=${mineId}`}>Open listener</a>
          ) : (
            <button className="btn small" disabled={busy} suppressHydrationWarning onClick={() => pairLaptop(mineName, mineId)}>
              Pair
            </button>
          ))}
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
      {shownNote && <p>{shownNote}</p>}
      {termCmd && (
        <div className="mac-cmd" style={{ marginTop: "0.5rem" }}>
          <code style={{
            display: "block",
            padding: "0.6rem 0.8rem",
            background: "var(--d-surface, #1e1e1e)",
            color: "var(--d-text, #e0e0e0)",
            borderRadius: 6,
            fontSize: "0.85rem",
            wordBreak: "break-all",
            userSelect: "all",
          }}>{termCmd}</code>
          {launchId && (
            <p className="muted" style={{ margin: "0.5rem 0" }}>
              Or download{" "}
              <a href={`/api/tracking/launch?id=${launchId}`}>{laptopKind() === "mac" ? "Lantern.command" : "Lantern.bat"}</a>
              {" "}and double-click it. If Chrome asks, choose Keep.
            </p>
          )}
          <button
            className="btn small"
            style={{ marginTop: "0.4rem" }}
            onClick={() => {
              navigator.clipboard.writeText(termCmd).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }).catch(() => {});
            }}
          >{copied ? "Copied" : "Copy"}</button>
        </div>
      )}
      {shareUrl && placed.length > 0 && (
        <p className="muted" style={{ marginTop: "1rem", fontSize: "0.85rem" }}>
          Other laptops: open <strong>{shareUrl}</strong> and press Pair
        </p>
      )}
    </div>
  );
}
