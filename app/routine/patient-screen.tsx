"use client";

// The patient's TV (Part 6 step 2, docs/cues.md). Idle shows "Now and Next" from the routine. The monitor's
// responder takes the screen over: a warm glow, then a soft chime and the cue (name first, where they are, the way
// back), repeated with the same words; a calm "good night" once they are back; a greeting by day; a message the
// caregiver typed. State arrives over the monitor's live socket, so it works on the demo laptop without Supabase.
// Browsers block sound until someone taps, so the page opens on "Tap to start".
// ?room=kitchen makes this screen play only while the person is in that room (a laptop in each room).

import { useCallback, useEffect, useRef, useState } from "react";
import { friendlyTime, nextStep } from "@/lib/cues/routine";
import { resolveRoomId } from "@/lib/dashboard/rooms";
import type { LiveFrame, PatientMode, RiskKind, Room, RoutineStep } from "@/lib/types";
import { companionEnabled, companionFromCue, startCompanion, warmMicrophone, type Companion } from "./companion";
import { RoutinePlayer } from "./player";
import { chime, hush, speak, unlockAudio } from "./sound";
import "./patient.css";

const MONITOR_WS = process.env.NEXT_PUBLIC_MONITOR_WS || "ws://localhost:8787/ws/live";
const MONITOR = process.env.NEXT_PUBLIC_MONITOR_URL || "http://localhost:8787";

interface Shown {
  mode: PatientMode;
  message?: string;
  detail?: string;
  route?: string[];
  photoPath?: string;
  voicePath?: string;
  cue?: number;
  roomId?: string;
  riskEventId?: string;
  at: number; // when it arrived, so the same mode twice still replays the voice
}

const fromFrame = (f: Omit<Shown, "at">): Shown => ({
  mode: f.mode, message: f.message, detail: f.detail, route: f.route, photoPath: f.photoPath, voicePath: f.voicePath,
  cue: f.cue, roomId: f.roomId, riskEventId: f.riskEventId, at: Date.now(),
});

// Name first, every time: "Patient, your caregiver is coming at 9."
const named = (name: string, text = "") => (text.toLowerCase().startsWith(name.toLowerCase()) ? text : `${name}, ${text}`);

