"use client";

// The home as a to-scale floor plan: SVG in plan inches (x right, y down), drawn from the same LiveState as the
// 3D scene so the two views always agree. No WebGL, so it opens at once and is the fallback when 3D cannot run.
// The avatar glides between 5 Hz positions in a requestAnimationFrame loop that writes its transform directly,
// so motion never waits on a React render of the plan.

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MobilityLeg } from "@/lib/audit/mobility";
import type { HomeModel, RiskState, Vec2 } from "@/lib/types";
import { bounds, closestOnSegment, distance, polygonArea, roomAt, routeBetween } from "@/lib/world/geometry";
import { riskByRoom, type LiveState } from "@/lib/world/live-state";
import { ftIn } from "@/lib/world/units";
import { doorAxis, wallPieces } from "@/lib/world/walls";
import { AMBER, FLOOR, HERE, LISTENER, LISTENER_OFF, RISK_FLOOR, ROUTE_BLOCKED, ROUTE_OK } from "./palette";
import "./plan-2d.css";

const PAD = 36; // inches of margin around the plan
const WALL_IN = 5; // drawn wall thickness
const GLIDE = 12; // per second: about 90 percent of the way to a 5 Hz position before the next one lands
const JUMP_IN = 120; // farther than this (tag re-acquired after a silence) snaps rather than gliding through walls
const SNAP_IN = 4; // the tape measure snaps to a wall this close, for wall-to-wall readings
const MIN_VIEW_IN = 48;

type View = { x: number; y: number; w: number; h: number };
const pts = (ps: Vec2[]) => ps.map((p) => `${p.x},${p.y}`).join(" ");

export interface Plan2DProps {
  state: LiveState;
  dragMode?: boolean;
  onDrag?(p: Vec2): void; // live position while dragging
  onDrop?(p: Vec2): void; // released: send /sim/position
  ghost?: Vec2;
  mobility?: MobilityLeg[];
  measure?: boolean; // room sizes, door widths, scale bar and the tape measure
  fitSignal?: number; // change it to zoom back out to the whole home
}

