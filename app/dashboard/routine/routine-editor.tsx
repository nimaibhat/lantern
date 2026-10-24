"use client";

import Link from "next/link";
import { useState } from "react";
import { addRoutineStep, removeRoutineStep } from "@/lib/dashboard/actions";
import { roomName } from "@/lib/dashboard/rooms";
import type { Room, RoutineStep } from "@/lib/types";

// Caregiver editor for the daily routine. Changes save to Supabase.
export function RoutineEditor({ initialSteps, rooms }: { initialSteps: RoutineStep[]; rooms: Room[] }) {
  const [steps, setSteps] = useState<RoutineStep[]>(initialSteps);
  const [error, setError] = useState("");
  const [time, setTime] = useState("08:00");
  const [title, setTitle] = useState("");
  const [roomId, setRoomId] = useState(rooms[0]?.id ?? "");

  const sorted = [...steps].sort((a, b) => a.time.localeCompare(b.time));

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    try {
      const step = await addRoutineStep({ time, title, roomId });
      setSteps((all) => [...all, step]);
      setTitle("");
      setError("");
    } catch {
      setError("Could not save that step. Try again.");
    }
  }

  async function remove(id: string) {
    const before = steps;
    setSteps(steps.filter((s) => s.id !== id));
    try {
      await removeRoutineStep(id);
    } catch {
      setSteps(before);
      setError("Could not remove that step. Try again.");
    }
  }

  return (
    <div className="routine">
      <div className="page-head">
        <div>
          <h1>Daily routine</h1>
          <p className="muted">Each step shows a real photo of the room and plays a recorded voice.</p>
        </div>
        <span className="page-actions">
          <Link href="/signs" className="btn ghost">
            Print door signs
          </Link>
          <Link href="/routine" className="btn">
            Open patient view
          </Link>
        </span>
      </div>

      <form className="card add-step" onSubmit={add}>
        <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        <input placeholder="What should happen?" value={title} onChange={(e) => setTitle(e.target.value)} />
        <select value={roomId} onChange={(e) => setRoomId(e.target.value)}>
          {rooms.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        <button className="btn">Add step</button>
      </form>
      {error && <p className="error">{error}</p>}

      <ol className="steps">
        {sorted.map((s) => (
          <li key={s.id} className="card step">
            <div className="step-photo">{roomName(rooms, s.roomId)}</div>
            <div className="step-body">
              <span className="mono muted">{s.time}</span>
              <strong>{s.title}</strong>
            </div>
            <button className="btn small ghost" onClick={() => remove(s.id)}>
              Remove
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
