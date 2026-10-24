"use client";

import { useEffect, useState } from "react";
import type { InferenceDebug } from "@/monitor/inference/engine";
import { pct, roomName } from "./names";

const MONITOR = process.env.NEXT_PUBLIC_MONITOR_URL ?? "http://localhost:8787";
const FLOOR = -100, LOUD = -40; // dBm range for the listener meters

// What the classifier sees right now, from the monitor's GET /debug/inference. Useful while calibrating.
export function LivePanel() {
  const [data, setData] = useState<InferenceDebug | null>(null);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let alive = true;
    async function poll() {
      try {
        const res = await fetch(`${MONITOR}/debug/inference`, { cache: "no-store", signal: AbortSignal.timeout(900) });
        if (!res.ok) throw new Error(String(res.status));
        const next = (await res.json()) as InferenceDebug;
        if (alive) { setData(next); setOffline(false); }
      } catch {
        if (alive) setOffline(true);
      }
    }
    poll();
    const id = setInterval(poll, 1000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  if (offline || !data) {
    return (
      <section className="card m-live-off">
        <span className="m-live-dot off" />
        <p className="muted">
          {offline ? "Live view: the monitor is not reachable at " : "Live view: connecting to "}
          <span className="mono">{MONITOR}</span>. It appears here while the monitor runs.
        </p>
      </section>
    );
  }

  const heardAgo = data.lastHeardTs ? Math.max(0, ((data.serverTs ?? Date.now()) - data.lastHeardTs) / 1000) : undefined;
  const rooms = data.rooms;
  const listeners = Object.entries(data.listeners ?? {});

  return (
    <section className="card m-wide m-live">
      <div className="card-head">
        <h2><span className="m-live-dot" /> Live</h2>
        <span className="mono muted">{data.classifier}{data.hmm ? " + door graph" : ""}</span>
      </div>

      <div className="m-live-grid">
        <div>
          <p className="eyebrow">Room now</p>
          <span className="stat">{data.room ? roomName(data.room) : "Not sure yet"}</span>
          <p className="muted">
            {data.room ? `${pct(data.confidence)} sure` : "Needs two steady seconds"}
            {data.candidate ? `, considering ${roomName(data.candidate)}` : ""}
          </p>
          {data.lastPrediction && data.lastPrediction.fromRoomId === data.room && (
            <p className="muted">Next: {roomName(data.lastPrediction.nextRoomId)} ({pct(data.lastPrediction.probability)})</p>
          )}
          <p className={heardAgo !== undefined && heardAgo > 5 ? "error" : "muted"}>
            {heardAgo === undefined ? "Tag not heard yet" : heardAgo > 5 ? `Tag silent for ${Math.round(heardAgo)} s` : "Tag heard just now"}
          </p>
        </div>

        <div>
          <p className="eyebrow">Listeners</p>
          <ul className="m-bars">
            {listeners.map(([id, l]) => {
              const share = Math.min(1, Math.max(0, (l.rssi - FLOOR) / (LOUD - FLOOR)));
              return (
                <li key={id} title={`${roomName(id)} listener: ${l.online ? (l.rssi > FLOOR ? `${l.rssi} dBm` : "online, not hearing the tag") : "offline"}`}>
                  <span>{roomName(id)}</span>
                  <span className="m-track"><span className="m-bar m-accent" style={{ width: `${share * 100}%` }} /></span>
                  <span className="mono">{!l.online ? "offline" : l.rssi > FLOOR ? `${l.rssi} dBm` : "silent"}</span>
                </li>
              );
            })}
          </ul>
        </div>

        <div>
          <p className="eyebrow">Which room</p>
          <div className="m-legend">
            <span><i className="m-swatch m-accent" /> With door graph</span>
            <span><i className="m-swatch m-context" /> Classifier alone</span>
          </div>
          <ul className="m-rooms">
            {rooms.map((r) => {
              const b = data.belief?.[r] ?? 0, c = data.posterior?.[r] ?? 0;
              return (
                <li key={r} title={`${roomName(r)}: ${pct(b)} with the door graph, ${pct(c)} from the classifier alone`}>
                  <span>{roomName(r)}</span>
                  <span className="m-pair">
                    <span className="m-bar m-accent" style={{ width: `${b * 100}%` }} />
                    <span className="m-bar m-context" style={{ width: `${c * 100}%` }} />
                  </span>
                  <span className="mono">{pct(b)}</span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </section>
  );
}
