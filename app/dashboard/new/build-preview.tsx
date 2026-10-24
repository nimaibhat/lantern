"use client";

import { useEffect, useState } from "react";
import type { HomeProgress } from "@/lib/dashboard/homes-actions";
import type { HomeModel } from "@/lib/types";
import { BuildStage } from "./build-stage";

// Dev only (/dashboard/new?preview=1): plays a made-up upload of the sample home through the build view,
// so the animation can be checked without a phone. Nothing is written.

const TIMELINE: { at: number; scan: HomeProgress["scan"]; model?: boolean; photosDone?: boolean }[] = [
  { at: 0, scan: "waiting" },
  { at: 2000, scan: "uploading" },
  { at: 3500, scan: "processing", model: true },
  { at: 11000, scan: "done", model: true, photosDone: true },
];

export function BuildPreview({ model, name }: { model: HomeModel; name: string }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const timers = TIMELINE.map((s, i) => setTimeout(() => setStep(i), s.at));
    return () => timers.forEach(clearTimeout);
  }, []);
  const s = TIMELINE[step];
  const progress: HomeProgress = {
    scan: s.scan,
    model: s.model ? model : undefined,
    rooms: s.model ? model.rooms.length : 0,
    issues: s.model ? 8 : 0,
    photoHazards: s.photosDone ? 5 : 0,
    photos: [],
  };
  return <BuildStage name={name} progress={progress} homeHref="/dashboard" />;
}
