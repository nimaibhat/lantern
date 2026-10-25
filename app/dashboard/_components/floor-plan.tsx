import type { MouseEvent } from "react";
import type { LiveFeed } from "@/components/world/live-marker";
import type { AuditItem, Room, Vec2 } from "@/lib/types";
import { innerPoint } from "@/lib/world/geometry";
import { LiveLayer, type PlanSensor } from "./live-layer";

export function roomCenter(room: Room): Vec2 {
  const n = room.outline.length || 1;
  return {
    x: room.outline.reduce((sum, p) => sum + p.x, 0) / n,
    y: room.outline.reduce((sum, p) => sum + p.y, 0) / n,
  };
}

const points = (outline: Vec2[]) => outline.map((p) => `${p.x},${p.y}`).join(" ");

// Plain SVG floor plan in inches. Doors are drawn as gaps in the walls.
// With live, the person is drawn where the monitor places them (and the sensors that hear them); until a position
// arrives, the dot sits in the middle of the current room as before.
export function FloorPlan({
  rooms,
  currentRoomId,
  markers = [],
  showDot = true,
  live,
  sensors = [],
  onPick,
}: {
  rooms: Room[];
  currentRoomId?: string;
  markers?: AuditItem[];
  showDot?: boolean; // false when highlighting a room rather than showing where the patient is
  live?: { feed: () => LiveFeed | undefined; state: "fresh" | "stale" | "none" };
  sensors?: PlanSensor[];
  onPick?: (p: Vec2) => void; // set while placing a device: a click on the plan says where it stands
}) {
  const current = rooms.find((r) => r.id === currentRoomId);
  const dot = showDot && current && (!live || live.state === "none") && roomCenter(current);

  // Fit the view to whatever was scanned, with a little margin.
  const pts = rooms.flatMap((r) => r.outline);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const pad = 12;
  const viewBox = pts.length
    ? `${Math.min(...xs) - pad} ${Math.min(...ys) - pad} ${Math.max(...xs) - Math.min(...xs) + pad * 2} ${Math.max(...ys) - Math.min(...ys) + pad * 2}`
    : "0 0 480 360";

  // From where the click landed on screen to inches on the plan
  const pick = onPick
    ? (e: MouseEvent<SVGSVGElement>) => {
        const m = e.currentTarget.getScreenCTM();
        if (!m) return;
        const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
        onPick({ x: p.x, y: p.y });
      }
    : undefined;

  return (
    <svg className={onPick ? "floor-plan picking" : "floor-plan"} viewBox={viewBox} role="img" aria-label="Floor plan of the home" onClick={pick}>
      {rooms.map((room) => (
        <polygon key={room.id} points={points(room.outline)} className={room.id === currentRoomId ? "fp-room active" : "fp-room"} />
      ))}

      {rooms.flatMap((room) =>
        room.objects.map((o) => (
          <rect
            key={o.id}
            className="fp-object"
            x={o.center.x - o.widthIn / 2}
            y={o.center.y - o.depthIn / 2}
            width={o.widthIn}
            height={o.depthIn}
            rx={3}
            transform={`rotate(${o.rotationDeg} ${o.center.x} ${o.center.y})`}
          />
        )),
      )}

      {rooms.flatMap((room) =>
        room.doors.map((d) => <line key={`${room.id}:${d.id}`} className="fp-door" x1={d.start.x} y1={d.start.y} x2={d.end.x} y2={d.end.y} />),
      )}

      {rooms.map((room) => {
        // At the most open point inside the room, so an L or T shaped room (a hallway) never labels its neighbour.
        if (room.outline.length < 3) return null;
        const c = innerPoint(room.outline);
        // A sensor standing in the middle of the room would cover the name, so the name sits just above it
        const under = sensors.find((s) => Math.abs(s.x - c.x) < 40 && Math.abs(s.y - c.y) < 26);
        return (
          <text key={room.id} className="fp-label" x={c.x} y={under ? under.y - 13 : c.y + 4}>
            {room.name}
          </text>
        );
      })}

      {markers
        .filter((m) => m.location)
        .map((m) => (
          <circle key={m.id} className={`fp-marker ${m.severity}`} cx={m.location!.x} cy={m.location!.y} r={7} />
        ))}

      {(live || sensors.length > 0) && <LiveLayer feed={showDot ? live?.feed : undefined} stale={live?.state === "stale"} sensors={sensors} />}

      {dot && (
        <g className="fp-dot" style={{ transform: `translate(${dot.x}px, ${dot.y}px)` }}>
          <circle className="fp-dot-pulse" r={16} />
          <circle r={7} />
        </g>
      )}
    </svg>
  );
}
