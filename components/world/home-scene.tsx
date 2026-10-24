"use client";

// The home in 3D, built procedurally from the HomeModel so the geometry matches the coordinates the
// avatar uses. Plan (x, y) inches map to scene (x * 0.0254, 0, y * 0.0254) meters, up is +Y.

import { Line, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { HomeModel, HomeRoom, RiskState, Vec2 } from "@/lib/types";
import type { MobilityLeg } from "@/lib/audit/mobility";
import { bounds, IN_TO_M, roomAt, routeBetween } from "@/lib/world/geometry";
import type { LiveState } from "@/lib/world/live-state";
import { riskByRoom } from "@/lib/world/live-state";
import { doorAxis, wallPieces } from "@/lib/world/walls";
import { Avatar } from "./avatar";
import { FLOOR, HERE, RISK_FLOOR } from "./palette";

export type CameraPreset = "top" | "iso" | "follow";
export interface HeatCell { x: number; y: number; weight: number } // plan inches, weight 0..1

const M = (p: Vec2, h = 0): [number, number, number] => [p.x * IN_TO_M, h, p.y * IN_TO_M];
const WALL_IN = 96;
const LINTEL_IN = 80;
const WALL_THICK_M = 0.08;

// Text pinned to a point in the scene. drei's <Html> mounts a React root per label, and StrictMode's dev double
// mount unmounts those roots mid-render: a console error per label and the dev overlay's issue badge on the demo
// screen. These labels are plain text, so a bare DOM node moved every frame does the same job. No z-index, so the
// HUD drawn after the canvas stays on top.
function Label({ position, text, className, visible = true }: { position: [number, number, number]; text: string; className: string; visible?: boolean }) {
  const gl = useThree((s) => s.gl);
  const el = useRef<HTMLDivElement | null>(null);
  const v = useMemo(() => new THREE.Vector3(), []);
  useEffect(() => {
    const div = document.createElement("div");
    div.style.cssText = "position:absolute;top:0;left:0;pointer-events:none;";
    gl.domElement.parentNode?.appendChild(div);
    el.current = div;
    return () => {
      div.remove();
      el.current = null;
    };
  }, [gl]);
  useFrame(({ camera, size }) => {
    const div = el.current;
    if (!div) return;
    if (div.className !== className) div.className = className;
    if (div.textContent !== text) div.textContent = text;
    v.set(...position).project(camera);
    div.style.visibility = visible && v.z < 1 ? "visible" : "hidden"; // z >= 1: behind the camera
    div.style.transform = `translate3d(${((v.x + 1) / 2) * size.width}px, ${((1 - v.y) / 2) * size.height}px, 0) translate(-50%, -50%)`;
  });
  return null;
}


function Floor({ room, here, risk, outlined }: { room: HomeRoom; here: boolean; risk?: RiskState; outlined?: boolean }) {
  const shape = useMemo(() => {
    const s = new THREE.Shape();
    room.polygon.forEach((p, i) => (i ? s.lineTo(p.x * IN_TO_M, p.y * IN_TO_M) : s.moveTo(p.x * IN_TO_M, p.y * IN_TO_M)));
    s.closePath();
    return s;
  }, [room.polygon]);
  const color = risk ? RISK_FLOOR[risk] : here ? HERE : FLOOR[room.kind];
  const outline = [...room.polygon, room.polygon[0]].map((p) => M(p, 0.01));
  return (
    <group>
      {/* Rotating +90 degrees about X maps the shape's (x, y) onto the floor's (x, z). */}
      <mesh rotation={[Math.PI / 2, 0, 0]} receiveShadow>
        <shapeGeometry args={[shape]} />
        <meshStandardMaterial color={color} side={THREE.DoubleSide} transparent opacity={room.virtual ? 0.75 : 1} />
      </mesh>
      {(risk === "escalated" || outlined) && <Line points={outline} color={risk === "escalated" ? "#b5452f" : "#f5a54a"} lineWidth={3} />}
    </group>
  );
}

function Walls({ home, opacity, heightIn }: { home: HomeModel; opacity: number; heightIn?: number }) {
  const pieces = useMemo(() => wallPieces(home), [home]);
  const height = (heightIn ?? (home.rooms[0]?.heightIn || WALL_IN)) * IN_TO_M;
  return (
    <group>
      {pieces.map(([a, b], i) => {
        const len = Math.hypot(b.x - a.x, b.y - a.y) * IN_TO_M;
        if (len < 0.02) return null;
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        return (
          <mesh key={i} position={M(mid, height / 2)} rotation={[0, -Math.atan2(b.y - a.y, b.x - a.x), 0]}>
            <boxGeometry args={[len, height, WALL_THICK_M]} />
            <meshStandardMaterial color="#efe9df" transparent opacity={opacity} depthWrite={opacity > 0.9} />
          </mesh>
        );
      })}
      {home.doors.map((d) => {
        const axis = doorAxis(home, d);
        const h = height - LINTEL_IN * IN_TO_M;
        if (h <= 0) return null;
        return (
          <mesh key={d.id} position={M(d.center, LINTEL_IN * IN_TO_M + h / 2)} rotation={[0, -Math.atan2(axis.y, axis.x), 0]}>
            <boxGeometry args={[d.widthIn * IN_TO_M, h, WALL_THICK_M]} />
            <meshStandardMaterial color="#e4dccf" transparent opacity={opacity} depthWrite={opacity > 0.9} />
          </mesh>
        );
      })}
    </group>
  );
}

function Furniture({ home }: { home: HomeModel }) {
  return (
    <group>
      {home.rooms.flatMap((r) =>
        (r.objects ?? []).map((o) => {
          const h = Math.max(4, o.heightIn) * IN_TO_M;
          return (
            <mesh key={o.id} position={M(o.center, h / 2)} rotation={[0, (-o.rotationDeg * Math.PI) / 180, 0]} castShadow>
              <boxGeometry args={[o.widthIn * IN_TO_M, h, o.depthIn * IN_TO_M]} />
              <meshStandardMaterial color="#a89a88" transparent opacity={0.85} />
            </mesh>
          );
        }),
      )}
    </group>
  );
}

function Listener({ position, online, rssi }: { position: Vec2; online?: boolean; rssi?: number }) {
  const ring = useRef<THREE.Mesh>(null!);
  const strength = rssi === undefined ? 0.4 : Math.max(0.1, Math.min(1, (rssi + 100) / 60));
  useFrame((state) => {
    const t = (state.clock.elapsedTime * 0.8) % 1;
    ring.current.scale.setScalar(0.4 + t * 1.6 * strength);
    (ring.current.material as THREE.MeshBasicMaterial).opacity = online === false ? 0 : (1 - t) * 0.5;
  });
  return (
    <group position={M(position)}>
      <mesh position={[0, 0.45, 0]}>
        <coneGeometry args={[0.1, 0.25, 12]} />
        <meshStandardMaterial color={online === false ? "#9a8f84" : "#5c7f9e"} />
      </mesh>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <ringGeometry args={[0.3, 0.36, 40]} />
        <meshBasicMaterial color="#5c7f9e" transparent depthWrite={false} />
      </mesh>
    </group>
  );
}

function HazardPin({ position, title, severity }: { position: Vec2; title: string; severity: string }) {
  const [hover, setHover] = useState(false);
  return (
    <group position={M(position, 0.15)}>
      <mesh onPointerOver={() => setHover(true)} onPointerOut={() => setHover(false)}>
        <sphereGeometry args={[0.09, 16, 16]} />
        <meshStandardMaterial color={severity === "high" ? "#b5452f" : "#e09a3c"} emissive={severity === "high" ? "#b5452f" : "#e09a3c"} emissiveIntensity={0.5} />
      </mesh>
      <Label position={M(position, 0.45)} text={title} className="w3-tip" visible={hover} />
    </group>
  );
}

function Heat({ cells, cellIn }: { cells: HeatCell[]; cellIn: number }) {
  const mesh = useRef<THREE.InstancedMesh>(null!);
  useEffect(() => {
    const m = new THREE.Matrix4(), c = new THREE.Color();
    cells.forEach((cell, i) => {
      m.makeTranslation(cell.x * IN_TO_M, 0.015, cell.y * IN_TO_M);
      mesh.current.setMatrixAt(i, m);
      mesh.current.setColorAt(i, c.set("#f5a54a").lerp(new THREE.Color("#b5452f"), cell.weight));
    });
    mesh.current.instanceMatrix.needsUpdate = true;
    if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true;
  }, [cells]);
  if (cells.length === 0) return null;
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, cells.length]}>
      <boxGeometry args={[cellIn * IN_TO_M, 0.01, cellIn * IN_TO_M]} />
      <meshBasicMaterial transparent opacity={0.45} depthWrite={false} />
    </instancedMesh>
  );
}

