// Spoken routine prompts on the patient screen (docs/cues.md, "The day"). Pure: the screen keeps the log and the clock.
// At a step's time: chime and say it, again every 5 minutes, at most 3 times, until they reach that room or someone
// taps Done. A step more than an hour old is left alone.

import type { RoutineStep } from "@/lib/types";

export const PROMPT_EVERY_MS = 5 * 60_000;
export const PROMPT_MAX = 3;
export const PROMPT_WINDOW_MIN = 60;

export type PromptLog = Record<string, { count: number; lastAt: number; done?: boolean }>;

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

// The step for now: the last one whose time has come today.
export function currentStep(steps: RoutineStep[], now: string): RoutineStep | undefined {
  return [...steps].sort((a, b) => b.time.localeCompare(a.time)).find((s) => s.time <= now);
}

export function nextStep(steps: RoutineStep[], now: string): RoutineStep | undefined {
  return [...steps].sort((a, b) => a.time.localeCompare(b.time)).find((s) => s.time > now);
}

// The step to say now, if any. hereRoomId is where they are, in the routine's room ids.
export function duePrompt(steps: RoutineStep[], now: string, nowMs: number, log: PromptLog, hereRoomId?: string): RoutineStep | undefined {
  const step = currentStep(steps, now);
  if (!step || minutes(now) - minutes(step.time) > PROMPT_WINDOW_MIN) return;
  if (step.roomId && step.roomId === hereRoomId) return; // already there
  const seen = log[step.id];
  if (!seen) return step;
  if (seen.done || seen.count >= PROMPT_MAX) return;
  return nowMs - seen.lastAt >= PROMPT_EVERY_MS ? step : undefined;
}

export const logPrompt = (log: PromptLog, stepId: string, nowMs: number): PromptLog => ({
  ...log,
  [stepId]: { ...log[stepId], count: (log[stepId]?.count ?? 0) + 1, lastAt: nowMs },
});

// "15:00" -> "3:00 PM": easier to read than a 24-hour clock.
export function friendlyTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return hhmm;
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

export const logDone =(log: PromptLog, stepId: string): PromptLog => ({ ...log, [stepId]: { count: log[stepId]?.count ?? 0, lastAt: log[stepId]?.lastAt ?? 0, done: true } });
