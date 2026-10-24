"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import "@/components/world/world.css";
import type { HomeProgress, ScanPhoto } from "@/lib/dashboard/homes-actions";
import type { HomeModel } from "@/lib/types";
import { bounds, polygonArea } from "@/lib/world/geometry";
import { initialLive } from "@/lib/world/live-state";

// Step 3 of Add a home: the scan arriving. The floor plan traces itself room by room, lifts into 3D, and a
// checklist fills in beside it as the rules and Claude's photo check finish. It only shows what has really arrived.

const HomeScene = dynamic(() => import("@/components/world/home-scene").then((m) => m.HomeScene), {
  ssr: false,
  loading: () => <div className="bs-scene-loading" />,
});

const ROOM_MS = 450; // each room starts tracing this long after the one before
const TRACE_MS = 900; // one room's walls, start to finish (matches .bs-room in homes.css)
const LIFT_PAUSE_MS = 500; // the finished plan holds this long before it lifts into 3D
const ADA_DOOR_MIN_IN = 32;

const n = (v: number) => v.toLocaleString("en-US");
const plural = (v: number, one: string, many = `${one}s`) => `${n(v)} ${v === 1 ? one : many}`;

function webglOk() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

// The newest model, but the same object until something visible changes, so the 3D scene is not rebuilt every poll.
function useSteadyModel(model?: HomeModel) {
  const ref = useRef<HomeModel>(undefined);
  const key = model ? `${model.version}:${model.rooms.length}:${model.hazards.length}` : "";
  const prevKey = useRef("");
  if (key !== prevKey.current) {
    prevKey.current = key;
    ref.current = model;
  }
  return ref.current;
}

// Signed photo urls change every poll; keep the first one per photo so the tiles do not reload.
function useSteadyPhotos(photos: ScanPhoto[]) {
  const urls = useRef(new Map<string, string>());
  return photos.map((p) => {
    if (!urls.current.has(p.path)) urls.current.set(p.path, p.url);
    return { ...p, url: urls.current.get(p.path)! };
  });
}

type Phase = "waiting" | "tracing" | "lifted";