function CameraRig({ preset, home, follow }: { preset: CameraPreset; home: HomeModel; follow?: Vec2 }) {
  const { camera, controls } = useThree() as unknown as { camera: THREE.PerspectiveCamera; controls: OrbitControlsImpl | null };
  const box = useMemo(() => bounds(home.rooms.flatMap((r) => r.polygon)), [home]);
  const center = useMemo(() => new THREE.Vector3(box.center.x * IN_TO_M, 0, box.center.y * IN_TO_M), [box]);
  const size = Math.max(box.width, box.height) * IN_TO_M;

  useEffect(() => {
    if (!controls) return;
    if (preset === "top") camera.position.set(center.x, size * 1.35, center.z + 0.01);
    if (preset === "iso") camera.position.set(center.x + size * 0.55, size * 0.85, center.z + size * 0.95);
    controls.target.copy(center);
    controls.update();
  }, [preset, controls, camera, center, size]);

  const offset = useRef(new THREE.Vector3(0, 4.5, 4.5));
  useFrame(() => {
    if (preset !== "follow" || !follow || !controls) return;
    const goal = new THREE.Vector3(follow.x * IN_TO_M, 0, follow.y * IN_TO_M);
    controls.target.lerp(goal, 0.08);
    camera.position.lerp(goal.clone().add(offset.current), 0.08);
    controls.update();
  });
  return null;
}

