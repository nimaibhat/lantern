"use client";

// The live part of the Now page plan: every sensor where it stands, a line from each sensor that hears the tag to the
// person (stronger the louder the signal), and the person on top. The lines follow the drawn dot every frame, so they
// never trail behind it.

import { useCallback, useRef } from "react";
import { LiveMarker, type LiveFeed } from "@/components/world/live-marker";
import { roughFeet } from "@/lib/sensing/feet";
import type { Vec2 } from "@/lib/types";

export interface PlanSensor { id: string; x: number; y: number; label: string; rssi?: number; online: boolean }

// Past this the estimate is only "far" (the formula stops at 45 ft), so the plan shows no number
export const FAR_FT = 40;

// About -95 dBm is the edge of hearing, -50 is right next to it.
export const strength = (rssi?: number) => (rssi === undefined ? 0 : Math.max(0, Math.min(1, (rssi + 95) / 45)));

export function LiveLayer({ feed, stale, sensors }: { feed?: () => LiveFeed | undefined; stale?: boolean; sensors: PlanSensor[] }) {
  const links = useRef(new Map<string, SVGLineElement>());
  const onFrame = useCallback((p: Vec2 | undefined) => {
    for (const line of links.current.values()) {
      line.setAttribute("x2", String(p ? p.x : line.x1.baseVal.value));
      line.setAttribute("y2", String(p ? p.y : line.y1.baseVal.value));
    }
  }, []);

  const heard = sensors.filter((s) => s.online && s.rssi !== undefined);
  const nearest = heard.length ? heard.reduce((a, b) => ((b.rssi ?? -200) > (a.rssi ?? -200) ? b : a)).id : undefined;

  return (
    <g className={stale ? "fp-live stale" : "fp-live"}>
      {feed &&
        sensors.map((s) => {
          const k = s.online ? strength(s.rssi) : 0;
          return (
            <line
              key={s.id}
              ref={(el) => {
                if (el) links.current.set(s.id, el);
                else links.current.delete(s.id);
              }}
              className="fp-link"
              x1={s.x}
              y1={s.y}
              x2={s.x}
              y2={s.y}
              strokeWidth={1 + 2.5 * k}
              opacity={k ? 0.15 + 0.6 * k : 0}
            />
          );
        })}

      {sensors.map((s) => {
        const k = s.online ? strength(s.rssi) : 0;
        return (
          <g key={s.id} className={`fp-sensor${s.online ? "" : " off"}${s.id === nearest ? " near" : ""}`} transform={`translate(${s.x} ${s.y})`}>
            <title>{`${s.label}${s.online && s.rssi !== undefined ? `, ${s.rssi} dBm` : s.online ? "" : ", offline"}`}</title>
            <circle className="fp-sensor-ring" r={8 + 10 * k} />
            <rect x={-5} y={-5} width={10} height={10} rx={2.5} />
            {s.online && s.rssi !== undefined && roughFeet(s.rssi) < FAR_FT && (
              <text className="fp-sensor-db" y={19}>
                {Math.round(roughFeet(s.rssi))} ft
              </text>
            )}
          </g>
        );
      })}

      {feed && <LiveMarker feed={feed} onFrame={onFrame} trail={false} />}
    </g>
  );
}
