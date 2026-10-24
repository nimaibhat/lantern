"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { roomName } from "@/lib/dashboard/rooms";
import type { Room, RoutineStep } from "@/lib/types";

// Patient view for a tablet: one step at a time, big and calm.
export function RoutinePlayer({ steps, rooms }: { steps: RoutineStep[]; rooms: Room[] }) {
  const [index, setIndex] = useState(0);
  const step = steps[index];

  // Start on the step that matches the current time.
  useEffect(() => {
    const now = new Date().toTimeString().slice(0, 5);
    const current = steps.findLastIndex((s) => s.time <= now);
    setIndex(Math.max(0, current));
  }, []);

  // Placeholder for the caregiver's recorded voice.
  function speak() {
    if (!("speechSynthesis" in window)) return;
    speechSynthesis.cancel();
    speechSynthesis.speak(new SpeechSynthesisUtterance(step.title));
  }

  if (!step) {
    return (
      <main className="dash player">
        <h1 className="player-title">No routine yet.</h1>
      </main>
    );
  }

  return (
    <main className="dash player">
      <Link href="/dashboard/routine" className="player-exit">
        Caregiver
      </Link>
      <p className="player-time">{step.time}</p>
      <div className="player-photo">{roomName(rooms, step.roomId)}</div>
      <h1 className="player-title">{step.title}</h1>
      <div className="player-controls">
        <button className="btn big ghost" onClick={() => setIndex(Math.max(0, index - 1))} disabled={index === 0}>
          Back
        </button>
        <button className="btn big ghost" onClick={speak}>
          Hear it
        </button>
        <button className="btn big" onClick={() => setIndex(Math.min(steps.length - 1, index + 1))} disabled={index === steps.length - 1}>
          Next
        </button>
      </div>
    </main>
  );
}
