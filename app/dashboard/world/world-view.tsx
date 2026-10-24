"use client";

import Link from "next/link";
import "@/components/world/world.css";
import { planMobility, type Profile } from "@/lib/audit/mobility";
import type { HomeModel, Vec2 } from "@/lib/types";
import { PATIENT_LABEL } from "@/lib/world/live-state";
import { simulatePosition, useLive } from "@/lib/world/useLive";

  const live = useLive(home, { mock });
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
          dragMode={dragMode}
          ghost={ghost}
          onDrag={setGhost}
          onDrop={drop}
          mobility={mobility}

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
            {(["iso", "top", "follow"] as CameraPreset[]).map((c) => (
              <button key={c} className={`w3-btn ${camera === c ? "on" : ""}`} onClick={() => setCamera(c)}>
              </button>
            ))}
            <button className="w3-btn" onClick={() => setWalls(walls === "low" ? "full" : walls === "full" ? "off" : "low")}>
              Walls: {walls}
            </button>
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