// Invisible floor that turns pointer drags into plan coordinates (drag-to-simulate).
function DragPlane({ home, onMove, onDrop }: { home: HomeModel; onMove(p: Vec2): void; onDrop(p: Vec2): void }) {
  const dragging = useRef(false);
  const last = useRef<Vec2 | null>(null);
  const box = bounds(home.rooms.flatMap((r) => r.polygon));
  const toPlan = (e: ThreeEvent<PointerEvent>): Vec2 => ({ x: e.point.x / IN_TO_M, y: e.point.z / IN_TO_M });
  const inside = (p: Vec2) => !!roomAt(home, p);
  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[box.center.x * IN_TO_M, 0.005, box.center.y * IN_TO_M]}
      onPointerDown={(e) => {
        e.stopPropagation();
        (e.target as Element)?.setPointerCapture?.(e.pointerId);
        dragging.current = true;
        const p = toPlan(e);
        if (inside(p)) (last.current = p), onMove(p);
      }}
      onPointerMove={(e) => {
        if (!dragging.current) return;
        const p = toPlan(e);
        if (inside(p)) (last.current = p), onMove(p);
      }}
      onPointerUp={() => {
        dragging.current = false;
        if (last.current) onDrop(last.current);
      }}
    >
      <planeGeometry args={[(box.width + 120) * IN_TO_M, (box.height + 120) * IN_TO_M]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}

export type WallMode = "full" | "low" | "off";

export interface HomeSceneProps {
  state: LiveState;
  camera: CameraPreset;
  walls?: WallMode;
  dragMode?: boolean;
  onDrag?(p: Vec2): void; // live position while dragging
  onDrop?(p: Vec2): void; // released: send /sim/position
  ghost?: Vec2; // where the user is dragging the person
  mobility?: MobilityLeg[];
  heat?: { cells: HeatCell[]; cellIn: number };
  showcase?: boolean; // slow auto-rotate, zoom off (the Homes page hero)
  intro?: boolean; // walls and furniture rise in on first draw
}

// The walls and furniture grow up out of the floor plan once, when the scene first draws (the Homes page hero).
function Rise({ children, delayMs = 0, ms = 1400 }: { children: React.ReactNode; delayMs?: number; ms?: number }) {
  const group = useRef<THREE.Group>(null!);
  const start = useRef<number | null>(null);
  useFrame(({ clock }) => {
    start.current ??= clock.elapsedTime;
    const k = Math.min(1, Math.max(0, ((clock.elapsedTime - start.current) * 1000 - delayMs) / ms));
    group.current.scale.y = Math.max(0.001, 1 - Math.pow(1 - k, 3));
  });
  return (
    <group ref={group} scale={[1, 0.001, 1]}>
      {children}
    </group>
  );
}

