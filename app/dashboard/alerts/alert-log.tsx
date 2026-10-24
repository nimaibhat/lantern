"use client";

import { useEffect, useState } from "react";
import type { RiskKind, RiskState } from "@/lib/types";

const MONITOR = process.env.NEXT_PUBLIC_MONITOR_URL || "http://localhost:8787";

const KIND: Record<RiskKind, string> = {
  "exit-approach": "Near the front door",
  "night-wandering": "Up during quiet hours",
  "kitchen-night": "In the kitchen at night",
  "long-bathroom-stay": "Long bathroom stay",
  "no-movement": "No movement",
};

interface AlertRow {
  id: string;
  channel: "sms" | "call";
  status: "sent" | "delivered" | "acknowledged" | "failed";
  ts: string;
  who: "primary" | "backup";
  kind: RiskKind;
  roomId: string;
}
interface Active { id: string; kind: RiskKind; roomId: string; state: RiskState; trigger: "detected" | "predicted"; startedAt: string }
interface Log { alerts: AlertRow[]; active: Active[]; profile: string; twilio: string }

const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });

// Polls the monitor's GET /alerts. Phone numbers never leave the monitor; rows say primary or backup instead.
export function AlertLog({ roomNames }: { roomNames: Record<string, string> }) {
  const [log, setLog] = useState<Log | null>(null);
  const [offline, setOffline] = useState(false);
  const room = (id: string) => roomNames[id] ?? id;

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const res = await fetch(`${MONITOR}/alerts`, { cache: "no-store", signal: AbortSignal.timeout(1800) });
        if (!res.ok) throw new Error(String(res.status));
        const next = (await res.json()) as Log;
        if (alive) (setLog(next), setOffline(false));
      } catch {
        if (alive) setOffline(true);
      }
    };
    poll();
    const id = setInterval(poll, 2000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  return (
    <div className="alerts">
      <div className="page-head">
        <div>
          <h1>Alerts</h1>
          <p className="muted">Every message sent to a caregiver, with the room and time. Lantern redirects first and only messages when that does not work.</p>
        </div>
        {log && (
          <div className="alerts-chips">
            <span className="badge">{log.profile} timing</span>
            <span className={log.twilio === "live" ? "badge resolved" : "badge medium"}>Twilio {log.twilio}</span>
          </div>
        )}
      </div>

      {offline && !log && <p className="card muted">The monitor is not reachable at {MONITOR}. Start it with npm run dev:monitor.</p>}

      {log && log.active.length > 0 && (
        <section className="card">
          <div className="card-head">
            <h2>Happening now</h2>
          </div>
          <ul className="rows">
            {log.active.map((r) => (
              <li key={r.id} className="risk-row">
                <div>
                  <strong>{KIND[r.kind]}</strong>
                  <span className="muted">
                    {room(r.roomId)} · since {clock(r.startedAt)} · {r.trigger === "predicted" ? "predicted before arriving" : "detected"}
                  </span>
                </div>
                <span className={`badge ${r.state}`}>{r.state === "redirecting" ? "redirect playing" : r.state}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {log && (
        <section className="card">
          <div className="card-head">
            <h2>Messages</h2>
            {offline && <span className="muted mono">monitor offline, last known</span>}
          </div>
          {log.alerts.length === 0 ? (
            <p className="muted">No messages yet. When a redirect brings them back in time, nobody is woken.</p>
          ) : (
            <table className="alerts-table">
              <thead>
                <tr><th>Time</th><th>What happened</th><th>Sent</th><th>To</th><th>Status</th></tr>
              </thead>
              <tbody>
                {log.alerts.map((a) => (
                  <tr key={a.id}>
                    <td className="mono">{clock(a.ts)}</td>
                    <td>{KIND[a.kind]}, {room(a.roomId).toLowerCase()}</td>
                    <td>{a.channel === "sms" ? "Text" : "Call"}</td>
                    <td>{a.who === "primary" ? "Primary contact" : "Backup contact"}</td>
                    <td><span className={`badge ${a.status === "acknowledged" ? "resolved" : a.status === "failed" ? "high" : "medium"}`}>{a.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </div>
  );
}
