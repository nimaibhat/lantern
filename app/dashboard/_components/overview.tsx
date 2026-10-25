"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { roomName } from "@/lib/dashboard/rooms";
import type { Activity, AuditItem, Household, Receiver, RiskEvent, Room, ScanSummary } from "@/lib/types";
import { pointInPolygon } from "@/lib/world/geometry";
import { FloorPlan } from "./floor-plan";
import { strength, type PlanSensor } from "./live-layer";
import { SayToTv } from "./say-to-tv";
import { useMonitorLive } from "./use-monitor-live";

const minutes = (s: number) => (s < 60 ? "under a minute" : `${Math.round(s / 60)} min`);
const hhmm = (iso: string) => new Date(iso).toTimeString().slice(0, 5);

// What Lantern is doing about a risk right now, in words (docs/cues.md).
function progress(r: RiskEvent, name: string): string | undefined {
  if (r.state === "detected" && r.graceUntil && Date.parse(r.graceUntil) > Date.now()) return `giving ${name} time until ${hhmm(r.graceUntil)}`;
  if (r.cues && r.state !== "resolved") return r.cues === 1 ? "1 reminder so far" : `${r.cues} reminders so far`;
  if (r.state === "resolved" && r.cues) return r.cues === 1 ? "back after 1 reminder" : `back after ${r.cues} reminders`;
}

const RISK_LABEL: Record<RiskEvent["kind"], string> = {
  "exit-approach": "Near the front door",
  "night-wandering": "Up during quiet hours",
  "kitchen-night": "In the kitchen at night",
  "long-bathroom-stay": "Long bathroom stay",
  "no-movement": "No movement",
};

type Props = {
  household: Household;
  rooms: Room[];
  receivers: Receiver[];
  auditItems: AuditItem[];
  activity: Activity[];
  risks: RiskEvent[];
  scan: ScanSummary | null;
};

