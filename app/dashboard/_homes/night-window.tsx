"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import "@/components/world/world.css";
import type { HomeModel } from "@/lib/types";
import { riskByRoom } from "@/lib/world/live-state";
import { mockWalk, walkDuration, type TimedFrame } from "@/lib/world/mock-walk";
import { stateAt } from "@/lib/world/replay";
import { PlanThumb } from "./plan-thumb";

// The Homes page hero: the scanned home in 3D, replaying one night. The walk is the scripted demo night built
// from this home's own rooms and doors (lib/world/mock-walk.ts), so it fits any scan; it is labeled as a replay.

const HomeScene = dynamic(() => import("@/components/world/home-scene").then((m) => m.HomeScene), {
  ssr: false,
  loading: () => <div className="nw-scene-loading" />,
});

const STORY_START_S = (3 * 60 + 2) * 60; // the story starts at 3:02 AM
const STORY_SPEED = 12; // story seconds per real second: about five minutes of night in under half a minute
const AUTOPLAY_MS = 1900; // after the walls have risen
const TICK_MS = 100;

type Beat = { at: number; text: string; tv?: boolean };

const clockAt = (ms: number) => {
  const s = STORY_START_S + Math.round((ms / 1000) * STORY_SPEED);
  const h = Math.floor(s / 3600) % 12 || 12, m = Math.floor(s / 60) % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
};

function beatsFor(frames: TimedFrame[], home: HomeModel, name: string): Beat[] {
  const roomName = (id: string) => home.rooms.find((r) => r.id === id)?.name.toLowerCase() ?? "next room";
  const bedroom = frames.find((f) => f.frame.t === "location")?.frame;
  const bedId = bedroom?.t === "location" ? bedroom.roomId : undefined;
  const beats: Beat[] = [];
  let up = false;
  for (const { at, frame: f } of frames) {
    if (f.t === "location" && f.prevRoomId && !up) {
      up = true;
      beats.push({ at, text: `${name} gets out of bed and heads into the ${roomName(f.roomId)}.` });
    } else if (f.t === "location" && f.prevRoomId && f.roomId === bedId) {
      beats.push({ at, text: `Back in bed. Nobody had to be woken up.` });
    } else if (f.t === "prediction" && !beats.some((b) => b.text.startsWith("Lantern expects"))) {
      beats.push({ at, text: `Lantern expects the ${roomName(f.nextRoomId)} next and gets ready to help.` });
    } else if (f.t === "risk" && f.state === "redirecting") {
      beats.push({ at, text: `The ${roomName(f.roomId)} at night is a fall risk, so the TV glows warm.`, tv: true });
    } else if (f.t === "patient" && f.mode === "photo_voice") {
      beats.push({ at, text: `A familiar voice: "It's still night, ${name}. Let's go back to bed."`, tv: true });
    } else if (f.t === "risk" && f.state === "resolved") {
      beats.push({ at, text: `${name} turns around. The redirect worked, so no alert goes out.` });
    }
  }
  return beats;
}

function webglOk() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

export function NightWindow({ home, name, homeHref }: { home: HomeModel; name: string; homeHref: string }) {
  const timed = useMemo(() => mockWalk(home), [home]);
  const frames = useMemo(() => timed.map((f) => f.frame), [timed]);
  const beats = useMemo(() => beatsFor(timed, home, name), [timed, home, name]);
  const duration = useMemo(() => walkDuration(timed), [timed]);

  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [webgl, setWebgl] = useState(true);
  const [calm, setCalm] = useState(false); // prefers-reduced-motion: no rise, no turn, no autoplay
  const startedAt = useRef(0);

  useEffect(() => {
    setWebgl(webglOk());
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setCalm(reduce);
    if (reduce) return;
    const id = setTimeout(() => play(), AUTOPLAY_MS);
    return () => clearTimeout(id);
  }, []);

  // Positions arrive every 200 ms and the avatar eases between them, so a 100 ms clock is smooth enough.
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      const now = performance.now() - startedAt.current;
      setT(Math.min(now, duration));
      if (now >= duration) setPlaying(false);
    }, TICK_MS);
    return () => clearInterval(id);
  }, [playing, duration]);

  function play() {
    startedAt.current = performance.now();
    setT(0);
    setPlaying(true);
  }

  const state = useMemo(() => stateAt(home, frames, t), [home, frames, t]);
  const shown = beats.filter((b) => b.at <= t);
  const done = !playing && t >= duration;
  const tvOn = state.patient === "glow" || state.patient === "photo_voice";
  const alertRoom = Object.entries(riskByRoom(state)).find(([, s]) => s !== "resolved")?.[0];

  return (
    <section className="night-window" aria-label={`A night at ${name}'s home, replayed`}>
      <div className="nw-scene">
        {webgl ? (
          <HomeScene state={state} camera="iso" walls="low" showcase={!calm} intro={!calm} />
        ) : (
          <PlanThumb home={home} person={state.position} alertRoom={alertRoom} className="nw-plan" />
        )}
        <div className="nw-controls">
          <button className="nw-play" onClick={play} disabled={playing}>
            {playing ? "Playing the night" : t > 0 ? "Watch it again" : "Watch the night"}
          </button>
          <Link href={homeHref} className="nw-open">
            Open this home
          </Link>
        </div>
      </div>

      <aside className="nw-log">
        <p className="nw-clock" aria-live="off">
          {clockAt(t)}
          <span>AM</span>
        </p>
        <p className="nw-caption">Replay of a night, simulated on this home&apos;s scan</p>
        <ol className="nw-beats">
          {shown.map((b) => (
            <li key={b.at + b.text} className={b.tv ? "tv" : undefined}>
              <time>{clockAt(b.at)}</time>
              <span>{b.text}</span>
            </li>
          ))}
          {shown.length === 0 && <li className="nw-waiting">{name} is asleep.</li>}
        </ol>
        <p className={tvOn ? "nw-tv on" : "nw-tv"}>{tvOn ? "TV: glowing, photo of the bedroom" : "TV: dark"}</p>
        {done && <p className="nw-result">No alert sent. The family slept through it.</p>}
      </aside>
    </section>
  );
}
