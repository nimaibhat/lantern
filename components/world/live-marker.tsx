"use client";

// The person on the plan. A dot that keeps gliding between live positions instead of stalling and jumping, a halo
// as wide as the estimate is uncertain, a beam toward where they are heading, and a trail drawn from the dot itself
// so it never lags behind it. One requestAnimationFrame loop writes the SVG directly; React renders this once.

import { useEffect, useRef } from "react";
import type { Vec2 } from "@/lib/types";
import "./live-marker.css";

const TRAIL_S = 180; // how much of the walk stays on the plan
const GLOW_S = 6; // the newest part of the trail glows
const CHUNKS = 12; // the trail fades in steps from oldest to newest
const SAMPLE_IN = 6; // add a trail point once the dot has moved this far, so standing still does not scribble
const MAX_POINTS = 4000;
const JUMP_IN = 120; // farther than this (the tag came back after a silence) snaps and starts a new trail piece
const EXTRAPOLATE_S = 0.15; // between updates keep moving along the last velocity, at most this long
const FOLLOW = 16; // per second: how tightly the drawn dot follows its goal
const AHEAD_S = 1.2; // the dashed line shows where they will be in about this long

type Pt = { x: number; y: number; t: number; gap?: boolean };

// Round the corners once (Chaikin): each corner is cut a quarter of the way in from both sides. Gaps stay hard.
function chaikin(points: Pt[]): Pt[] {
  if (points.length < 3) return points;
  const out: Pt[] = [points[0]];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    if (b.gap) { out.push(a, b); continue; }
    out.push({ x: 0.75 * a.x + 0.25 * b.x, y: 0.75 * a.y + 0.25 * b.y, t: a.t }, { x: 0.25 * a.x + 0.75 * b.x, y: 0.25 * a.y + 0.75 * b.y, t: b.t });
  }
  out.push(points[points.length - 1]);
  return out;
}

// A smooth path through the points: rounded corners, then quadratic curves through the midpoints. gap starts a new piece.
function smooth(raw: Pt[]): string {
  const points = chaikin(raw);
  let d = "";
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (i === 0 || p.gap) d += `M${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
    else if (i === points.length - 1 || points[i + 1].gap) d += `L${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
    else {
      const n = points[i + 1];
      d += `Q${p.x.toFixed(1)} ${p.y.toFixed(1)} ${((p.x + n.x) / 2).toFixed(1)} ${((p.y + n.y) / 2).toFixed(1)}`;
    }
  }
  return d;
}

// A live position as it arrived; at is performance.now() at arrival, so the dot can keep moving until the next one.
export interface LiveFeed { x: number; y: number; velocity?: Vec2; spreadIn?: number; at: number }