export function Overview({ household, rooms, receivers, auditItems, scan, ...initial }: Props) {
  const { roomId, since, entries, risks, connected, listeners, listenersOnline, rssi, placed, registered, place, source, tag, dwell, feed, live, spreadFt } = useMonitorLive({ rooms, receivers, ...initial });
  const [editing, setEditing] = useState(false); // the sensor list lets you change where each device stands
  const [pinning, setPinning] = useState<string>(); // the device whose spot the next click on the plan sets
  const [placeNote, setPlaceNote] = useState("");

  useEffect(() => {
    if (!pinning) return;
    const cancel = (e: KeyboardEvent) => e.key === "Escape" && setPinning(undefined);
    window.addEventListener("keydown", cancel);
    return () => window.removeEventListener("keydown", cancel);
  }, [pinning]);

  async function setWhere(id: string, where: { roomId?: string; position?: { x: number; y: number } }) {
    setPlaceNote("");
    const error = await place(id, where);
    if (error) setPlaceNote(error);
  }

  // One list of sensors, whoever registered them: the monitor's listeners and placements, plus Tracking laptops that
  // reported recently. Named the way Tracking names them, standing in the room their placement falls in.
  const sensors = useMemo(() => {
    const saved = new Map(registered.map((r) => [r.id, r]));
    const ids = connected
      ? new Set([...Object.keys(listeners), ...placed.map((p) => p.receiverId), ...registered.filter((r) => r.online).map((r) => r.id)])
      : new Set(registered.map((r) => r.id));
    return [...ids]
      .map((id) => {
        const at = placed.find((p) => p.receiverId === id)?.position;
        // The room its spot falls in; a spot right on a wall keeps the room it was saved with
        const room = (at && rooms.find((r) => r.outline.length >= 3 && pointInPolygon(at, r.outline))) || rooms.find((r) => r.id === saved.get(id)?.roomId);
        const online = connected ? !!listeners[id] : !!saved.get(id)?.online;
        return { id, label: saved.get(id)?.label || id.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase()), at, room, online, rssi: online ? rssi[id] : undefined };
      })
      // A steady order, so rows do not move under the pointer as signals change
      .sort((a, b) => Number(b.online) - Number(a.online) || a.label.localeCompare(b.label));
  }, [registered, rooms, connected, listeners, placed, rssi]);
  const onPlan: PlanSensor[] = sensors.filter((s) => s.at).map((s) => ({ id: s.id, x: s.at!.x, y: s.at!.y, label: s.label, rssi: s.rssi, online: s.online }));
  const hearing = sensors.filter((s) => s.rssi !== undefined).length;
  const tracked = live || !!feed();

  // Minutes per room today, largest first, named the way the scan names them.
  const today = Object.entries(dwell?.todayS ?? {}).filter(([, s]) => s >= 60).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const most = today[0]?.[1] ?? 1;
  const openAudit = auditItems.filter((a) => a.status === "open");
  const high = openAudit.filter((a) => a.severity === "high").length;
  const online = sensors.filter((s) => s.online).length;
  // Only meaningful while listeners are up; with none online the receiver count already says what is wrong.
  const tagLost = connected && listenersOnline > 0 && tag && !tag.online;

  return (
    <div className="overview">
      <section className="card plan-card">
        <div className="card-head">
          <h2>Home</h2>
          <span className="card-chips">
            {pinning && (
              <span className="pin-note" role="status">
                Click where {sensors.find((s) => s.id === pinning)?.label ?? "it"} sits{" "}
                <button className="link-btn" onClick={() => setPinning(undefined)}>Cancel</button>
              </span>
            )}
            {source === "sim" && <span className="badge sim">Simulated</span>}
            <span className="muted mono">{connected ? (live ? "live position" : "live") : "offline"}</span>
          </span>
        </div>
        <FloorPlan rooms={rooms} currentRoomId={roomId} live={{ feed, state: live ? "fresh" : tracked ? "stale" : "none" }}
          sensors={onPlan}
          onPick={
            pinning
              ? (p) => {
                  const id = pinning;
                  setPinning(undefined);
                  void setWhere(id, { position: p });
                }
              : undefined
          }
        />
      </section>

      <section className="card now-card">
        <p className="eyebrow">{household.patientName} is in the</p>
        <p className="now-room">{roomName(rooms, roomId)}</p>
        <p className="muted">
          since {since}
          {dwell?.roomId && ` · ${minutes(dwell.inRoomS)}`}
        </p>
        {live && spreadFt !== undefined && (
          <p className="muted pinpoint">
            Within about {spreadFt} ft, heard by {hearing} {hearing === 1 ? "sensor" : "sensors"}
          </p>
        )}
        {dwell?.outOfBedS !== undefined && (
          <p className="out-of-bed" role="status">
            Out of bed for {minutes(dwell.outOfBedS)}
          </p>
        )}
        {tagLost && (
          <p className="tag-warn" role="status">
            {household.patientName}&apos;s tag has not been heard {tag.lastSeen ? `for ${Math.max(1, Math.round((Date.now() - tag.lastSeen) / 60_000))} min` : "yet"}.
            Check that it is worn and switched on.
          </p>
        )}
        <div className="stats">
          <div>
            <span className="stat">{online}/{sensors.length}</span>
            <span className="muted">sensors online</span>
          </div>
          <div>
            <span className="stat">{household.quietHoursStart}</span>
            <span className="muted">quiet hours start</span>
          </div>
        </div>
        {sensors.length > 0 && (
          <div className="sensor-head">
            <span className="muted">Sensors</span>
            <button
              className="link-btn"
              onClick={() => {
                setEditing(!editing);
                setPinning(undefined);
              }}
            >
              {editing ? "Done" : "Set locations"}
            </button>
          </div>
        )}
        {sensors.length > 0 && (
          <ul className={editing ? "sensor-list editing" : "sensor-list"} aria-label="Sensors">
            {sensors.map((s) => {
              const bars = s.rssi === undefined ? 0 : Math.max(1, Math.ceil(strength(s.rssi) * 4));
              return (
                <li key={s.id} className={s.online ? undefined : "off"}>
                  <span className="sensor-name" title={s.id}>{s.label}</span>
                  {editing || !s.at ? (
                    <select
                      className="sensor-room"
                      value={s.room?.id ?? ""}
                      onChange={(e) => e.target.value && void setWhere(s.id, { roomId: e.target.value })}
                      aria-label={`Where ${s.label} stands`}
                    >
                      <option value="">{s.at ? "Between rooms" : "Set room"}</option>
                      {rooms.map((r) => (
                        <option key={r.id} value={r.id}>{r.name}</option>
                      ))}
                    </select>
                  ) : (
                    <span className="muted sensor-room">{s.room?.name ?? "between rooms"}</span>
                  )}
                  <span className="sensor-bars" aria-hidden>
                    {[1, 2, 3, 4].map((i) => <i key={i} className={i <= bars ? "on" : undefined} />)}
                  </span>
                  <span className="mono muted">{!s.online ? "off" : s.rssi === undefined ? "quiet" : s.rssi}</span>
                  {editing && (
                    <button
                      className={pinning === s.id ? "pin-btn on" : "pin-btn"}
                      onClick={() => setPinning(pinning === s.id ? undefined : s.id)}
                      title="Then click its exact spot on the plan"
                    >
                      Pin
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {placeNote && <p className="tag-warn" role="status">{placeNote}</p>}
        {!editing && sensors.some((s) => s.online && !s.at) && (
          <p className="muted sensor-hint">
            Set the room for each new sensor so it can help find {household.patientName}. Pin it on the plan for the closest fix.
          </p>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Risk events</h2>
        </div>
        {risks.length === 0 && <p className="muted">Nothing today.</p>}
        <ul className="risk-list">
          {risks.slice(0, 4).map((r) => (
            <li key={r.id} className="risk-row">
              <div>
                <strong>{RISK_LABEL[r.kind]}</strong>
                <span className="muted">
                  {r.startedAt} · {roomName(rooms, r.roomId)} · {r.trigger === "predicted" ? "predicted" : "detected"}
                  {r.source === "sim" && " · simulated"}
                </span>
                {progress(r, household.patientName) && <span className="risk-progress">{progress(r, household.patientName)}</span>}
              </div>
              <span className={`badge ${r.state}`}>{r.state}</span>
            </li>
          ))}
        </ul>
      </section>

      <SayToTv name={household.patientName} />

      <section className="card">
        <div className="card-head">
          <h2>Time today</h2>
        </div>
        {today.length === 0 && <p className="muted">{dwell ? "Not enough time in any room yet." : "Live once the monitor is running."}</p>}
        <ul className="dwell-list">
          {today.map(([id, s]) => (
            <li key={id}>
              <span>{roomName(rooms, id)}</span>
              <span className="dwell-bar" aria-hidden>
                <span style={{ width: `${Math.max(4, Math.round((s / most) * 100))}%` }} />
              </span>
              <span className="mono muted">{minutes(s)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Home audit</h2>
          <Link href="/dashboard/audit">Open report</Link>
        </div>
        <p className="stat">{openAudit.length}</p>
        <p className="muted">open items, {high} high priority</p>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Home scan</h2>
          <Link href="/dashboard/rooms">Rooms</Link>
        </div>
        {scan ? (
          <>
            <p className="stat">{scan.rooms} rooms</p>
            <p className="muted">
              Scanned {scan.createdAt} · <span className={`badge ${scan.status === "done" ? "resolved" : scan.status === "failed" ? "escalated" : "detected"}`}>{scan.status}</span>
            </p>
          </>
        ) : (
          <p className="muted">No scan yet. Pair a phone in Settings to scan the home.</p>
        )}
      </section>

      <section className="card timeline-card">
        <div className="card-head">
          <h2>Today</h2>
        </div>
        <ol className="timeline">
          {[...entries].reverse().map((e) => (
            <li key={e.id} className={`tl-${e.kind}`}>
              <span className="mono muted">{e.time}</span>
              <span>{e.text}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