export function HomeScene({ state, camera, walls = "low", dragMode, onDrag, onDrop, ghost, mobility, heat, showcase, intro }: HomeSceneProps) {
  const { home, position, room, prediction, trail } = state;
  const risks = riskByRoom(state);
  const roomName = (id: string) => home.rooms.find((r) => r.id === id)?.name ?? id;
  const predicted = prediction && room ? routeBetween(home, room, prediction.nextRoomId) : [];
  const target = ghost ?? (position ? { x: position.x, y: position.y } : undefined);
  const next = prediction ? home.rooms.find((r) => r.id === prediction.nextRoomId) : undefined;

  return (
    <Canvas shadows="percentage" dpr={[1, 1.5]} camera={{ fov: 45, near: 0.05, far: 200, position: [8, 10, 12] }}>
      <color attach="background" args={["#1a1714"]} />
      <hemisphereLight args={["#fff4e5", "#3b342d", 0.9]} />
      <directionalLight position={[6, 12, 4]} intensity={0.8} castShadow />
      {/* Showcase: a slow turn, and no zoom so the page under the hero still scrolls. */}
      <OrbitControls makeDefault enabled={!dragMode} maxPolarAngle={Math.PI / 2.1} autoRotate={showcase} autoRotateSpeed={0.35} enableZoom={!showcase} />
      <CameraRig preset={camera} home={home} follow={target} />

      {home.rooms.map((r) => (
        <Floor key={r.id} room={r} here={r.id === room} risk={risks[r.id]} outlined={r.id === next?.id} />
      ))}
      {intro ? (
        <>
          <Rise>{walls !== "off" && <Walls home={home} opacity={walls === "full" ? 0.3 : 0.55} heightIn={walls === "low" ? 30 : undefined} />}</Rise>
          <Rise delayMs={500}>
            <Furniture home={home} />
          </Rise>
        </>
      ) : (
        <>
          {walls !== "off" && <Walls home={home} opacity={walls === "full" ? 0.3 : 0.55} heightIn={walls === "low" ? 30 : undefined} />}
          <Furniture home={home} />
        </>
      )}
      {heat && <Heat cells={heat.cells} cellIn={heat.cellIn} />}

      {home.rooms.map((r) => (
        <Label key={r.id} position={M(r.centroid, 0.05)} text={`${r.name}${r.virtual ? " (zone)" : ""}`} className="w3-label" />
      ))}
      {home.anchors.map((a) => (
        <Listener key={a.receiverId} position={a.position} online={state.listeners[a.receiverId]} rssi={state.rssi[a.receiverId]} />
      ))}
      {home.hazards.map((h) => (
        <HazardPin key={h.id} position={h.position} title={h.title} severity={h.severity} />
      ))}

      {mobility?.map((leg, i) =>
        leg.path.length > 1 ? (
          <group key={i}>
            <Line points={leg.path.map((p) => M(p, 0.03))} color={leg.ok ? "#4f7a52" : "#d9573e"} lineWidth={leg.ok ? 1.5 : 3} transparent opacity={leg.ok ? 0.5 : 1} />
            {leg.blockedAt && (
              <mesh position={M(leg.blockedAt, 0.1)}>
                <sphereGeometry args={[0.12, 16, 16]} />
                <meshBasicMaterial color="#d9573e" />
              </mesh>
            )}
          </group>
        ) : null,
      )}

      {predicted.length > 1 && <Line points={predicted.map((p) => M(p, 0.04))} color="#f5a54a" lineWidth={2} dashed dashSize={0.25} gapSize={0.15} />}
      {/* Always mounted; hidden when there is no prediction (see the hazard tooltip note). */}
      <Label
        position={next ? M(next.centroid, 1.2) : [0, -10, 0]}
        text={next && prediction ? `Predicted: ${roomName(next.id)} ${Math.round(prediction.probability * 100)}%` : ""}
        className="w3-predict"
        visible={!!(next && prediction)}
      />

      {trail.length > 1 && (
        <Line
          points={trail.map((p) => M(p, 0.05))}
          vertexColors={trail.map((_, i) => new THREE.Color("#3b342d").lerp(new THREE.Color("#f5a54a"), i / (trail.length - 1)).toArray() as [number, number, number])}
          lineWidth={3}
        />
      )}
      {target && <Avatar target={target} confidence={ghost ? 1 : position?.confidence ?? 1} velocity={ghost ? undefined : position?.velocity} />}
      {dragMode && onDrag && onDrop && <DragPlane home={home} onMove={onDrag} onDrop={onDrop} />}
    </Canvas>
  );
}

// Count time spent per cell from a list of positions (for the replay heat map).
export function heatCells(points: Vec2[], cellIn = 12): HeatCell[] {
  const counts = new Map<string, { x: number; y: number; n: number }>();
  for (const p of points) {
    const cx = Math.floor(p.x / cellIn), cy = Math.floor(p.y / cellIn);
    const k = `${cx},${cy}`;
    const c = counts.get(k) ?? { x: (cx + 0.5) * cellIn, y: (cy + 0.5) * cellIn, n: 0 };
    c.n++;
    counts.set(k, c);
  }
  const max = Math.max(1, ...[...counts.values()].map((c) => c.n));
  return [...counts.values()].map((c) => ({ x: c.x, y: c.y, weight: c.n / max }));
}

