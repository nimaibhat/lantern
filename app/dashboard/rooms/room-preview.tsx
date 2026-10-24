"use client";

import { useEffect, useState } from "react";
import { generateRoomPreview, refreshRoomPreview } from "@/lib/dashboard/actions";
import type { RoomPreview as Preview } from "@/lib/types";
import { SplatViewer } from "./splat-viewer";

const POLL_MS = 10_000;

// The World Labs panel on a room page: generate, wait about 5 minutes, then explore the splat.
export function RoomPreview({ roomId, initial, hasPhotos, enabled }: { roomId: string; initial: Preview; hasPhotos: boolean; enabled: boolean }) {
  const [preview, setPreview] = useState<Preview>(initial);
  const [error, setError] = useState("");

  // While generating, check back every few seconds. Stops on its own once ready or failed.
  useEffect(() => {
    if (preview.status !== "generating") return;
    const id = setInterval(async () => {
      try {
        setPreview(await refreshRoomPreview(roomId));
      } catch {
        // A missed poll is fine; the next one will try again.
      }
    }, POLL_MS);
    return () => clearInterval(id);
  }, [preview.status, roomId]);

  async function generate() {
    setError("");
    try {
      setPreview(await generateRoomPreview(roomId));
    } catch (e) {
      setError((e as Error).message || "Could not start the preview.");
    }
  }

  const fallback = preview.thumbnailUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img className="preview-image" src={preview.panoUrl ?? preview.thumbnailUrl} alt="3D preview of the room" />
  ) : (
    <p className="muted">The 3D viewer could not load here. Open it in Marble instead.</p>
  );

  return (
    <div className="room-preview">
      {preview.status === "ready" && preview.splatUrl && <SplatViewer url={preview.splatUrl} fallback={fallback} />}
      {preview.status === "ready" && !preview.splatUrl && fallback}

      {preview.status === "generating" && (
        <div className="preview-empty">
          <span className="spinner" />
          <p>Building a 3D world from the photos. This takes about 5 minutes; you can leave this page.</p>
        </div>
      )}

      {(preview.status === "none" || preview.status === "failed") && (
        <div className="preview-empty">
          <p className="muted">
            {preview.status === "failed"
              ? "The last preview did not finish."
              : "Turn this room's photos into a 3D world you can look around in. It is a visual preview; measurements come from the scan."}
          </p>
          <button className="btn" onClick={generate} disabled={!enabled || !hasPhotos}>
            {preview.status === "failed" ? "Try again" : "Generate 3D preview"}
          </button>
          {!hasPhotos && <p className="muted small">Scan this room with photos first.</p>}
          {!enabled && <p className="muted small">Add WORLD_LABS_API_KEY to .env.local to turn this on.</p>}
        </div>
      )}

      {preview.status === "ready" && preview.worldUrl && (
        <a className="preview-link" href={preview.worldUrl} target="_blank" rel="noreferrer">
          Open in Marble ↗
        </a>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
