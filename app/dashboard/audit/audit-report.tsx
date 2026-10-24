"use client";

import { useState } from "react";
import { setAuditStatus } from "@/lib/dashboard/actions";
import { fixFor, formatCost } from "@/lib/audit/fixes";
import { roomName } from "@/lib/dashboard/rooms";
import type { AuditItem, AuditStatus, Room, Severity } from "@/lib/types";
import { FloorPlan } from "@/app/dashboard/_components/floor-plan";
import { setAuditNote } from "./actions";
import "./audit.css";

const ORDER: Severity[] = ["high", "medium", "low"];

// The report an OT reviews: accept, dismiss, mark fixed, or add a note. Clicking the active status sets it back to open.
// The UI updates first, then saves; a failed save puts the old value back.
// readOnly is the shared link for the OT or family: same report, no buttons.
export function AuditReport({
  initialItems,
  rooms,
  subtitle,
  shareUrl,
  readOnly = false,
}: {
  initialItems: AuditItem[];
  rooms: Room[];
  subtitle: string;
  shareUrl?: string;
  readOnly?: boolean;
}) {
  const [items, setItems] = useState<AuditItem[]>(initialItems);
  const [copied, setCopied] = useState(false);

  const patch = (id: string, p: Partial<AuditItem>) => setItems((all) => all.map((a) => (a.id === id ? { ...a, ...p } : a)));

  function setStatus(id: string, status: AuditStatus) {
    const previous = items.find((a) => a.id === id)?.status ?? "open";
    const next = previous === status ? "open" : status;
    patch(id, { status: next });
    setAuditStatus(id, next).catch(() => patch(id, { status: previous }));
  }

  function saveNote(id: string, note: string) {
    const previous = items.find((a) => a.id === id)?.note;
    if ((previous ?? "") === note) return;
    patch(id, { note });
    setAuditNote(id, note).catch(() => patch(id, { note: previous }));
  }

  async function copyShare() {
    if (!shareUrl) return;
    await navigator.clipboard?.writeText(new URL(shareUrl, window.location.origin).toString());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const live = items.filter((a) => a.status !== "dismissed");
  const count = (s: Severity) => live.filter((a) => a.severity === s && a.status !== "fixed").length;
  const byRoom = rooms
    .map((room) => ({
      room,
      items: items.filter((a) => a.roomId === room.id).sort((a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity)),
    }))
    .filter((g) => g.items.length > 0);

  // Top 3 open fixes by severity, with a rough cost from the product list.
  const top = live
    .filter((a) => a.status !== "fixed")
    .sort((a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity))
    .slice(0, 3)
    .map((a) => ({ item: a, fix: fixFor(a) }));
  const total = top.reduce((s, t) => [s[0] + (t.fix?.costUsd[0] ?? 0), s[1] + (t.fix?.costUsd[1] ?? 0)] as [number, number], [0, 0] as [number, number]);

  return (
    <div className="audit">
      <div className="page-head">
        <div>
          <h1>Home safety and accessibility report</h1>
          <p className="muted">{subtitle} Accessibility checks use the 2010 ADA Standards as a benchmark; private homes do not have to comply, and an occupational therapist reviews every item.</p>
        </div>
        <div className="audit-actions no-print">
          {shareUrl && !readOnly && (
            <button className="btn ghost" onClick={copyShare}>
              {copied ? "Link copied" : "Copy share link"}
            </button>
          )}
          <button className="btn" onClick={() => window.print()}>
            Save as PDF
          </button>
        </div>
      </div>

      <div className="summary">
        {ORDER.map((s) => (
          <div key={s} className={`card summary-${s}`}>
            <span className="stat">{count(s)}</span>
            <span className="muted">{s} priority open</span>
          </div>
        ))}
      </div>

      {top.length > 0 && (
        <section className="card">
          <div className="card-head">
            <h2>Top fixes</h2>
            <span className="muted mono">about {formatCost(total)}</span>
          </div>
          <ol className="audit-list">
            {top.map(({ item, fix }, i) => (
              <li key={item.id} className="audit-item">
                <div className="audit-main">
                  <div className="audit-title">
                    <strong>{i + 1}. {fix?.product ?? item.fix}</strong>
                    {fix && <span className="mono muted">{formatCost(fix.costUsd)}</span>}
                  </div>
                  <p className="muted">{item.title} ({roomName(rooms, item.roomId)})</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className="card">
        <FloorPlan rooms={rooms} markers={live} />
      </section>

      {byRoom.map(({ room, items }) => (
        <section key={room.id} className="card">
          <div className="card-head">
            <h2>{roomName(rooms, room.id)}</h2>
          </div>
          <ul className="audit-list">
            {items.map((a) => {
              const fix = fixFor(a);
              return (
                <li key={a.id} className={`audit-item status-${a.status}`}>
                  <div className="audit-main">
                    <div className="audit-title">
                      <span className={`badge ${a.severity}`}>{a.severity}</span>
                      <strong>{a.title}</strong>
                      {a.code && <span className="mono muted">{a.code}</span>}
                      {a.source === "vision" && <span className="mono muted">photo</span>}
                      {a.status !== "open" && <span className="mono muted">{a.status}</span>}
                    </div>
                    <p>{a.detail}</p>
                    {a.measuredIn !== undefined && (
                      <p className="mono">
                        measured {a.measuredIn} in / required {a.requiredIn} in
                      </p>
                    )}
                    <p className="fix">Fix: {a.fix}</p>
                    {fix && (
                      <p className="fix">
                        Suggested: {fix.product} ({formatCost(fix.costUsd)})
                      </p>
                    )}
                    {readOnly ? (
                      a.note && <p className="fix">OT note: {a.note}</p>
                    ) : (
                      <input
                        className="no-print"
                        placeholder="OT note"
                        defaultValue={a.note ?? ""}
                        onBlur={(e) => saveNote(a.id, e.target.value.trim())}
                        aria-label={`Note for ${a.title}`}
                      />
                    )}
                    {!readOnly && a.note && <p className="fix print-only">OT note: {a.note}</p>}
                  </div>
                  {a.photoUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className="audit-photo" src={a.photoUrl} alt="" />
                  )}
                  {!readOnly && (
                    <div className="audit-actions no-print">
                      {(["accepted", "fixed", "dismissed"] as AuditStatus[]).map((s) => (
                        <button key={s} className={a.status === s ? "btn small on" : "btn small ghost"} onClick={() => setStatus(a.id, s)}>
                          {s === "accepted" ? "Accept" : s === "fixed" ? "Fixed" : "Dismiss"}
                        </button>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {byRoom.length === 0 && <p className="muted">No findings yet. Scan the home with the Lantern Scan app to build this report.</p>}
    </div>
  );
}
