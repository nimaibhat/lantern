"use client";

import { useEffect, useRef, useState } from "react";
import { BrowserListener } from "./browser-listener";
import { Calibration } from "./calibration";
import { RadioControl } from "./radio";

interface ListenerStatus {
  id: string;
  online: boolean;
  rssi: number; // -100 = no reading
}

interface HealthData {
  ok: boolean;
  uptimeS: number;
  listeners: Record<string, boolean>;
  tagLastSeen: number | null;
}

interface RoomInfo { id: string; name: string }
interface AnchorInfo { receiverId: string }

const MONITOR_URL = process.env.NEXT_PUBLIC_MONITOR_URL || "http://localhost:8787";
const MONITOR_WS = process.env.NEXT_PUBLIC_MONITOR_WS || "ws://localhost:8787/ws/live";

export default function DevicesPage() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [listeners, setListeners] = useState<ListenerStatus[]>([]);
  const [connected, setConnected] = useState(false);
  const [currentRoom, setCurrentRoom] = useState<string | undefined>();
  const [roomSource, setRoomSource] = useState<string | undefined>();
  const [simRoom, setSimRoom] = useState("");
  const [simX, setSimX] = useState("");
  const [simY, setSimY] = useState("");
  const [recording, setRecording] = useState(false);
  const [recordId, setRecordId] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<number>(0);
  const wsRef = useRef<WebSocket | null>(null);

  // Rooms and anchors from the home model
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [anchors, setAnchors] = useState<AnchorInfo[]>([]);
  const [newReceiverId, setNewReceiverId] = useState("");
  const [newRoomId, setNewRoomId] = useState("");

  // Load rooms and anchors from monitor
  useEffect(() => {
    async function load() {
      try {
        const r = await fetch(`${MONITOR_URL}/world/rooms`);
        const d = await r.json();
        setRooms(d.rooms);
        setAnchors(d.anchors);
        if (d.rooms.length > 0 && !newRoomId) setNewRoomId(d.rooms[0].id);
      } catch {}
    }
    load();
  }, []);

  // Poll health every 3s
  useEffect(() => {
    async function poll() {
      try {
        const r = await fetch(`${MONITOR_URL}/health`);
        const d: HealthData = await r.json();
        setHealth(d);
      } catch {}
    }
    poll();
    const id = setInterval(poll, 3000);
    return () => clearInterval(id);
  }, []);

  // WebSocket for live frames
  useEffect(() => {
    let ws: WebSocket;
    let retry: ReturnType<typeof setTimeout>;

    function connect() {
      try {
        ws = new WebSocket(MONITOR_WS);
      } catch {
        return; // mixed content (ws:// from https://) — page uses HTTP polling instead
      }
      wsRef.current = ws;
      ws.onopen = () => setConnected(true);
      ws.onclose = () => { setConnected(false); retry = setTimeout(connect, 2000); };
      ws.onerror = () => ws.close();
      ws.onmessage = (e) => {
        try {
          const frame = JSON.parse(e.data);
          setLastUpdate(Date.now());
          if (frame.t === "snapshot") {
            setCurrentRoom(frame.room);
            if (frame.listeners) {
              setListeners(
                Object.entries(frame.listeners).map(([id, online]) => ({
                  id,
                  online: online as boolean,
                  rssi: -100,
                }))
              );
            }
          } else if (frame.t === "listener") {
            setListeners((prev) => {
              const exists = prev.some((l) => l.id === frame.receiverId);
              if (!exists) return [...prev, { id: frame.receiverId, online: frame.online, rssi: frame.rssi ?? -100 }];
              return prev.map((l) =>
                l.id === frame.receiverId
                  ? { ...l, online: frame.online, rssi: frame.rssi ?? l.rssi }
                  : l
              );
            });
          } else if (frame.t === "position") {
            setCurrentRoom(frame.roomId);
            setRoomSource(frame.source);
          } else if (frame.t === "location") {
            setCurrentRoom(frame.roomId);
            setRoomSource(frame.source);
          }
        } catch {}
      };
    }

    connect();
    return () => { clearTimeout(retry); ws?.close(); };
  }, []);

  async function simByRoom() {
    if (!simRoom) return;
    try {
      await fetch(`${MONITOR_URL}/sim/room`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId: simRoom }),
      });
    } catch {}
  }

  async function simByPosition() {
    const x = parseFloat(simX);
    const y = parseFloat(simY);
    if (isNaN(x) || isNaN(y)) return;
    try {
      await fetch(`${MONITOR_URL}/sim/position`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ x, y }),
      });
    } catch {}
  }

  async function toggleRecording() {
    const endpoint = recording ? "/record/stop" : "/record/start";
    try {
      const r = await fetch(`${MONITOR_URL}${endpoint}`, { method: "POST" });
      const d = await r.json();
      if (d.ok) {
        setRecording(!recording);
        setRecordId(recording ? null : d.session);
      }
    } catch {}
  }

  async function assignDevice() {
    if (!newReceiverId.trim() || !newRoomId) return;
    try {
      const r = await fetch(`${MONITOR_URL}/world/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receiverId: newReceiverId.trim(), roomId: newRoomId }),
      });
      const d = await r.json();
      if (d.ok) {
        setAnchors((prev) => {
          const exists = prev.some((a) => a.receiverId === newReceiverId.trim());
          if (exists) return prev;
          return [...prev, { receiverId: newReceiverId.trim() }];
        });
        setNewReceiverId("");
      }
    } catch {}
  }

  async function unassignDevice(receiverId: string) {
    try {
      const r = await fetch(`${MONITOR_URL}/world/unassign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receiverId }),
      });
      const d = await r.json();
      if (d.ok) {
        setAnchors((prev) => prev.filter((a) => a.receiverId !== receiverId));
      }
    } catch {}
  }

  // Sort: strongest RSSI first (ignore -100)
  const sorted = [...listeners].sort((a, b) => {
    if (a.rssi === -100 && b.rssi === -100) return a.id.localeCompare(b.id);
    if (a.rssi === -100) return 1;
    if (b.rssi === -100) return -1;
    return b.rssi - a.rssi;
  });

  const strongest = sorted.find((l) => l.online && l.rssi > -100);
  const anchorIds = new Set(anchors.map((a) => a.receiverId));

  return (
    <div style={{ padding: "1rem", maxWidth: 900 }}>
      <h1>Devices</h1>
      <BrowserListener />
      <RadioControl />

      {/* Connection status */}
      <section style={{ marginBottom: "1.5rem" }}>
        <p>
          Monitor:{" "}
          <span style={{ color: connected ? "var(--green, #22c55e)" : "var(--red, #ef4444)", fontWeight: 600 }}>
            {connected ? "Connected" : "Disconnected"}
          </span>
          {health && (
            <span style={{ marginLeft: "1rem", color: "var(--muted)" }}>uptime {health.uptimeS}s</span>
          )}
        </p>
        {currentRoom && (
          <p>
            Current room: <strong>{currentRoom === "living" || currentRoom === "living-room" ? "Living room" : currentRoom === "bedroom" ? "Bedroom" : currentRoom}</strong>
            {roomSource && (
              <span style={{
                marginLeft: 8,
                padding: "2px 8px",
                borderRadius: 4,
                fontSize: "0.75rem",
                fontWeight: 600,
                background: roomSource === "ble" ? "#3b82f6" : roomSource === "sim" ? "#f59e0b" : "#6b7280",
                color: "#fff",
              }}>
                {roomSource}
              </span>
            )}
          </p>
        )}
        {strongest && (
          <p style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
            Nearest listener: <strong>{strongest.id}</strong> ({strongest.rssi} dBm)
          </p>
        )}
      </section>

      {/* Listeners with live RSSI */}
      <section style={{ marginBottom: "1.5rem" }}>
        <h2>Listeners</h2>
        {listeners.length === 0 ? (
          <p style={{ color: "var(--muted)" }}>No listener data yet</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "0.5rem" }}>Receiver</th>
                <th style={{ textAlign: "left", padding: "0.5rem" }}>Status</th>
                <th style={{ textAlign: "left", padding: "0.5rem" }}>RSSI</th>
                <th style={{ textAlign: "left", padding: "0.5rem" }}>Signal</th>
                <th style={{ textAlign: "left", padding: "0.5rem" }}>Anchor</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((l) => {
                const pct = l.rssi <= -100 ? 0 : Math.min(100, Math.max(0, ((l.rssi + 100) / 70) * 100));
                const barColor = pct > 60 ? "var(--green, #22c55e)" : pct > 30 ? "#f59e0b" : "var(--red, #ef4444)";
                return (
                  <tr key={l.id} style={{ opacity: l.online ? 1 : 0.5 }}>
                    <td style={{ padding: "0.5rem", fontWeight: l.id === strongest?.id ? 700 : 400 }}>{l.id}</td>
                    <td style={{ padding: "0.5rem" }}>
                      <span style={{
                        display: "inline-block", width: 10, height: 10, borderRadius: "50%",
                        background: l.online ? "var(--green, #22c55e)" : "var(--red, #ef4444)",
                        marginRight: 6,
                      }} />
                      {l.online ? "Online" : "Offline"}
                    </td>
                    <td style={{ padding: "0.5rem", fontFamily: "monospace" }}>
                      {l.rssi > -100 ? `${l.rssi} dBm` : "---"}
                    </td>
                    <td style={{ padding: "0.5rem", width: 120 }}>
                      <div style={{
                        height: 10, background: "var(--d-border, #e5e5e5)", borderRadius: 5, overflow: "hidden",
                      }}>
                        <div style={{
                          height: "100%", width: `${pct}%`, background: barColor,
                          borderRadius: 5, transition: "width 0.3s",
                        }} />
                      </div>
                    </td>
                    <td style={{ padding: "0.5rem" }}>
                      {anchorIds.has(l.id) ? (
                        <span style={{ color: "var(--green, #22c55e)", fontSize: "0.8rem" }}>assigned</span>
                      ) : (
                        <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>unassigned</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {/* Assign / manage anchors */}
      <section style={{ marginBottom: "1.5rem" }}>
        <h2>Assign Listener to Room</h2>
        <p style={{ color: "var(--muted)", fontSize: "0.85rem", marginBottom: "0.5rem" }}>
          Map a listener slug to a room in the home model. The monitor will use this to estimate which room the tag is in.
        </p>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
          <input
            type="text"
            placeholder="Listener ID (e.g. bedroom)"
            value={newReceiverId}
            onChange={(e) => setNewReceiverId(e.target.value)}
            style={{ padding: "0.4rem 0.6rem", minWidth: 180 }}
          />
          <select value={newRoomId} onChange={(e) => setNewRoomId(e.target.value)} style={{ padding: "0.4rem" }}>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
          <button className="btn" onClick={assignDevice}>Assign</button>
        </div>

        {anchors.length > 0 && (
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "0.75rem" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "0.4rem" }}>Receiver ID</th>
                <th style={{ textAlign: "left", padding: "0.4rem" }}>Room</th>
                <th style={{ textAlign: "left", padding: "0.4rem" }}></th>
              </tr>
            </thead>
            <tbody>
              {anchors.map((a) => (
                <tr key={a.receiverId}>
                  <td style={{ padding: "0.4rem", fontFamily: "monospace" }}>{a.receiverId}</td>
                  <td style={{ padding: "0.4rem" }}>{rooms.find((r) => r.id === a.receiverId)?.name ?? a.receiverId}</td>
                  <td style={{ padding: "0.4rem" }}>
                    <button
                      onClick={() => unassignDevice(a.receiverId)}
                      style={{ background: "none", border: "none", color: "var(--red, #ef4444)", cursor: "pointer", fontSize: "0.85rem" }}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <Calibration rooms={rooms} />

      {/* Simulator */}
      <section style={{ marginBottom: "1.5rem" }}>
        <h2>Simulator</h2>
        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
          <div>
            <label>
              Room:{" "}
              <select value={simRoom} onChange={(e) => setSimRoom(e.target.value)}>
                <option value="">--</option>
                {rooms.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </label>{" "}
            <button className="btn" onClick={simByRoom}>Sim Room</button>
          </div>
          <div>
            <label>X: <input type="number" value={simX} onChange={(e) => setSimX(e.target.value)} style={{ width: 60 }} /></label>{" "}
            <label>Y: <input type="number" value={simY} onChange={(e) => setSimY(e.target.value)} style={{ width: 60 }} /></label>{" "}
            <button className="btn" onClick={simByPosition}>Sim Position</button>
          </div>
        </div>
      </section>

      {/* Recorder */}
      <section style={{ marginBottom: "1.5rem" }}>
        <h2>Recorder</h2>
        <button className="btn" onClick={toggleRecording}
          style={{ background: recording ? "var(--red, #ef4444)" : undefined }}>
          {recording ? "Stop Recording" : "Start Recording"}
        </button>
        {recordId && (
          <p style={{ marginTop: "0.5rem", color: "var(--muted)" }}>Session: {recordId}</p>
        )}
      </section>

      {lastUpdate > 0 && (
        <p style={{ color: "var(--muted)", fontSize: "0.8rem" }}>
          Last update: {new Date(lastUpdate).toLocaleTimeString()}
        </p>
      )}
    </div>
  );
}