export function BuildStage({ name, progress, homeHref }: { name: string; progress?: HomeProgress; homeHref: string }) {
  const model = useSteadyModel(progress?.model);
  const photos = useSteadyPhotos(progress?.photos ?? []);
  const [phase, setPhase] = useState<Phase>("waiting");
  const [traced, setTraced] = useState(0); // rooms finished tracing
  const [webgl, setWebgl] = useState(true);
  const [calm, setCalm] = useState(false);

  useEffect(() => {
    setWebgl(webglOk());
    setCalm(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  const rooms = useMemo(() => (model?.rooms ?? []).filter((r) => !r.virtual && r.polygon.length > 2), [model]);

  // Start tracing the first time a model shows up; later polls only update it in place.
  const hasModel = rooms.length > 0;
  useEffect(() => {
    if (!hasModel) return;
    if (calm) {
      setTraced(rooms.length);
      setPhase("lifted");
      return;
    }
    setPhase("tracing");
    const timers = rooms.map((_, i) => setTimeout(() => setTraced(i + 1), i * ROOM_MS + TRACE_MS));
    const lift = setTimeout(() => setPhase("lifted"), (rooms.length - 1) * ROOM_MS + TRACE_MS + LIFT_PAUSE_MS);
    return () => [...timers, lift].forEach(clearTimeout);
  }, [hasModel, calm]);

  const scan = progress?.scan ?? "waiting";

  // Bring the stage into view once, when the upload starts.
  const stage = useRef<HTMLElement>(null);
  const arrived = scan !== "waiting";
  useEffect(() => {
    if (arrived) stage.current?.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "start" });
  }, [arrived, calm]);
  const photosDone = scan === "done";
  const drawn = traced >= rooms.length && hasModel;
  const ready = photosDone && phase === "lifted";
  const areaSqFt = Math.round(rooms.reduce((s, r) => s + polygonArea(r.polygon), 0) / 144);
  const doors = model?.doors ?? [];
  const narrow = doors.filter((d) => d.widthIn < ADA_DOOR_MIN_IN).length;
  const flagged = photos.filter((p) => p.hazard).length;

  const steps: { key: string; state: "done" | "now" | "later"; text: string }[] = [
    {
      key: "upload",
      state: scan === "waiting" ? "now" : "done",
      text: scan === "waiting" ? "Waiting for the upload from the Lantern app" : "Upload received",
    },
    {
      key: "rooms",
      state: !hasModel ? (scan === "waiting" ? "later" : "now") : drawn ? "done" : "now",
      text: hasModel ? `${plural(traced, "room")} measured${drawn ? `, ${n(areaSqFt)} sq ft` : ""}` : "Measuring the rooms",
    },
    {
      key: "doors",
      state: drawn ? "done" : "later",
      text: drawn ? `${plural(doors.length, "doorway")} checked, ${n(narrow)} narrower than 32 in` : "Checking doorways",
    },
    {
      key: "rules",
      state: drawn ? "done" : "later",
      text: drawn ? `${plural(progress?.issues ?? 0, "accessibility item")} for an occupational therapist to review` : "Checking turning space and routes",
    },
    {
      key: "photos",
      state: photosDone ? "done" : drawn ? "now" : "later",
      text: photosDone
        ? `${plural(progress?.photoHazards ?? 0, "hazard")} spotted in the photos`
        : "Claude is looking at the photos",
    },
  ];

  if (scan === "failed")
    return (
      <section className="build-stage failed" aria-live="polite">
        <div className="bs-scene">
          <p className="bs-empty">The scan could not be read. Scan again from the Lantern app, then tap Upload.</p>
        </div>
      </section>
    );

  return (
    <section ref={stage} className={`build-stage ${phase}`} aria-label={`${name}, building from the scan`}>
      <div className="bs-scene">
        {phase === "waiting" && (
          <div className="bs-empty">
            <span className="bs-pulse" aria-hidden />
            <p>{name} will appear here as soon as the scan is uploaded.</p>
          </div>
        )}

        {hasModel && <Plan rooms={rooms} model={model!} traced={traced} />}

        {phase === "lifted" && webgl && (
          <div className="bs-3d">
            <HomeScene state={initialLive(model!)} camera="iso" walls="low" showcase={!calm} intro={!calm} />
          </div>
        )}

        {ready && (
          <a className="bs-open" href={homeHref}>
            Open {name.replace(/^The /, "the ")}
          </a>
        )}
      </div>

      <aside className="bs-side">
        <ol className="bs-steps" aria-live="polite">
          {steps.map((s) => (
            <li key={s.key} className={s.state}>
              <span className="bs-mark" aria-hidden />
              <span>{s.text}</span>
            </li>
          ))}
        </ol>

        {photos.length > 0 && (
          <ul className="bs-photos" aria-label="Room photos">
            {photos.map((p, i) => (
              <li key={p.path} style={{ animationDelay: `${i * 90}ms` }} className={photosDone && p.hazard ? "hazard" : undefined}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt={p.hazard ? `Photo with a hazard: ${p.hazard}` : "Room photo"} title={p.hazard} />
              </li>
            ))}
          </ul>
        )}
        {photosDone && flagged > 0 && <p className="bs-note">Photos outlined in amber show a hazard. The audit lists the fix for each one.</p>}
      </aside>
    </section>
  );
}

// The floor plan tracing itself: each room's outline draws in order, then fills, then its name appears.
function Plan({ rooms, model, traced }: { rooms: HomeModel["rooms"]; model: HomeModel; traced: number }) {
  const box = bounds(rooms.flatMap((r) => r.polygon));
  const pad = Math.max(box.width, box.height) * 0.08;
  const view = `${box.center.x - box.width / 2 - pad} ${box.center.y - box.height / 2 - pad} ${box.width + pad * 2} ${box.height + pad * 2}`;
  const unit = Math.max(box.width, box.height) / 160;
  const allDrawn = traced >= rooms.length;
  return (
    <svg className="bs-plan" viewBox={view} role="img" aria-label={`Floor plan: ${rooms.map((r) => r.name).join(", ")}`}>
      {rooms.map((r, i) => (
        <g key={r.id} className={i < traced ? "bs-room drawn" : "bs-room"} style={{ "--delay": `${i * ROOM_MS}ms` } as React.CSSProperties}>
          <polygon points={r.polygon.map((p) => `${p.x},${p.y}`).join(" ")} pathLength={1} strokeWidth={unit} />
          <text x={r.centroid.x} y={r.centroid.y} fontSize={unit * 5.5} textAnchor="middle" dominantBaseline="middle">
            {r.name}
          </text>
        </g>
      ))}
      {allDrawn &&
        model.doors.map((d) => <circle key={d.id} cx={d.center.x} cy={d.center.y} r={unit * 1.8} className={d.widthIn < ADA_DOOR_MIN_IN ? "bs-door narrow" : "bs-door"} />)}
      {allDrawn &&
        model.hazards.map((h, i) => (
          <circle key={h.id} cx={h.position.x} cy={h.position.y} r={unit * 3} className="bs-hazard" style={{ animationDelay: `${i * 120}ms` }} />
        ))}
    </svg>
  );
}
