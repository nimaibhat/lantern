"use client";

import Link from "next/link";
import { roomName } from "@/lib/dashboard/rooms";
import type { Activity, AuditItem, Household, Receiver, RiskEvent, Room, ScanSummary } from "@/lib/types";
import { FloorPlan } from "./floor-plan";

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
  const { roomId, since, entries, risks, connected, listenersOnline, source, tag } = useMonitorLive({ rooms, receivers, ...initial });
  const openAudit = auditItems.filter((a) => a.status === "open");
  const high = openAudit.filter((a) => a.severity === "high").length;
  // Only meaningful while listeners are up; with none online the receiver count already says what is wrong.
  const tagLost = connected && listenersOnline > 0 && tag && !tag.online;

  return (
    <div className="overview">
      <section className="card plan-card">
        <div className="card-head">
          <h2>Home</h2>
          <span className="card-chips">
            {source === "sim" && <span className="badge sim">Simulated</span>}
          </span>
        </div>
        <FloorPlan rooms={rooms} currentRoomId={roomId} />
      </section>

      <section className="card now-card">
        <p className="eyebrow">{household.patientName} is in the</p>
        <p className="now-room">{roomName(rooms, roomId)}</p>
        <p className="muted">since {since}</p>
        {tagLost && (
          <p className="tag-warn" role="status">
            {household.patientName}&apos;s tag has not been heard {tag.lastSeen ? `for ${Math.max(1, Math.round((Date.now() - tag.lastSeen) / 60_000))} min` : "yet"}.
            Check that it is worn and switched on.
          </p>
        )}
        <div className="stats">
          <div>
            <span className="stat">{online}/{receivers.length}</span>
            <span className="muted">receivers online</span>
          </div>
          <div>
            <span className="stat">{household.quietHoursStart}</span>
            <span className="muted">quiet hours start</span>
          </div>
        </div>
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
              </div>
              <span className={`badge ${r.state}`}>{r.state}</span>
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
