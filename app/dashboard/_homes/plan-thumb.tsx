import type { HomeModel, Vec2 } from "@/lib/types";
import { bounds } from "@/lib/world/geometry";

// A home's floor plan as a line drawing: the card picture on the Homes page and the no-WebGL hero.
export function PlanThumb({ home, person, alertRoom, className }: { home: HomeModel; person?: Vec2; alertRoom?: string; className?: string }) {
  const rooms = home.rooms.filter((r) => r.polygon.length > 2);
  if (rooms.length === 0) return <div className={`plan-thumb empty ${className ?? ""}`} />;
  const box = bounds(rooms.flatMap((r) => r.polygon));
  const pad = Math.max(box.width, box.height) * 0.06;
  const view = `${box.center.x - box.width / 2 - pad} ${box.center.y - box.height / 2 - pad} ${box.width + pad * 2} ${box.height + pad * 2}`;
  const stroke = Math.max(box.width, box.height) / 160;
  return (
    <svg className={`plan-thumb ${className ?? ""}`} viewBox={view} role="img" aria-label={`Floor plan: ${rooms.map((r) => r.name).join(", ")}`}>
      {rooms.map((r) => (
        <polygon
          key={r.id}
          points={r.polygon.map((p) => `${p.x},${p.y}`).join(" ")}
          className={r.id === alertRoom ? "pt-room alert" : `pt-room k-${r.kind}`}
          strokeWidth={stroke}
        />
      ))}
      {home.doors.map((d) => (
        <circle key={d.id} cx={d.center.x} cy={d.center.y} r={stroke * 1.6} className="pt-door" />
      ))}
      {person && <circle cx={person.x} cy={person.y} r={stroke * 4} className="pt-person" />}
    </svg>
  );
}
