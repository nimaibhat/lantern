"use client";

import { useEffect, useState } from "react";
import type { RiskKind, RiskTrigger } from "@/lib/types";

const MONITOR = process.env.NEXT_PUBLIC_MONITOR_URL || "http://localhost:8787";

const KIND: Record<RiskKind, string> = {
  "exit-approach": "Near the front door",
  "night-wandering": "Up during quiet hours",
  "kitchen-night": "In the kitchen at night",
  "long-bathroom-stay": "Long bathroom stay",
  "no-movement": "No movement",
};

// GET /analytics/summary (monitor/actions/analytics.ts)
interface Outcome { id: string; kind: RiskKind; roomId: string; trigger: RiskTrigger; startedAt: string; resolvedAt?: string; escalated: boolean; arrived: boolean }
interface Summary {
  responses: number;
  open: number;
  workedWithoutMessage: number;
  escalated: number;
  falseRedirects: number;
  medianReturnS?: number;
  recent: Outcome[];
  night?: string; // last night in one paragraph
  workedAfterCue?: Record<string, number>; // "0" settled on their own, "1" after the first reminder, ...
}

const ORDINAL = ["on their own", "after the first reminder", "after the second", "after the third"];

// "Which reminder works": the families' and the OT's quickest read on whether the cues help.
function whatWorks(by: Record<string, number> = {}): string | undefined {
  const parts = Object.entries(by).sort(([a], [b]) => Number(a) - Number(b)).map(([k, n]) => `${n} ${ORDINAL[Number(k)] ?? `after ${k} reminders`}`);
  return parts.length ? parts.join(" · ") : undefined;
}

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

function ending(o: Outcome) {
  if (!o.resolvedAt) return { text: "happening now", badge: "redirecting" };
  if (!o.arrived) return { text: "predicted, did not come", badge: "" };
  if (o.escalated) return { text: "caregiver messaged", badge: "escalated" };
  const s = Math.round((Date.parse(o.resolvedAt) - Date.parse(o.startedAt)) / 1000);
  return { text: `back in ${s} s, nobody woken`, badge: "resolved" };
}

// How each response since the monitor started ended. Polled, like the alert log.
export function Tonight({ roomNames }: { roomNames: Record<string, string> }) {
  const [s, setS] = useState<Summary | null>(null);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const res = await fetch(`${MONITOR}/analytics/summary`, { cache: "no-store", signal: AbortSignal.timeout(1800) });
        if (!res.ok) throw new Error(String(res.status));
        const next = (await res.json()) as Summary;
        if (alive) (setS(next), setOffline(false));
      } catch {
        if (alive) setOffline(true);
      }
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  return (
    <section className="card">
      <div className="card-head">
        <h2>Tonight</h2>
        <span className="mono muted">{offline ? "monitor offline" : "since the monitor started"}</span>
      </div>
      {!s ? (
        <p className="muted">{offline ? `The monitor is not reachable at ${MONITOR}. Start it with npm run dev:monitor.` : "Loading..."}</p>
      ) : (
        <>
          {s.night && <p className="a-night">{s.night}</p>}
          {whatWorks(s.workedAfterCue) && <p className="muted a-works">Back without a message: {whatWorks(s.workedAfterCue)}</p>}
          <div className="a-tonight">
            <div>
              <span className="stat">{s.responses}</span>
              <span className="muted">responses</span>
            </div>
            <div>
              <span className="stat">{s.workedWithoutMessage}</span>
              <span className="muted">back without waking anyone</span>
            </div>
            <div>
              <span className="stat">{s.escalated}</span>
              <span className="muted">caregiver messaged</span>
            </div>
            <div>
              <span className="stat">{s.medianReturnS === undefined ? "-" : `${Math.round(s.medianReturnS)} s`}</span>
              <span className="muted">median time to return</span>
            </div>
            <div>
              <span className="stat">{s.falseRedirects}</span>
              <span className="muted">false alarms</span>
            </div>
          </div>
          {s.recent.length > 0 && (
            <ul className="rows a-recent">
              {s.recent.slice(0, 6).map((o) => {
                const e = ending(o);
                return (
                  <li key={o.id} className="risk-row">
                    <div>
                      <strong>{KIND[o.kind]}</strong>
                      <span className="muted">
                        {time(o.startedAt)} · {roomNames[o.roomId] ?? o.roomId} · {o.trigger}
                      </span>
                    </div>
                    <span className={`badge ${e.badge}`}>{e.text}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
