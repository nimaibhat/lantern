"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import "@/components/world/world.css";
import type { CameraPreset, WallMode } from "@/components/world/home-scene";
import { Plan2D } from "@/components/world/plan-2d";
import { planMobility, type Profile } from "@/lib/audit/mobility";
import type { HomeModel, Vec2 } from "@/lib/types";
import { PATIENT_LABEL } from "@/lib/world/live-state";
import { simulatePosition, useLive } from "@/lib/world/useLive";

// three.js is only downloaded when someone picks 3D, so the 2D plan opens at once.
const HomeScene = dynamic(() => import("@/components/world/home-scene").then((m) => m.HomeScene), {
  ssr: false,
  loading: () => <div className="w3-loading">Loading 3D view</div>,
});

type ViewKind = "3d" | "2d";
const VIEW_KEY = "lantern-world-view";

function hasWebGL() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

// The signature view: the person moving through their own home, live, in 3D or as a to-scale 2D plan.
export function WorldView({ home, mock, initialView }: { home: HomeModel; mock: boolean; initialView?: ViewKind }) {
  const live = useLive(home, { mock });
  const [view, setView] = useState<ViewKind>("3d");
  const [webgl, setWebgl] = useState(true);
  const [measure, setMeasure] = useState(false);
  const [fitSignal, setFitSignal] = useState(0);

  // The choice is remembered per browser; without WebGL the plan is the only option.
  useEffect(() => {
    const ok = hasWebGL();
    setWebgl(ok);
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(VIEW_KEY);
    } catch {}
    setView(!ok || (initialView ?? saved) === "2d" ? "2d" : "3d");
  }, [initialView]);
  function pick(v: ViewKind) {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {}
  }
  const [camera, setCamera] = useState<CameraPreset>("iso");
  const [walls, setWalls] = useState<WallMode>("low");
  const [dragMode, setDragMode] = useState(false);
  const [ghost, setGhost] = useState<Vec2>();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [note, setNote] = useState("");

  const mobility = useMemo(() => (profile ? planMobility(live.home, profile) : undefined), [live.home, profile]);
  const room = live.home.rooms.find((r) => r.id === live.room);
  const simulated = live.mock || live.lastSource === "sim";
  const listeners = live.home.anchors.map((a) => ({ id: a.receiverId, online: live.listeners[a.receiverId] }));

  async function drop(p: Vec2) {
    setGhost(undefined);
    if (live.mock) {
      const roomId = live.home.rooms.find((r) => r.id === live.room)?.id ?? live.home.rooms[0].id;
      live.push({ t: "position", ts: Date.now(), x: p.x, y: p.y, roomId, confidence: 1, source: "sim" });
      return;
    }
    setNote((await simulatePosition(p)) ?? "");
  }

  return (
    <div className="w3">
      {view === "3d" ? (
        <HomeScene
          state={live}
          camera={camera}
          walls={walls}
          dragMode={dragMode}
          ghost={ghost}
          onDrag={setGhost}
          onDrop={drop}
          mobility={mobility}
        />
      ) : (
        <Plan2D
          state={live}
          dragMode={dragMode}
          ghost={ghost}
          onDrag={setGhost}
          onDrop={drop}
          mobility={mobility}
          measure={measure}
          fitSignal={fitSignal}
        />
      )}

      <div className="w3-hud">
        <div className="w3-card">
          <div className="w3-room">{room?.name ?? "Waiting for a location"}</div>
          <div className="w3-meta">
            {live.position && <span>{Math.round(live.position.confidence * 100)}% confident</span>}
            {live.patient && <span>· {PATIENT_LABEL[live.patient]}</span>}
          </div>
          <div className="w3-meta">
            <span className={`w3-chip ${simulated ? "sim" : ""}`}>{live.mock ? "mock walk" : live.lastSource ?? "no data"}</span>
            <span className={`w3-chip ${live.status === "live" ? "ok" : live.status === "mock" ? "" : "bad"}`}>{live.status}</span>
          </div>
          {live.prediction && (
            <div className="w3-meta">
              Heading to {live.home.rooms.find((r) => r.id === live.prediction!.nextRoomId)?.name} ({Math.round(live.prediction.probability * 100)}%)
            </div>
          )}
        </div>
        {listeners.length > 0 && (
          <div className="w3-card">
            <div className="w3-meta" style={{ marginTop: 0 }}>
              {listeners.map((l) => (
                <span key={l.id} className={`w3-chip ${l.online ? "ok" : l.online === false ? "bad" : ""}`}>
                  {l.id}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {simulated && <div className="w3-sim-badge">SIMULATED</div>}

      <div className="w3-tools">
        <span className="w3-seg" role="group" aria-label="View">
          <button className={`w3-btn ${view === "3d" ? "on" : ""}`} onClick={() => pick("3d")} disabled={!webgl} title={webgl ? "3D model of the home" : "This browser cannot show 3D"}>
            3D
          </button>
          <button className={`w3-btn ${view === "2d" ? "on" : ""}`} onClick={() => pick("2d")} title="To-scale floor plan">
            2D
          </button>
        </span>
        {view === "3d" ? (
          <>
            {(["iso", "top", "follow"] as CameraPreset[]).map((c) => (
              <button key={c} className={`w3-btn ${camera === c ? "on" : ""}`} onClick={() => setCamera(c)}>
                {c === "iso" ? "Angled" : c === "top" ? "Top down" : "Follow"}
              </button>
            ))}
            <button className="w3-btn" onClick={() => setWalls(walls === "low" ? "full" : walls === "full" ? "off" : "low")}>
              Walls: {walls}
            </button>
          </>
        ) : (
          <>
            <button className={`w3-btn ${measure ? "on" : ""}`} onClick={() => setMeasure(!measure)} title="Room sizes, door widths and a tape measure (drag on the plan)">
              {measure ? "Measuring" : "Measure"}
            </button>
            <button className="w3-btn" onClick={() => setFitSignal((n) => n + 1)} title="Zoom out to the whole home (or double-click the plan)">
              Fit
            </button>
          </>
        )}
        <button className={`w3-btn ${dragMode ? "on" : ""}`} onClick={() => setDragMode(!dragMode)} title="Drag on the floor to move the person (uses the simulator)">
          {dragMode ? "Dragging: on" : "Drag to simulate"}
        </button>
        {(["walker", "wheelchair"] as Profile[]).map((p) => (
          <button key={p} className={`w3-btn ${profile === p ? "on" : ""}`} onClick={() => setProfile(profile === p ? null : p)}>
            {p === "walker" ? "Walker routes" : "Wheelchair routes"}
          </button>
        ))}
        <span className="w3-spacer" />
        {note && <span className="w3-note">{note}</span>}
        <button className={`w3-btn ${live.mock ? "on" : ""}`} onClick={() => live.setMock(!live.mock)}>
          {live.mock ? "Stop demo walk" : "Demo walk"}
        </button>
        <Link className="w3-btn" href="/dashboard/world/replay">
          Replay
        </Link>
        <Link className="w3-btn" href="/dashboard/world/edit">
          Edit zones
        </Link>
      </div>
    </div>
  );
}