// target drives the dot through React props (the 2D plan). feed is read on every animation frame instead, so a
// reading reaches the dot on the very next frame without re-rendering the page (the Now page). onFrame gets the dot
// where it is drawn each frame, for anything that has to stay attached to it.
export function LiveMarker({ target, velocity, spreadIn, trail = true, feed, onFrame }: {
  target?: Vec2;
  velocity?: Vec2;
  spreadIn?: number;
  trail?: boolean;
  feed?: () => LiveFeed | undefined;
  onFrame?: (p: Vec2 | undefined) => void;
}) {
  const root = useRef<SVGGElement>(null);
  const dot = useRef<SVGGElement>(null);
  const halo = useRef<SVGCircleElement>(null);
  const beam = useRef<SVGGElement>(null);
  const ahead = useRef<SVGLineElement>(null);
  const glow = useRef<SVGPathElement>(null);
  const chunks = useRef<(SVGPathElement | null)[]>([]);
  const latest = useRef<{ p?: Vec2; v?: Vec2; spread?: number; at: number; trail: boolean }>({ p: target, v: velocity, spread: spreadIn, at: 0, trail });
  const feedRef = useRef(feed);
  feedRef.current = feed;
  const frameRef = useRef(onFrame);
  frameRef.current = onFrame;
  const l = latest.current;
  if (target && (!l.p || l.p.x !== target.x || l.p.y !== target.y || l.spread !== spreadIn || l.trail !== trail))
    latest.current = { p: target, v: velocity, spread: spreadIn, at: performance.now(), trail };
  else l.trail = trail;

  useEffect(() => {
    let raf = 0, last = performance.now(), drawn = 0;
    let cur: Vec2 | undefined, vel = { x: 0, y: 0 }, heading = 0, spread = 30;
    const points: Pt[] = [];

    const step = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const f = feedRef.current?.();
      if (f && f.at !== latest.current.at) latest.current = { p: { x: f.x, y: f.y }, v: f.velocity, spread: f.spreadIn, at: f.at, trail: latest.current.trail };
      const L = latest.current;
      root.current?.setAttribute("visibility", L.p ? "visible" : "hidden");
      if (!L.p) {
        frameRef.current?.(undefined);
        raf = requestAnimationFrame(step);
        return;
      }
      const age = Math.min(EXTRAPOLATE_S, Math.max(0, (now - L.at) / 1000));
      const goal = L.v ? { x: L.p.x + L.v.x * age, y: L.p.y + L.v.y * age } : L.p;

      if (!cur || Math.hypot(goal.x - cur.x, goal.y - cur.y) > JUMP_IN) {
        cur = { ...goal };
        vel = { x: 0, y: 0 };
        if (points.length) points.push({ ...cur, t: now, gap: true });
      } else {
        const k = 1 - Math.exp(-FOLLOW * dt);
        const next = { x: cur.x + (goal.x - cur.x) * k, y: cur.y + (goal.y - cur.y) * k };
        const s = 1 - Math.exp(-dt / 0.3);
        if (dt > 0) vel = { x: vel.x + s * ((next.x - cur.x) / dt - vel.x), y: vel.y + s * ((next.y - cur.y) / dt - vel.y) };
        cur = next;
      }

      // Heading turns smoothly the short way round; the beam and the line ahead fade out when the person stops.
      const speed = Math.hypot(vel.x, vel.y);
      if (speed > 3) {
        const want = (Math.atan2(vel.y, vel.x) * 180) / Math.PI;
        heading += ((((want - heading) % 360) + 540) % 360 - 180) * (1 - Math.exp(-8 * dt));
      }
      spread += ((L.spread ?? 30) - spread) * (1 - Math.exp(-4 * dt));
      const moving = Math.max(0, Math.min(1, (speed - 4) / 16));

      dot.current?.setAttribute("transform", `translate(${cur.x.toFixed(2)} ${cur.y.toFixed(2)})`);
      frameRef.current?.(cur);
      halo.current?.setAttribute("r", Math.max(10, spread).toFixed(1));
      beam.current?.setAttribute("transform", `rotate(${heading.toFixed(1)})`);
      beam.current?.setAttribute("opacity", moving.toFixed(2));
      ahead.current?.setAttribute("x2", Math.min(72, speed * AHEAD_S).toFixed(1));

      if (L.trail) {
        const tail = points[points.length - 1];
        if (!tail || tail.gap || Math.hypot(cur.x - tail.x, cur.y - tail.y) >= SAMPLE_IN) points.push({ x: cur.x, y: cur.y, t: now });
      }
      while (points.length && (now - points[0].t > TRAIL_S * 1000 || points.length > MAX_POINTS)) points.shift();

      // Paths rebuild about 20 times a second; the newest vertex is always the dot, so the trail touches it.
      if (now - drawn > 50) {
        drawn = now;
        const head = { x: cur.x, y: cur.y, t: now };
        const span = TRAIL_S * 1000;
        for (let c = 0; c < CHUNKS; c++) {
          const from = now - span + (c * span) / CHUNKS, to = now - span + ((c + 1) * span) / CHUNKS;
          const i0 = points.findIndex((p) => p.t >= from);
          let i1 = points.findIndex((p) => p.t > to);
          if (i1 < 0) i1 = points.length;
          const seg = i0 < 0 ? [] : points.slice(Math.max(0, i0 - 1), Math.min(points.length, i1 + 1));
          if (c === CHUNKS - 1 && L.trail && points.length) seg.push(head);
          chunks.current[c]?.setAttribute("d", seg.length > 1 ? smooth(seg) : "");
        }
        const recent = points.filter((p) => now - p.t <= GLOW_S * 1000);
        glow.current?.setAttribute("d", L.trail && recent.length ? smooth([...recent, head]) : "");
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <g ref={root} className="lm" pointerEvents="none" visibility={target ? "visible" : "hidden"}>
      <g className="lm-trail">
        {Array.from({ length: CHUNKS }, (_, c) => (
          <path key={c} ref={(el) => { chunks.current[c] = el; }} opacity={0.08 + 0.87 * ((c + 1) / CHUNKS) ** 2} />
        ))}
        <path ref={glow} className="lm-glow" />
      </g>
      <g ref={dot} transform={target ? `translate(${target.x} ${target.y})` : undefined}>
        <circle ref={halo} className="lm-halo" r={30} />
        <g ref={beam} opacity={0}>
          <path className="lm-beam" d="M0 0 L66 -26 A70 70 0 0 1 66 26 Z" />
          <line ref={ahead} className="lm-ahead" x1={11} y1={0} x2={0} y2={0} />
        </g>
        <circle className="lm-pulse" r={9} />
        <circle className="lm-dot" r={7.5} />
        <circle className="lm-core" r={2.6} />
      </g>
    </g>
  );
}
