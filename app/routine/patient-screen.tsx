"use client";

// The patient's TV (Part 6 step 2). Idle shows the day's routine. The monitor's responder takes the screen over:
// a warm glow first, then a familiar photo and voice, a greeting by day, and a calm fade back to the routine.
// State arrives over the monitor's live socket, so it works on the demo laptop with or without Supabase.
// Browsers block sound until someone taps, so the page opens on "Tap to start".

import { useEffect, useRef, useState } from "react";
import type { LiveFrame, PatientMode, Room, RoutineStep } from "@/lib/types";
import { RoutinePlayer } from "./player";
import "./patient.css";

const MONITOR_WS = process.env.NEXT_PUBLIC_MONITOR_WS || "ws://localhost:8787/ws/live";

interface Shown {
  mode: PatientMode;
  message?: string;
  photoPath?: string;
  voicePath?: string;
  at: number; // when it arrived, so the same mode twice still replays the voice
}

export function PatientScreen({ steps, rooms, householdId, quiet, preview }: {
  steps: RoutineStep[];
  rooms: Room[];
  householdId: string;
  quiet: { start: string; end: string }; // "21:00", "07:00": the idle screen dims inside these hours
  preview: boolean;
}) {
  const [unlocked, setUnlocked] = useState(false);
  const [needsTap, setNeedsTap] = useState(false);
  const [shown, setShown] = useState<Shown>({ mode: "idle", at: 0 });
  const [online, setOnline] = useState(false);
  const [night, setNight] = useState(false);
  const media = (path: string) => `/api/patient/media?h=${encodeURIComponent(householdId)}&path=${encodeURIComponent(path)}`;

  // Live socket, reconnecting with backoff. A snapshot carries the current state for a TV that joins mid-redirect.
  useEffect(() => {
    let ws: WebSocket | undefined, retry: ReturnType<typeof setTimeout> | undefined, delay = 1000, stopped = false;
    const connect = () => {
      ws = new WebSocket(MONITOR_WS);
      ws.onopen = () => {
        delay = 1000;
        setOnline(true);
      };
      ws.onmessage = (e) => {
        let f: LiveFrame;
        try {
          f = JSON.parse(e.data);
        } catch {
          return;
        }
        if (f.t === "patient") setShown({ mode: f.mode, message: f.message, photoPath: f.photoPath, voicePath: f.voicePath, at: Date.now() });
        if (f.t === "snapshot" && f.patientState) {
          const p = f.patientState;
          setShown({ mode: p.mode, message: p.message, photoPath: p.photoPath, voicePath: p.voicePath, at: Date.now() });
        }
      };
      ws.onclose = () => {
        if (stopped) return;
        setOnline(false);
        retry = setTimeout(connect, delay);
        delay = Math.min(delay * 2, 10_000);
      };
    };
    connect();
    return () => {
      stopped = true;
      clearTimeout(retry);
      ws?.close();
    };
  }, []);

  // Dim the idle screen at night. Computed in the browser so the server's clock and timezone never decide it.
  useEffect(() => {
    const check = () => {
      const now = new Date().toTimeString().slice(0, 5);
      setNight(quiet.start > quiet.end ? now >= quiet.start || now < quiet.end : now >= quiet.start && now < quiet.end);
    };
    check();
    const id = setInterval(check, 60_000);
    return () => clearInterval(id);
  }, [quiet.start, quiet.end]);

  // The familiar voice: the caregiver's recording when there is one, otherwise the message read aloud.
  const said = useRef(0);
  useEffect(() => {
    if (!unlocked || (shown.mode !== "photo_voice" && shown.mode !== "greeting")) return;
    const speak = () => {
      if (said.current === shown.at || !shown.message || !("speechSynthesis" in window)) return;
      said.current = shown.at;
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(shown.message);
      u.rate = 0.85; // slower is easier to follow
      speechSynthesis.speak(u);
    };
    let audio: HTMLAudioElement | undefined;
    if (shown.voicePath) {
      audio = new Audio(media(shown.voicePath));
      audio.onerror = speak; // no recording yet, or no storage on this laptop
      audio.play().catch((e: DOMException) => (e.name === "NotAllowedError" ? setNeedsTap(true) : speak()));
    } else {
      speak();
    }
    return () => {
      audio?.pause();
      if ("speechSynthesis" in window) speechSynthesis.cancel();
    };
  }, [shown.at, shown.mode, unlocked]); // once per arrival; the rest of `shown` arrives with it

  const nextStep = (() => {
    const now = new Date().toTimeString().slice(0, 5);
    return steps.find((s) => s.time > now) ?? steps[0];
  })();

  return (
    <>
      <div className={night && shown.mode === "idle" ? "pt-idle night" : "pt-idle"}>
        <RoutinePlayer steps={steps} rooms={rooms} />
      </div>

      {shown.mode === "glow" && <div className="pt-overlay pt-glow" key={shown.at} />}

      {shown.mode === "photo_voice" && (
        <div className="pt-overlay pt-voice" key={shown.at}>
          {shown.photoPath && <img className="pt-photo" src={media(shown.photoPath)} alt="" onError={(e) => (e.currentTarget.style.display = "none")} />}
          <p className="pt-message">{shown.message}</p>
        </div>
      )}

      {shown.mode === "greeting" && (
        <div className="pt-overlay pt-greeting" key={shown.at}>
          <p className="pt-message">{shown.message}</p>
          {nextStep && <p className="pt-next">Next: {nextStep.title} at {nextStep.time}</p>}
        </div>
      )}

      {shown.mode === "calm" && <div className="pt-overlay pt-calm" key={shown.at} />}

      {!unlocked && (
        <button className="pt-overlay pt-tap" onClick={() => setUnlocked(true)}>
          Tap to start
        </button>
      )}
      {/* Sound got blocked mid-redirect: ask again without covering the message, which still works on its own */}
      {unlocked && needsTap && (
        <button
          className="pt-tap-again"
          onClick={() => {
            setNeedsTap(false);
            said.current = 0;
            setShown((s) => ({ ...s, at: Date.now() })); // replay the voice now that a tap allows it
          }}
        >
          Tap for sound
        </button>
      )}

      {preview && (
        <div className="pt-preview">
          TV (simulated) <span className={online ? "pt-dot on" : "pt-dot"} /> {shown.mode}
        </div>
      )}
    </>
  );
}
