"use client";

import Link from "next/link";
import { roomName } from "@/lib/dashboard/rooms";
import type { Activity, AuditItem, Household, Receiver, RiskEvent, Room, ScanSummary } from "@/lib/types";
import { FloorPlan } from "./floor-plan";
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
  const { roomId, since, entries, risks, connected, listenersOnline, source, tag, dwell } = useMonitorLive({ rooms, receivers, ...initial });
  // Minutes per room today, largest first, named the way the scan names them.
  const today = Object.entries(dwell?.todayS ?? {}).filter(([, s]) => s >= 60).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const most = today[0]?.[1] ?? 1;
  const openAudit = auditItems.filter((a) => a.status === "open");
  const high = openAudit.filter((a) => a.severity === "high").length;
  const online = connected ? listenersOnline : receivers.filter((r) => r.online).length;
  // Only meaningful while listeners are up; with none online the receiver count already says what is wrong.
  const tagLost = connected && listenersOnline > 0 && tag && !tag.online;

  return (
    <div className="overview">
      <section className="card plan-card">
        <div className="card-head">
          <h2>Home</h2>
          <span className="card-chips">
            {source === "sim" && <span className="badge sim">Simulated</span>}
            <span className="muted mono">{connected ? "live" : "offline"}</span>
          </span>
        </div>
        <FloorPlan rooms={rooms} currentRoomId={roomId} />
      </section>

      <section className="card now-card">
        <p className="eyebrow">{household.patientName} is in the</p>
        <p className="now-room">{roomName(rooms, roomId)}</p>
        <p className="muted">
          since {since}
          {dwell?.roomId && ` · ${minutes(dwell.inRoomS)}`}
        </p>
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
