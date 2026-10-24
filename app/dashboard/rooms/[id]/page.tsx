import Link from "next/link";
import { notFound } from "next/navigation";
import { getAuditItems, getRooms } from "@/lib/dashboard/data";
import { worldLabsConfigured } from "@/lib/scan/worldlabs";
import { FloorPlan } from "@/app/dashboard/_components/floor-plan";
import { RoomPreview } from "../room-preview";

const ORDER = { high: 0, medium: 1, low: 2 } as const;

export default async function RoomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [rooms, allItems] = await Promise.all([getRooms(), getAuditItems()]);
  const room = rooms.find((r) => r.id === id);
  if (!room) notFound();

  const items = allItems.filter((a) => a.roomId === room.id && a.status !== "dismissed").sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
  const xs = room.outline.map((p) => p.x);
  const ys = room.outline.map((p) => p.y);
  const size = xs.length ? `${feet(Math.max(...xs) - Math.min(...xs))} × ${feet(Math.max(...ys) - Math.min(...ys))}` : "Not measured";

  return (
    <div className="room">
      <div className="page-head">
        <div>
          <Link href="/dashboard/rooms" className="muted back">
            ← Rooms
          </Link>
          <h1>{room.name}</h1>
          <p className="muted">
            {size} · {count(room.doors.filter((d) => d.kind === "door").length, "door")} · {count(room.objects.length, "object")} detected
          </p>
        </div>
      </div>

      <div className="room-top">
        <section className="card">
          <div className="card-head">
            <h2>3D preview</h2>
            <span className="muted mono">World Labs</span>
          </div>
          <RoomPreview roomId={room.id} initial={room.preview ?? { status: "none" }} hasPhotos={room.photoPaths.length > 0} enabled={worldLabsConfigured} />
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Floor plan</h2>
            <span className="muted mono">RoomPlan</span>
          </div>
          <FloorPlan rooms={rooms} currentRoomId={room.id} markers={items} showDot={false} />
          {room.objects.length > 0 && <p className="muted small">Detected: {[...new Set(room.objects.map((o) => o.category))].join(", ")}</p>}
        </section>
      </div>

      <section className="card">
        <div className="card-head">
          <h2>Photos</h2>
        </div>
        {room.photoUrls?.length ? (
          <div className="photo-grid">
            {room.photoUrls.map((url) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={url} src={url} alt={`${room.name} photo`} />
            ))}
          </div>
        ) : (
          <p className="muted">No photos yet. Tap the camera button while scanning this room.</p>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Safety items</h2>
          <Link href="/dashboard/audit">Full report</Link>
        </div>
        {items.length === 0 && <p className="muted">Nothing flagged in this room.</p>}
        <ul className="audit-list">
          {items.map((a) => (
            <li key={a.id} className="audit-item">
              <div className="audit-main">
                <div className="audit-title">
                  <span className={`badge ${a.severity}`}>{a.severity}</span>
                  <strong>{a.title}</strong>
                  {a.code && <span className="mono muted">{a.code}</span>}
                </div>
                <p>{a.detail}</p>
                <p className="fix">Fix: {a.fix}</p>
              </div>
              {a.photoUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="audit-photo" src={a.photoUrl} alt="" />
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
