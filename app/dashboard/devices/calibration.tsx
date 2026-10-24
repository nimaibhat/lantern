"use client";

import { useEffect, useState } from "react";

const MONITOR_URL = process.env.NEXT_PUBLIC_MONITOR_URL || "http://localhost:8787";
const POLL_MS = 1000;

type Status = { active: { session: string; roomId: string; file: string } | null; windowsPerRoom: Record<string, number>; target: number };

// Calibration: carry the tag phone in each room for about 2 minutes while this records labeled readings.
// Pick the room you are standing in (not a laptop's room). Do 3 separate sessions per room.
export function Calibration({ rooms }: { rooms: { id: string; name: string }[] }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [roomId, setRoomId] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let stop = false;
    const poll = async () => {
      try {
        const r = await fetch(`${MONITOR_URL}/calibrate/status`);
        const data = await r.json();
        if (!stop) setStatus(r.ok && data?.windowsPerRoom ? data : null);
      } catch {
        if (!stop) setStatus(null);
      }
    };
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (!roomId && rooms[0]) setRoomId(rooms[0].id);
  }, [rooms, roomId]);

  async function call(path: string, body?: unknown) {
    setError("");
    const r = await fetch(`${MONITOR_URL}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
    if (!r.ok) setError(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `monitor returned ${r.status}`);
  }

  const active = status?.active;
  const target = status?.target ?? 120;

  return (
    <section style={{ marginBottom: "1.5rem" }}>
      <h2>Calibration</h2>
      {!status && <p className="muted">The monitor is not reachable. Start it with npm run dev:monitor.</p>}
      {status && (
        <div className="card">
          <p className="muted">Stand in a room with the tag phone and walk slowly around it, near the doors and corners, for about 2 minutes. Record 3 separate sessions per room.</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", margin: "12px 0" }}>
            <select value={roomId} onChange={(e) => setRoomId(e.target.value)} aria-label="Room you are standing in">
              {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            {active ? (
              <>
                <button className="btn" onClick={() => call("/calibrate/start", { roomId })} disabled={roomId === active.roomId}>
                  I moved to this room
                </button>
                <button className="btn alert" onClick={() => call("/calibrate/stop")}>Stop</button>
              </>
            ) : (
              <button className="btn" onClick={() => call("/calibrate/start", { roomId })} disabled={!roomId}>Start recording</button>
            )}
          </div>
          {active && <p className="mono">Recording {active.session} in {active.roomId} → {active.file}</p>}
          {active && Object.values(status.windowsPerRoom).every((n) => !n) && (
            <p className="muted">Recording, but no tag has been heard. The bars stay empty until a listener hears LanternTag. This laptop can listen or be the tag, not both.</p>
          )}
          {error && <p className="error">{error}</p>}
          <ul style={{ listStyle: "none", display: "grid", gap: 6, marginTop: 10 }}>
            {rooms.map((r) => {
              const n = status.windowsPerRoom[r.id] ?? 0;
              return (
                <li key={r.id} style={{ display: "grid", gridTemplateColumns: "120px 1fr 70px", gap: 10, alignItems: "center" }}>
                  <span>{r.name}</span>
                  <span className="bar"><span style={{ width: `${Math.min(100, (n / target) * 100)}%` }} /></span>
                  <span className="mono muted">{n} / {target}</span>
                </li>
              );
            })}
          </ul>
          <p className="muted" style={{ marginTop: 10 }}>Then tell Vineet to run <span className="mono">python ml/check_data.py</span> and <span className="mono">python ml/train.py</span>.</p>
        </div>
      )}
    </section>
  );
}