export function Plan2D({ state, dragMode, onDrag, onDrop, ghost, mobility, measure, fitSignal }: Plan2DProps) {
  const { home, position, room, prediction, trail } = state;
  const svg = useRef<SVGSVGElement>(null);
  const fit = useMemo<View>(() => {
    const b = bounds(home.rooms.flatMap((r) => r.polygon));
    return { x: b.minX - PAD, y: b.minY - PAD, w: b.width + 2 * PAD, h: b.height + 2 * PAD };
  }, [home]);
  const [view, setView] = useState<View>(fit);
  useEffect(() => setView(fit), [fit, fitSignal]);

  const toPlan = useCallback((clientX: number, clientY: number): Vec2 | undefined => {
    const el = svg.current, ctm = el?.getScreenCTM();
    if (!el || !ctm) return;
    const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  }, []);

  // Wheel zooms around the cursor. Native listener: React's wheel handler is passive and cannot stop page scroll.
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = toPlan(e.clientX, e.clientY);
      if (!p) return;
      const f = Math.exp(Math.max(-1, Math.min(1, e.deltaY / 300)));
      setView((v) => {
        const w = Math.max(MIN_VIEW_IN, Math.min(fit.w * 3, v.w * f)), k = w / v.w;
        return { x: p.x - (p.x - v.x) * k, y: p.y - (p.y - v.y) * k, w, h: v.h * k };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [fit.w, toPlan]);

  // One pointer handler for three jobs: move the person (drag to simulate), the tape measure, or pan.
  const walls = useMemo(() => wallPieces(home), [home]);
  const [tape, setTape] = useState<{ a: Vec2; b: Vec2 }>();
  const gesture = useRef<{ kind: "sim" | "tape" | "pan"; start?: Vec2; last?: Vec2 } | undefined>(undefined);
  const snap = (p: Vec2) => {
    let best = p, bestD = SNAP_IN;
    for (const [a, b] of walls) {
      const q = closestOnSegment(p, a, b), d = distance(p, q);
      if (d < bestD) [best, bestD] = [q, d];
    }
    return best;
  };

  function down(e: React.PointerEvent<SVGSVGElement>) {
    const p = toPlan(e.clientX, e.clientY);
    if (!p) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    if (dragMode && onDrag) {
      gesture.current = { kind: "sim" };
      if (roomAt(home, p)) (gesture.current.last = p), onDrag(p);
    } else if (measure) {
      const a = snap(p);
      gesture.current = { kind: "tape", start: a };
      setTape({ a, b: a });
    } else {
      gesture.current = { kind: "pan", start: p };
    }
  }
  function move(e: React.PointerEvent<SVGSVGElement>) {
    const g = gesture.current, p = g && toPlan(e.clientX, e.clientY);
    if (!g || !p) return;
    if (g.kind === "sim" && roomAt(home, p)) (g.last = p), onDrag?.(p);
    if (g.kind === "tape" && g.start) setTape({ a: g.start, b: snap(p) });
    if (g.kind === "pan" && g.start) setView((v) => ({ ...v, x: v.x + g.start!.x - p.x, y: v.y + g.start!.y - p.y }));
  }
  function up() {
    const g = gesture.current;
    gesture.current = undefined;
    if (g?.kind === "sim" && g.last) onDrop?.(g.last);
  }

  const risks = useMemo(() => riskByRoom(state), [state.risks]); // reads only risks; stable so PlanBase stays memoized
  const next = prediction ? home.rooms.find((r) => r.id === prediction.nextRoomId) : undefined;
  const predicted = useMemo(() => (next && room ? routeBetween(home, room, next.id) : []), [home, room, next]);
  const target = ghost ?? (position ? { x: position.x, y: position.y } : undefined);
  const mode = dragMode ? "sim" : measure ? "measuring" : "";

  return (
    <svg
      ref={svg}
      className={`p2 ${mode}`}
      viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
      preserveAspectRatio="xMidYMid meet"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onDoubleClick={() => setView(fit)}
      role="img"
      aria-label="Floor plan of the home with the person's live position"
    >
      <PlanBase home={home} walls={walls} here={room} risks={risks} next={next?.id} measure={!!measure} />

      {mobility?.map((leg, i) =>
        leg.path.length > 1 ? (
          <g key={i} className="p2-leg">
            <polyline points={pts(leg.path)} stroke={leg.ok ? ROUTE_OK : ROUTE_BLOCKED} strokeWidth={leg.ok ? 2 : 4} opacity={leg.ok ? 0.6 : 1} />
            {leg.blockedAt && <circle cx={leg.blockedAt.x} cy={leg.blockedAt.y} r={7} fill={ROUTE_BLOCKED} />}
          </g>
        ) : null,
      )}

      {predicted.length > 1 && <polyline className="p2-predict" points={pts(predicted)} stroke={AMBER} />}
      {next && prediction && (
        <text className="p2-predict-label" x={next.centroid.x} y={next.centroid.y - 16} textAnchor="middle">
          Predicted {Math.round(prediction.probability * 100)}%
        </text>
      )}

      {trail.slice(1).map((p, i) => (
        <line key={p.ts} x1={trail[i].x} y1={trail[i].y} x2={p.x} y2={p.y} stroke={AMBER} strokeWidth={3} strokeLinecap="round" opacity={0.15 + (0.6 * (i + 1)) / trail.length} />
      ))}

      {home.anchors.map((a) => {
        const online = state.listeners[a.receiverId], rssi = state.rssi[a.receiverId];
        const strength = rssi === undefined ? 0.4 : Math.max(0.15, Math.min(1, (rssi + 100) / 60));
        return (
          <g key={a.receiverId} transform={`translate(${a.position.x} ${a.position.y})`}>
            <title>{`${a.receiverId} listener: ${online === false ? "offline" : rssi !== undefined && rssi > -100 ? `${rssi} dBm` : "online"}`}</title>
            {online !== false && <circle className="p2-pulse" r={10 + 26 * strength} fill="none" stroke={LISTENER} strokeWidth={2} />}
            <circle r={6} fill={online === false ? LISTENER_OFF : LISTENER} stroke="#1a1714" strokeWidth={1.5} />
          </g>
        );
      })}

      {home.hazards.map((h) => (
        <g key={h.id} transform={`translate(${h.position.x} ${h.position.y})`}>
          <title>{h.title}</title>
          <polygon points="0,-8 7,5 -7,5" fill={h.severity === "high" ? "#b5452f" : "#e09a3c"} stroke="#1a1714" strokeWidth={1} />
        </g>
      ))}

      {target && <Person target={target} confidence={ghost ? 1 : position?.confidence ?? 1} velocity={ghost ? undefined : position?.velocity} />}

      {tape && distance(tape.a, tape.b) > 0.5 && <Tape a={tape.a} b={tape.b} />}
    </svg>
  );
}

// Everything that only changes when the home, the current room, a risk or the prediction changes.
// Memoized, so 5 Hz positions re-render only the moving layer.
const PlanBase = memo(function PlanBase({ home, walls, here, risks, next, measure }: {
  home: HomeModel; walls: [Vec2, Vec2][]; here?: string; risks: Record<string, RiskState>; next?: string; measure: boolean;
}) {
  const b = bounds(home.rooms.flatMap((r) => r.polygon));
  return (
    <g>
      {home.rooms.map((r) => {
        const risk = risks[r.id];
        return (
          <polygon
            key={r.id}
            points={pts(r.polygon)}
            fill={risk ? RISK_FLOOR[risk] : r.id === here ? HERE : FLOOR[r.kind]}
            stroke={risk === "escalated" ? "#b5452f" : r.id === next ? AMBER : "none"}
            strokeWidth={risk === "escalated" || r.id === next ? 4 : 0}
            opacity={r.virtual ? 0.8 : 1}
          />
        );
      })}

      {home.rooms.flatMap((r) =>
        (r.objects ?? []).map((o) => (
          <rect
            key={o.id}
            className="p2-object"
            x={-o.widthIn / 2}
            y={-o.depthIn / 2}
            width={o.widthIn}
            height={o.depthIn}
            transform={`translate(${o.center.x} ${o.center.y}) rotate(${o.rotationDeg})`}
          >
            <title>{`${o.category}, ${ftIn(o.widthIn)} × ${ftIn(o.depthIn)}`}</title>
          </rect>
        )),
      )}

      {walls.map(([p, q], i) => (
        <line key={i} className="p2-wall" x1={p.x} y1={p.y} x2={q.x} y2={q.y} strokeWidth={WALL_IN} />
      ))}

      {home.doors.map((d) => {
        const ax = doorAxis(home, d), n = { x: -ax.y, y: ax.x };
        const a = home.rooms.find((r) => r.id === d.roomA);
        // The leaf swings into roomA. Turning from the wall direction toward n is a positive (clockwise on
        // screen) angle, which is SVG's sweep flag 1.
        const into = a && (a.centroid.x - d.center.x) * n.x + (a.centroid.y - d.center.y) * n.y < 0 ? -1 : 1;
        const w = d.widthIn;
        const hinge = { x: d.center.x - (ax.x * w) / 2, y: d.center.y - (ax.y * w) / 2 };
        const jamb = { x: d.center.x + (ax.x * w) / 2, y: d.center.y + (ax.y * w) / 2 };
        const open = { x: hinge.x + n.x * into * w, y: hinge.y + n.y * into * w };
        const label = { x: d.center.x - n.x * into * 12, y: d.center.y - n.y * into * 12 };
        return (
          <g key={d.id}>
            {d.kind === "door" && (
              <g className="p2-door">
                <line x1={hinge.x} y1={hinge.y} x2={open.x} y2={open.y} />
                <path d={`M ${jamb.x} ${jamb.y} A ${w} ${w} 0 0 ${into > 0 ? 1 : 0} ${open.x} ${open.y}`} />
              </g>
            )}
            {measure && (
              <text className="p2-dim p2-dim-door" x={label.x} y={label.y + 2} textAnchor="middle">
                {Math.round(w)}″
              </text>
            )}
          </g>
        );
      })}

      {home.rooms.map((r) => {
        const rb = bounds(r.polygon);
        const rect = r.polygon.length === 4 && polygonArea(r.polygon) > rb.width * rb.height * 0.995;
        const lift = home.anchors.some((a) => distance(a.position, r.centroid) < 24) ? 28 : 0; // keep clear of a listener
        return (
          <g key={r.id} className="p2-label" transform={`translate(${r.centroid.x} ${r.centroid.y - lift})`}>
            <text textAnchor="middle" y={measure ? -2 : 3}>
              {r.name}
            </text>
            {measure && (
              <text className="p2-dim" textAnchor="middle" y={9}>
                {rect ? `${ftIn(rb.width)} × ${ftIn(rb.height)}` : `${Math.round(polygonArea(r.polygon) / 144)} sq ft`}
              </text>
            )}
          </g>
        );
      })}

      {measure && (
        <g className="p2-scale" transform={`translate(${b.minX} ${b.maxY + PAD * 0.55})`}>
          <line x1={0} y1={0} x2={60} y2={0} />
          <line x1={0} y1={-4} x2={0} y2={4} />
          <line x1={60} y1={-4} x2={60} y2={4} />
          <text x={66} y={3}>5 ft</text>
        </g>
      )}
    </g>
  );
});

function Person({ target, confidence, velocity }: { target: Vec2; confidence: number; velocity?: Vec2 }) {
  const group = useRef<SVGGElement>(null);
  const goal = useRef(target);
  goal.current = target;

  useEffect(() => {
    let raf = 0, last = performance.now();
    let cur: Vec2 | undefined;
    const step = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const g = goal.current;
      if (!cur || distance(cur, g) > JUMP_IN) cur = { ...g };
      else {
        const k = 1 - Math.exp(-GLIDE * dt);
        cur = { x: cur.x + (g.x - cur.x) * k, y: cur.y + (g.y - cur.y) * k };
      }
      group.current?.setAttribute("transform", `translate(${cur.x.toFixed(2)} ${cur.y.toFixed(2)})`);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);

  const speed = velocity ? Math.hypot(velocity.x, velocity.y) : 0;
  const heading = velocity && speed > 5 ? (Math.atan2(velocity.y, velocity.x) * 180) / Math.PI : undefined;
  const spread = 14 + (1 - Math.max(0, Math.min(1, confidence))) * 36; // a less certain estimate draws a wider ring

  return (
    <g ref={group} className="p2-person" transform={`translate(${target.x} ${target.y})`}>
      <circle r={spread} fill={AMBER} opacity={0.18} />
      <circle r={spread} fill="none" stroke={AMBER} strokeWidth={1.5} opacity={0.6} />
      {heading !== undefined && <path d="M 12 -5 L 22 0 L 12 5 Z" fill={AMBER} transform={`rotate(${heading})`} />}
      <circle r={8} fill={AMBER} stroke="#1a1714" strokeWidth={2} />
    </g>
  );
}

function Tape({ a, b }: { a: Vec2; b: Vec2 }) {
  const d = distance(a, b);
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  return (
    <g className="p2-tape">
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
      <circle cx={a.x} cy={a.y} r={2.5} />
      <circle cx={b.x} cy={b.y} r={2.5} />
      <text x={mid.x} y={mid.y - 6} textAnchor="middle">
        {ftIn(d)} · {d.toFixed(1)} in
      </text>
    </g>
  );
}