export function PatientScreen({ steps, rooms, householdId, name, quiet, preview, room }: {
  steps: RoutineStep[];
  rooms: Room[];
  householdId: string;
  name: string;
  quiet: { start: string; end: string }; // "21:00", "07:00": the idle screen dims inside these hours
  preview: boolean;
  room?: string; // home-model room id from ?room=
}) {
  const [unlocked, setUnlocked] = useState(false);
  const [needsTap, setNeedsTap] = useState(false);
  const [shown, setShown] = useState<Shown>({ mode: "idle", at: 0 });
  const [online, setOnline] = useState(false);
  const [night, setNight] = useState(false);
  const [here, setHere] = useState<string>();
  const kinds = useRef(new Map<string, RiskKind>()); // risk id -> kind, for the companion's goal
  const companion = useRef<{ riskId: string; c: Companion; detail?: string } | undefined>(undefined);
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
        if (f.t === "patient") setShown(fromFrame(f));
        if (f.t === "risk") kinds.current.set(f.riskEventId, f.kind);
        if (f.t === "location" || f.t === "position") setHere(f.roomId);
        if (f.t === "snapshot") {
          if (f.room) setHere(f.room);
          if (f.patientState) setShown(fromFrame(f.patientState));
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
      companion.current?.c.stop();
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

  // A screen with ?room= only plays what happens in its own room; frames without a room play everywhere.
  const view: Shown = !room || !shown.roomId || shown.roomId === room ? shown : { mode: "idle", at: shown.at };

  const endCompanion = (closing?: string) => {
    const running = companion.current;
    companion.current = undefined;
    if (!running) return false;
    if (closing) running.c.say(closing, true);
    else running.c.stop();
    return true;
  };

  // Words for the screen: the caregiver's recording when there is one, otherwise the calm browser voice.
  const say = useCallback(async (words: string, voicePath?: string) => {
    if (!voicePath) return speak(words, night);
    const audio = new Audio(media(voicePath));
    await new Promise<void>((resolve) => {
      audio.onended = () => resolve();
      audio.onerror = () => void speak(words, night).then(resolve); // no recording yet, or no storage on this laptop
      audio.play().catch((e: DOMException) => {
        if (e.name === "NotAllowedError") setNeedsTap(true);
        void speak(words, night).then(resolve);
      });
    });
  }, [night]); // media() only changes with the household, which never changes on this page

  // One arrival, one sequence: chime, then the words (or the companion), never two voices at once.
  const said = useRef(0);
  useEffect(() => {
    if (!unlocked || said.current === view.at) return;
    said.current = view.at;
    let cancelled = false;
    const words = [view.message, view.detail].filter(Boolean).join(" ");

    (async () => {
      if (view.mode !== "photo_voice") {
        // Back in a safe room: the companion, if it is talking, says the closing line itself.
        if (endCompanion(view.mode === "calm" ? view.message : undefined)) return;
        if (view.mode === "calm" && view.message) return void speak(view.message, night);
        if (view.mode === "greeting" && view.message) return void say(view.message, view.voicePath);
        if (view.mode === "note" && view.message) {
          await chime(night);
          if (!cancelled) await speak(named(name, view.message), night);
        }
        return;
      }

      // Already talking with the companion: it repeats the invitation itself; tell it where they are now.
      const running = companion.current;
      if (running && running.riskId === view.riskEventId) {
        if (view.detail && view.detail !== running.detail) {
          running.c.tell(`Update: ${view.detail}`);
          running.detail = view.detail;
        }
        return;
      }

      await chime(night);
      if (cancelled) return;
      const kind = view.riskEventId ? kinds.current.get(view.riskEventId) : undefined;
      if (companionEnabled && (view.cue ?? 1) >= companionFromCue && kind && view.message && view.riskEventId) {
        const riskId = view.riskEventId;
        try {
          const c = await startCompanion({ name, kind, message: view.message, detail: view.detail, night }, {
            onHelp: (reason) => void fetch(`${MONITOR}/help`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ riskEventId: riskId, reason }) }).catch(() => {}),
            onEnd: () => {
              if (companion.current?.riskId === riskId) companion.current = undefined;
            },
          });
          if (c && !cancelled) {
            companion.current = { riskId, c, detail: view.detail };
            return;
          }
          c?.stop();
        } catch {
          // No microphone, no network, or a bad key: the scripted voice below still plays.
        }
      }
      if (!cancelled) await say(words, view.voicePath);
    })();

    return () => {
      cancelled = true;
      hush();
    };
  }, [view.at, unlocked]); // once per arrival; the rest of `view` arrives with it

  const upcoming = nextStep(steps, new Date().toTimeString().slice(0, 5)) ?? steps[0];

  // Routine prompts share the chime and the calm voice, and wait while a reminder or message has the screen.
  const announce = useCallback(async (text: string, voicePath?: string) => {
    await chime(night);
    await say(text, voicePath);
  }, [night, say]);

  return (
    <>
      <div className={night && view.mode === "idle" ? "pt-idle night" : "pt-idle"}>
        <RoutinePlayer
          steps={steps}
          rooms={rooms}
          name={name}
          hereRoomId={resolveRoomId(rooms, here)}
          prompts={unlocked && view.mode === "idle" && (!room || here === room)}
          announce={announce}
        />
      </div>

      {view.mode === "glow" && <div className="pt-overlay pt-glow" key={view.at} />}

      {view.mode === "photo_voice" && (
        <div className="pt-overlay pt-voice" key={view.at}>
          {view.photoPath && <img className="pt-photo" src={media(view.photoPath)} alt="" onError={(e) => (e.currentTarget.style.display = "none")} />}
          <p className="pt-message">{view.message}</p>
          {view.detail && <p className="pt-detail">{view.detail}</p>}
          {view.route && view.route.length > 1 && (
            <ol className="pt-route" aria-label="The way back">
              {view.route.map((r, i) => (
                <li key={`${r}-${i}`} className={i === 0 ? "here" : i === view.route!.length - 1 ? "goal" : ""}>{r}</li>
              ))}
            </ol>
          )}
        </div>
      )}

      {view.mode === "greeting" && (
        <div className="pt-overlay pt-greeting" key={view.at}>
          <p className="pt-message">{view.message}</p>
          {upcoming && <p className="pt-next">Next at {friendlyTime(upcoming.time)}: {upcoming.title}</p>}
        </div>
      )}

      {view.mode === "note" && (
        <div className="pt-overlay pt-note" key={view.at}>
          <p className="pt-eyebrow">A message for you</p>
          <p className="pt-message">{named(name, view.message)}</p>
        </div>
      )}

      {view.mode === "calm" && (
        <div className={view.message ? "pt-overlay pt-calm with-message" : "pt-overlay pt-calm"} key={view.at}>
          {view.message && <p className="pt-message">{view.message}</p>}
        </div>
      )}

      {!unlocked && (
        <button
          className="pt-overlay pt-tap"
          onClick={() => {
            unlockAudio();
            void warmMicrophone();
            if ("speechSynthesis" in window) speechSynthesis.getVoices(); // some browsers load voices on first ask
            setUnlocked(true);
          }}
        >
          Tap to start
        </button>
      )}
      {/* Sound got blocked mid-redirect: ask again without covering the message, which still works on its own */}
      {unlocked && needsTap && (
        <button
          className="pt-tap-again"
          onClick={() => {
            unlockAudio();
            setNeedsTap(false);
            setShown((s) => ({ ...s, at: Date.now() })); // replay the voice now that a tap allows it
          }}
        >
          Tap for sound
        </button>
      )}

      {preview && (
        <div className="pt-preview">
          TV (simulated){room ? ` · ${room}` : ""} <span className={online ? "pt-dot on" : "pt-dot"} /> {view.mode}
          {companionEnabled ? " · companion" : ""}
        </div>
      )}
    </>
  );
}
