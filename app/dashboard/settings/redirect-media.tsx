"use client";

import { useEffect, useRef, useState } from "react";
import { vapiConfigured } from "@/app/routine/vapi-voice";
import { MAX_LINE_CHARS } from "@/lib/dashboard/redirect-media";

// Familiar voice and photo for the TV redirect. A caregiver types what the TV should say for each moment, and can
// record it in their own voice (or upload a clip) and pick the photo shown with it. Typed lines without a recording
// are spoken by the calm voice (Layla, through Vapi), or read aloud by the TV when Vapi is not set up.

type Slot = { slot: string; label: string; when: string; line: string; defaultLine: string; typed: boolean; url: string | null };
type Media = { patientName: string; slots: Slot[]; photo: string | null };

const MAX_SECONDS = 20;

// Safari records mp4, Chrome and Firefox record webm; use whichever this browser supports.
const recordingType = () =>
  typeof MediaRecorder === "undefined" ? "" : ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"].find((t) => MediaRecorder.isTypeSupported(t)) ?? "";

export function RedirectMedia() {
  const [media, setMedia] = useState<Media | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [recording, setRecording] = useState<{ slot: string; seconds: number } | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({}); // typed but not saved yet
  const [note, setNote] = useState("");
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  async function load() {
    const r = await fetch("/api/patient/upload");
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return setError(d.error ?? "Could not load the recordings.");
    setMedia(d);
  }
  useEffect(() => {
    load();
    return () => {
      if (timer.current) clearInterval(timer.current);
      recorder.current?.stream.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function upload(form: FormData, key: string) {
    setBusy(key);
    setError("");
    const r = await fetch("/api/patient/upload", { method: "POST", body: form });
    const d = await r.json().catch(() => ({}));
    setBusy(null);
    if (!r.ok) return setError(d.error ?? "Upload failed.");
    await load();
  }

  const uploadVoice = (slot: string, file: Blob, name = "recording") => {
    const form = new FormData();
    form.set("kind", "voice");
    form.set("slot", slot);
    form.set("file", new File([file], name, { type: file.type || "audio/webm" }));
    return upload(form, slot);
  };

  async function startRecording(slot: string) {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const type = recordingType();
      const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        if (timer.current) clearInterval(timer.current);
        setRecording(null);
        if (chunks.length) void uploadVoice(slot, new Blob(chunks, { type: rec.mimeType || type || "audio/webm" }));
      };
      recorder.current = rec;
      rec.start();
      setRecording({ slot, seconds: 0 });
      timer.current = setInterval(() => {
        setRecording((r) => {
          if (!r) return r;
          if (r.seconds + 1 >= MAX_SECONDS) rec.state === "recording" && rec.stop();
          return { ...r, seconds: r.seconds + 1 };
        });
      }, 1000);
    } catch {
      setError("Microphone access was blocked. Allow it in the browser, or upload a clip instead.");
    }
  }

  // An empty line puts the slot back to the default words.
  async function saveLine(slot: string, line: string) {
    setBusy(`line-${slot}`);
    setError("");
    setNote("");
    const r = await fetch("/api/patient/lines", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ slot, line }) });
    const d = await r.json().catch(() => ({}));
    setBusy(null);
    if (!r.ok) return setError(d.error ?? "Could not save that line.");
    setDrafts(({ [slot]: _, ...rest }) => rest);
    // Saved either way; a monitor that is not running reads the saved lines when it starts.
    if (!d.monitor) setNote("Saved. The monitor is not running right now; it will use the new words when it starts.");
    await load();
  }

  async function remove(kind: "voice" | "photo", slot?: string) {
    setBusy(slot ?? "photo");
    await fetch(`/api/patient/upload?kind=${kind}${slot ? `&slot=${slot}` : ""}`, { method: "DELETE" });
    setBusy(null);
    await load();
  }

  if (!media) return <p className="muted">{error || "Loading recordings..."}</p>;

  return (
    <div className="media">
      <p className="muted">
        When {media.patientName} gets up at night, the TV glows, then shows this photo and says the line below. Type
        each line the way you would say it at home: short, warm and simple.{" "}
        {vapiConfigured ? "The TV speaks it in a calm voice," : "The TV reads it aloud,"} or record it yourself and your recording plays instead.
      </p>

      <div className="media-photo">
        {media.photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={media.photo} alt="Redirect photo" />
        ) : (
          <div className="media-photo-empty">Uses the scanned bedroom photo</div>
        )}
        <div className="media-actions">
          <strong>Photo shown during a redirect</strong>
          <span className="muted small">A familiar, calm picture: their bed, a family photo.</span>
          <div className="media-buttons">
            <label className="btn small">
              {media.photo ? "Replace photo" : "Upload photo"}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  const form = new FormData();
                  form.set("kind", "photo");
                  form.set("file", f);
                  void upload(form, "photo");
                }}
              />
            </label>
            {media.photo && <button className="btn small ghost" onClick={() => remove("photo")} disabled={busy === "photo"}>Remove</button>}
          </div>
        </div>
      </div>

      <ul className="media-list">
        {media.slots.map((s) => {
          const isRec = recording?.slot === s.slot;
          const draft = drafts[s.slot];
          const text = draft ?? s.line;
          const saving = busy === `line-${s.slot}`;
          return (
            <li key={s.slot} className="media-row">
              <div className="media-text">
                <div className="audit-title">
                  <strong>{s.label}</strong>
                  <span className={`badge ${s.url ? "resolved" : ""}`}>{s.url ? "your voice" : vapiConfigured ? "calm voice" : "read aloud"}</span>
                </div>
                <span className="muted small">{s.when}</span>
                <textarea
                  rows={2}
                  maxLength={MAX_LINE_CHARS}
                  value={text}
                  aria-label={`What the TV says: ${s.label}`}
                  onChange={(e) => setDrafts((d) => ({ ...d, [s.slot]: e.target.value }))}
                />
                <div className="media-edit">
                  {draft !== undefined && draft.trim() !== s.line && (
                    <button className="btn small" onClick={() => saveLine(s.slot, draft)} disabled={saving || !draft.trim()}>
                      {saving ? "Saving..." : "Save line"}
                    </button>
                  )}
                  {s.typed && draft === undefined && (
                    <button className="btn small ghost" onClick={() => saveLine(s.slot, "")} disabled={saving}>
                      Use the default
                    </button>
                  )}
                  {s.url && <span className="muted small">Your recording plays instead of the typed words.</span>}
                </div>
              </div>
              <div className="media-actions">
                {s.url && <audio controls src={s.url} preload="none" />}
                <div className="media-buttons">
                  {isRec ? (
                    <button className="btn small alert" onClick={() => recorder.current?.stop()}>
                      Stop ({MAX_SECONDS - (recording?.seconds ?? 0)} s)
                    </button>
                  ) : (
                    <button className="btn small" onClick={() => startRecording(s.slot)} disabled={!!recording || busy === s.slot}>
                      {busy === s.slot ? "Saving..." : s.url ? "Record again" : "Record"}
                    </button>
                  )}
                  <label className="btn small ghost">
                    Upload clip
                    <input type="file" accept="audio/*" hidden onChange={(e) => e.target.files?.[0] && uploadVoice(s.slot, e.target.files[0], e.target.files[0].name)} />
                  </label>
                  {s.url && <button className="btn small ghost" onClick={() => remove("voice", s.slot)} disabled={busy === s.slot}>Remove</button>}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {note && <p className="muted small">{note}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
