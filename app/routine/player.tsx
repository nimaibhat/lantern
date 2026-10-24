"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { routinePrompt } from "@/lib/cues/script";
import { currentStep, duePrompt, friendlyTime, logDone, logPrompt, nextStep, type PromptLog } from "@/lib/cues/routine";
import { roomName } from "@/lib/dashboard/rooms";
import type { Room, RoutineStep } from "@/lib/types";

const CHECK_MS = 15_000;
const FOLLOW_AFTER_MS = 2 * 60_000; // after someone taps Back or Done, wait before following the clock again

const hhmm = () => new Date().toTimeString().slice(0, 5);

// Patient view for a tablet or TV: "Now and Next", big and calm. At a step's time it is said aloud (chime first),
// and again a few times until the person reaches that room or someone taps Done (lib/cues/routine.ts).
export function RoutinePlayer({ steps, rooms, name, hereRoomId, prompts = false, announce }: {
  steps: RoutineStep[];
  rooms: Room[];
  name: string;
  hereRoomId?: string; // where the person is, in the routine's room ids
  prompts?: boolean; // false while sound is locked or something else has the screen
  announce?: (text: string, voicePath?: string) => Promise<void>;
}) {
  const ordered = [...steps].sort((a, b) => a.time.localeCompare(b.time));
  const [index, setIndex] = useState(0);
  const touched = useRef(0);
  const log = useRef<PromptLog>({});
  const step = ordered[index];
  const following = ordered[index + 1] ?? nextStep(ordered, hhmm());

  // Follow the clock, unless someone just moved through the steps by hand.
  useEffect(() => {
    const follow = () => {
      if (Date.now() - touched.current < FOLLOW_AFTER_MS) return;
      const now = currentStep(ordered, hhmm());
      setIndex(Math.max(0, now ? ordered.indexOf(now) : 0));
    };
    follow();
    const id = setInterval(follow, 30_000);
    return () => clearInterval(id);
  }, [steps]); // ordered is derived from steps

  // Say the step when its time comes.
  const live = useRef({ prompts, hereRoomId, announce });
  live.current = { prompts, hereRoomId, announce };
  useEffect(() => {
    const check = () => {
      const { prompts, hereRoomId, announce } = live.current;
      if (!prompts || !announce) return;
      const due = duePrompt(ordered, hhmm(), Date.now(), log.current, hereRoomId);
      if (!due) return;
      log.current = logPrompt(log.current, due.id, Date.now());
      setIndex(ordered.indexOf(due));
      void announce(routinePrompt(name, due.title), due.voicePath);
    };
    const id = setInterval(check, CHECK_MS);
    return () => clearInterval(id);
  }, [steps, name]);

  const move = (to: number) => {
    touched.current = Date.now();
    setIndex(Math.min(ordered.length - 1, Math.max(0, to)));
  };

  if (!step) {
    return (
      <main className="dash player">
        <h1 className="player-title">No routine yet.</h1>
      </main>
    );
  }

  const photo = rooms.find((r) => r.id === step.roomId)?.photoUrls?.[0];
  return (
    <main className="dash player">
      <Link href="/dashboard/routine" className="player-exit">
        Caregiver
      </Link>
      <p className="player-time">Now · {friendlyTime(step.time)}</p>
      {photo ? <img className="player-photo has-photo" src={photo} alt="" /> : <div className="player-photo">{roomName(rooms, step.roomId)}</div>}
      <h1 className="player-title">{step.title}</h1>
      {following && following.id !== step.id && <p className="player-next">Next at {friendlyTime(following.time)}: {following.title}</p>}
      <div className="player-controls">
        <button className="btn big ghost" onClick={() => move(index - 1)} disabled={index === 0}>
          Back
        </button>
        <button className="btn big ghost" onClick={() => void announce?.(routinePrompt(name, step.title), step.voicePath)}>
          Hear it
        </button>
        <button
          className="btn big"
          onClick={() => {
            log.current = logDone(log.current, step.id);
            move(index + 1);
          }}
        >
          Done
        </button>
      </div>
    </main>
  );
}
