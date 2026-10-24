import type { AuditItem, Room, Vec2 } from "@/lib/types";

export function roomCenter(room: Room): Vec2 {
  const n = room.outline.length || 1;
  return {
    x: room.outline.reduce((sum, p) => sum + p.x, 0) / n,
    y: room.outline.reduce((sum, p) => sum + p.y, 0) / n,
  };
}

const points = (outline: Vec2[]) => outline.map((p) => `${p.x},${p.y}`).join(" ");

// Plain SVG floor plan in inches. Doors are drawn as gaps in the walls.
export function FloorPlan({
  rooms,
  currentRoomId,
  markers = [],
  showDot = true,
}: {
  rooms: Room[];
  currentRoomId?: string;
  markers?: AuditItem[];
  showDot?: boolean; // false when highlighting a room rather than showing where the patient is
}) {
  const current = rooms.find((r) => r.id === currentRoomId);
  const dot = showDot && current && roomCenter(current);

  // Fit the view to whatever was scanned, with a little margin.
  const pts = rooms.flatMap((r) => r.outline);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const pad = 12;
  const viewBox = pts.length
    ? `${Math.min(...xs) - pad} ${Math.min(...ys) - pad} ${Math.max(...xs) - Math.min(...xs) + pad * 2} ${Math.max(...ys) - Math.min(...ys) + pad * 2}`
    : "0 0 480 360";

  return (
    <svg className="floor-plan" viewBox={viewBox} role="img" aria-label="Floor plan of the home">
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
        room.doors.map((d) => <line key={d.id} className="fp-door" x1={d.start.x} y1={d.start.y} x2={d.end.x} y2={d.end.y} />),
      )}

      {rooms.map((room) => {
        // Labels sit along the bottom edge so they never cover furniture. Thin rooms like hallways keep them centered.
        if (room.outline.length === 0) return null;
        const c = roomCenter(room);
        const top = Math.min(...room.outline.map((p) => p.y));
        const bottom = Math.max(...room.outline.map((p) => p.y));
        return (
          <text key={room.id} className="fp-label" x={c.x} y={bottom - top < 60 ? c.y + 4 : bottom - 12}>
            {room.name}
          </text>
        );
      })}

      {markers
        .filter((m) => m.location)
        .map((m) => (
          <circle key={m.id} className={`fp-marker ${m.severity}`} cx={m.location!.x} cy={m.location!.y} r={7} />
        ))}

      {dot && (
        <g className="fp-dot" style={{ transform: `translate(${dot.x}px, ${dot.y}px)` }}>
          <circle className="fp-dot-pulse" r={16} />
          <circle r={7} />
        </g>
      )}
    </svg>
  );
}
