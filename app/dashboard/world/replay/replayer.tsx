"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import "@/components/world/world.css";
import { heatCells, HomeScene, type CameraPreset } from "@/components/world/home-scene";
import type { HomeModel, LiveFrame } from "@/lib/types";
import { PATIENT_LABEL } from "@/lib/world/live-state";
import { demoNight, parseSession, stateAt } from "@/lib/world/replay";

const SPEEDS = [1, 2, 4, 8];
const HEAT_CELL_IN = 12;

const clock = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

// Time machine: scrub through a recorded night; the avatar, trail, risk colors and TV mode follow the recording.
export function Replayer({ home }: { home: HomeModel }) {
  const [sessions, setSessions] = useState<{ id: string }[]>([]);
  const [name, setName] = useState("demo");
  const [frames, setFrames] = useState<LiveFrame[]>(() => demoNight(home));
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(2);
  const [heat, setHeat] = useState(false);
  const [camera, setCamera] = useState<CameraPreset>("iso");
  const [error, setError] = useState("");
  const last = useRef<number | undefined>(undefined);

  const duration = frames.length ? frames[frames.length - 1].ts : 0;
  const state = useMemo(() => stateAt(home, frames, t), [home, frames, t]);
  const simulated = useMemo(() => frames.some((f) => "source" in f && f.source === "sim"), [frames]);
  const cells = useMemo(
    () => (heat ? heatCells(frames.flatMap((f) => (f.t === "position" ? [{ x: f.x, y: f.y }] : [])), HEAT_CELL_IN) : []),
    [frames, heat],
  );
  const room = home.rooms.find((r) => r.id === state.room);

  useEffect(() => {
    fetch("/api/world/sessions").then((r) => r.json()).then((d) => setSessions(d.sessions ?? [])).catch(() => {});
  }, []);

  // Advance the clock while playing.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = (now: number) => {
      const dt = last.current === undefined ? 0 : now - last.current;
      last.current = now;
      setT((cur) => {
        const next = cur + dt * speed;
        if (next >= duration) {
          setPlaying(false);
          return duration;
        }
        return next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      last.current = undefined;
    };
  }, [playing, speed, duration]);

  function load(next: LiveFrame[], label: string) {
    if (next.length === 0) return setError("That session has no positions or events to replay.");
    setError("");
    setFrames(next);
    setName(label);
    setT(0);
    setPlaying(true);
  }

  async function pick(id: string) {
    if (id === "demo") return load(demoNight(home), "demo");
    const res = await fetch(`/api/world/sessions?id=${encodeURIComponent(id)}`);
    if (!res.ok) return setError("Could not load that session.");
    load(parseSession(await res.text()), id);
  }

  async function upload(file: File) {
    load(parseSession(await file.text()), file.name);
  }

  return (
    <div className="room">
      <div className="w3 w3-short">
        <HomeScene state={state} camera={camera} heat={heat ? { cells, cellIn: HEAT_CELL_IN } : undefined} />
        <div className="w3-hud">
          <div className="w3-card">
            <div className="w3-room">{room?.name ?? "Start of the recording"}</div>
            <div className="w3-meta">
              <span>{clock(t)} / {clock(duration)}</span>
              {state.patient && <span>· {PATIENT_LABEL[state.patient]}</span>}
            </div>
            <div className="w3-meta">
              <span className="w3-chip sim">replay</span>
              <span className="w3-chip">{name}</span>
            </div>
          </div>
        </div>
        <div className="w3-sim-badge">{simulated ? "SIMULATED REPLAY" : "REPLAY"}</div>
        <div className="w3-tools">
          {(["iso", "top", "follow"] as CameraPreset[]).map((c) => (
            <button key={c} className={`w3-btn ${camera === c ? "on" : ""}`} onClick={() => setCamera(c)}>
              {c === "iso" ? "3D" : c === "top" ? "Top down" : "Follow"}
            </button>
          ))}
          <button className={`w3-btn ${heat ? "on" : ""}`} onClick={() => setHeat(!heat)}>
            Heat map
          </button>
          <span className="w3-spacer" />
          <Link className="w3-btn" href="/dashboard/world">
            Live view
          </Link>
        </div>
      </div>

      <section className="card rp-bar">
        <button className="btn" onClick={() => (t >= duration ? (setT(0), setPlaying(true)) : setPlaying(!playing))}>
          {playing ? "Pause" : t >= duration ? "Replay" : "Play"}
        </button>
        <input type="range" min={0} max={duration} step={100} value={t} onChange={(e) => setT(Number(e.target.value))} aria-label="Scrub the recording" />
        <span className="mono muted">{clock(t)}</span>
        <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="Speed">
          {SPEEDS.map((s) => <option key={s} value={s}>{s}x</option>)}
        </select>
        <select value={name} onChange={(e) => pick(e.target.value)} aria-label="Session">
          <option value="demo">Demo night (simulated)</option>
          {sessions.map((s) => <option key={s.id} value={s.id}>{s.id}</option>)}
          {name !== "demo" && !sessions.some((s) => s.id === name) && <option value={name}>{name}</option>}
        </select>
        <label className="btn ghost small">
          Open .jsonl
          <input type="file" accept=".jsonl,.ndjson,.txt" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        </label>
        {error && <span className="error">{error}</span>}
      </section>
    </div>
  );
}
