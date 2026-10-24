import Link from "next/link";
import { getAuditItems, getLatestScan, getRooms } from "@/lib/dashboard/data";

const PREVIEW_LABEL = { none: "", generating: "3D building", ready: "3D ready", failed: "3D failed" } as const;

export default async function RoomsPage() {
  const [rooms, items, scan] = await Promise.all([getRooms(), getAuditItems(), getLatestScan()]);
  const openCount = (roomId: string) => items.filter((a) => a.roomId === roomId && a.status === "open").length;

  return (
    <div className="rooms">
      <div className="page-head">
        <div>
          <h1>Rooms</h1>
          <p className="muted">
            {scan ? `Last scan ${scan.createdAt}, ${scan.rooms} rooms, ${scan.status}.` : "No scan yet. Pair a phone in Settings, then scan each room with the Lantern Scan app."}
          </p>
        </div>
      </div>

      <ul className="room-grid">
        {rooms.map((room) => {
          const image = room.preview?.thumbnailUrl ?? room.photoUrls?.[0];
          const preview = PREVIEW_LABEL[room.preview?.status ?? "none"];
          return (
            <li key={room.id}>
              <Link href={`/dashboard/rooms/${room.id}`} className="card room-card">
                {image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={image} alt="" className="room-thumb" />
                ) : (
                  <div className="room-thumb step-photo">{room.name}</div>
                )}
                <div className="room-meta">
                  <strong>{room.name}</strong>
                  <span className="muted">
                    {room.photoPaths.length} {room.photoPaths.length === 1 ? "photo" : "photos"} · {openCount(room.id)} open {openCount(room.id) === 1 ? "item" : "items"}
                  </span>
                  {preview && <span className={`badge ${room.preview?.status === "ready" ? "resolved" : "detected"}`}>{preview}</span>}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
