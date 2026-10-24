"use client";

// Zone editor: fix up the home model by hand.
// - Select a room to rename it, set its kind, mark it virtual (a taped-off demo zone), drag it, or drag its corners
// - Draw a new zone by clicking corners, then Finish
// - Place and drag doors; a door connects the two rooms nearest to it
// - Drag the listener anchors to where the laptops really are (Saran's listeners must match these ids)
// Save writes a new home_models version, which the monitor reloads.

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import "@/components/world/world.css";
import type { Anchor, HomeDoor, HomeModel, HomeRoom, RoomKind, Vec2 } from "@/lib/types";
import { kindFor, matchDoors, slug } from "@/lib/world/build";
import { bounds, distance, polygonCentroid } from "@/lib/world/geometry";
import { doorAxis } from "@/lib/world/walls";

type Mode = "select" | "draw" | "door" | "anchor";
type Drag =
  | { kind: "room"; id: string; from: Vec2; original: HomeRoom }
  | { kind: "vertex"; id: string; index: number }
  | { kind: "door"; id: string }
  | { kind: "anchor"; id: string };
type Selection = { kind: "room" | "door" | "anchor"; id: string } | null;

const KINDS: RoomKind[] = ["bedroom", "bathroom", "hallway", "kitchen", "living", "tv-room", "front-door", "other"];
const PAD = 36;

const pts = (poly: Vec2[]) => poly.map((p) => `${p.x},${p.y}`).join(" ");
const snap = (p: Vec2, step: number): Vec2 => (step ? { x: Math.round(p.x / step) * step, y: Math.round(p.y / step) * step } : { x: Math.round(p.x), y: Math.round(p.y) });

function withCentroid(r: HomeRoom): HomeRoom {
  const c = polygonCentroid(r.polygon);
  return { ...r, centroid: { x: Math.round(c.x * 10) / 10, y: Math.round(c.y * 10) / 10 } };
}

function uniqueId(base: string, taken: string[]) {
  let id = slug(base), n = 2;
  while (taken.includes(id)) id = `${slug(base)}-${n++}`;
  return id;
}

export function ZoneEditor({ initial, saved }: { initial: HomeModel; saved: boolean }) {
  const [home, setHome] = useState<HomeModel>(initial);
  const [mode, setMode] = useState<Mode>("select");
  const [sel, setSel] = useState<Selection>(null);
  const [draft, setDraft] = useState<Vec2[]>([]);
  const [grid, setGrid] = useState(6);
  const [status, setStatus] = useState(saved ? `Editing version ${initial.version}` : "Editing the demo fixture (not saved yet)");
  const [dirty, setDirty] = useState(false);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);

  // Keep the view box fixed while editing so things do not jump around under the cursor.
  const view = useMemo(() => {
    const b = bounds(initial.rooms.flatMap((r) => r.polygon).concat(initial.anchors.map((a) => a.position)));
    return { x: b.minX - PAD, y: b.minY - PAD, w: b.width + PAD * 2 + 120, h: b.height + PAD * 2 + 80 };
  }, [initial]);

  const update = (fn: (h: HomeModel) => HomeModel) => {
    setHome((h) => fn(h));
    setDirty(true);
  };
  const toPlan = (e: React.PointerEvent | React.MouseEvent): Vec2 => {
    const m = svg.current!.getScreenCTM()!.inverse();
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m);
    return { x: p.x, y: p.y };
  };

  const room = sel?.kind === "room" ? home.rooms.find((r) => r.id === sel.id) : undefined;
  const door = sel?.kind === "door" ? home.doors.find((d) => d.id === sel.id) : undefined;
  const anchor = sel?.kind === "anchor" ? home.anchors.find((a) => a.receiverId === sel.id) : undefined;

  // Pointer handling

  function onBackgroundDown(e: React.PointerEvent) {
    const p = snap(toPlan(e), grid);
    if (mode === "draw") {
      if (draft.length >= 3 && distance(p, draft[0]) < 12) return finishDraft();
      setDraft([...draft, p]);
    } else if (mode === "door") {
      const [d] = matchDoors(home.rooms, [{ center: p, widthIn: 34, kind: "door" }]);
      if (!d) return setStatus("Place doors on a room's edge.");
      const id = uniqueId(d.id.replace("|", "-"), home.doors.map((x) => x.id));
      update((h) => ({ ...h, doors: [...h.doors, { ...d, id }] }));
      setSel({ kind: "door", id });
      setMode("select");
    } else if (mode === "anchor") {
      const id = uniqueId(home.rooms.find((r) => pointIn(p, r))?.id ?? "listener", home.anchors.map((a) => a.receiverId));
      update((h) => ({ ...h, anchors: [...h.anchors, { receiverId: id, position: p, heightIn: 36 }] }));
      setSel({ kind: "anchor", id });
      setMode("select");
    } else {
      setSel(null);
    }
  }

  function onMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const p = snap(toPlan(e), grid);
    if (d.kind === "room") {
      const dx = p.x - d.from.x, dy = p.y - d.from.y;
      const o = d.original;
      update((h) => ({
        ...h,
        rooms: h.rooms.map((r) =>
          r.id !== d.id ? r : withCentroid({
            ...o,
            polygon: o.polygon.map((q) => ({ x: q.x + dx, y: q.y + dy })),
            objects: o.objects?.map((x) => ({ ...x, center: { x: x.center.x + dx, y: x.center.y + dy } })),
          }),
        ),
      }));
    } else if (d.kind === "vertex") {
      update((h) => ({ ...h, rooms: h.rooms.map((r) => (r.id !== d.id ? r : withCentroid({ ...r, polygon: r.polygon.map((q, i) => (i === d.index ? p : q)) }))) }));
    } else if (d.kind === "door") {
      update((h) => ({ ...h, doors: h.doors.map((x) => (x.id === d.id ? { ...x, center: p } : x)) }));
    } else if (d.kind === "anchor") {
      update((h) => ({ ...h, anchors: h.anchors.map((a) => (a.receiverId === d.id ? { ...a, position: p } : a)) }));
    }
  }

  function onUp() {
    const d = drag.current;
    drag.current = null;
    if (d?.kind !== "door") return;
    // Re-match the moved door to the rooms it now sits between.
    update((h) => ({
      ...h,
      doors: h.doors.map((x) => {
        if (x.id !== d.id) return x;
        const [m] = matchDoors(h.rooms, [{ center: x.center, widthIn: x.widthIn, kind: x.kind }]);
        return m ? { ...x, roomA: m.roomA, roomB: m.roomB } : x;
      }),
    }));
  }

  const start = (d: Drag) => (e: React.PointerEvent) => {
    if (mode !== "select") return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    drag.current = d;
  };

  function finishDraft() {
    if (draft.length < 3) return;
    const name = `Zone ${home.rooms.filter((r) => r.virtual).length + 1}`;
    const id = uniqueId(name, home.rooms.map((r) => r.id));
    const r = withCentroid({ id, name, kind: "other", polygon: draft, centroid: draft[0], heightIn: 96, virtual: true, objects: [], photoPaths: [] });
    update((h) => ({ ...h, rooms: [...h.rooms, r] }));
    setDraft([]);
    setMode("select");
    setSel({ kind: "room", id });
  }

  // Side panel edits

  const setRoom = (patch: Partial<HomeRoom>) => room && update((h) => ({ ...h, rooms: h.rooms.map((r) => (r.id === room.id ? { ...r, ...patch } : r)) }));
  const setDoor = (patch: Partial<HomeDoor>) => door && update((h) => ({ ...h, doors: h.doors.map((d) => (d.id === door.id ? { ...d, ...patch } : d)) }));
  const setAnchor = (patch: Partial<Anchor>) => {
    if (!anchor) return;
    if (patch.receiverId !== undefined) patch.receiverId = slug(patch.receiverId);
    update((h) => ({ ...h, anchors: h.anchors.map((a) => (a.receiverId === anchor.receiverId ? { ...a, ...patch } : a)) }));
    if (patch.receiverId) setSel({ kind: "anchor", id: patch.receiverId });
  };

  function renameRoom(name: string) {
    if (!room) return;
    setRoom({ name, kind: room.kind === "other" ? kindFor(name) : room.kind });
  }

  function remove() {
    if (!sel) return;
    if (sel.kind === "room") update((h) => ({ ...h, rooms: h.rooms.filter((r) => r.id !== sel.id), doors: h.doors.filter((d) => d.roomA !== sel.id && d.roomB !== sel.id) }));
    if (sel.kind === "door") update((h) => ({ ...h, doors: h.doors.filter((d) => d.id !== sel.id) }));
    if (sel.kind === "anchor") update((h) => ({ ...h, anchors: h.anchors.filter((a) => a.receiverId !== sel.id) }));
    setSel(null);
  }

  async function save() {
    setStatus("Saving...");
    const res = await fetch("/api/world", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: home }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setStatus(data.error ?? "Could not save.");
    setHome((h) => ({ ...h, version: data.version }));
    setDirty(false);
    setStatus(`Saved as version ${data.version}. The monitor reloads it automatically.`);
  }

  return (
    <div className="ze">
      <svg
        ref={svg}
        className="ze-plan"
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        onPointerDown={onBackgroundDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        style={{ cursor: mode === "select" ? "default" : "crosshair" }}
      >
        {home.rooms.map((r) => (
          <polygon
            key={r.id}
            points={pts(r.polygon)}
            className={`ze-room ${r.virtual ? "virtual" : ""} ${room?.id === r.id ? "selected" : ""}`}
            onPointerDown={(e) => {
              if (mode !== "select") return;
              setSel({ kind: "room", id: r.id });
              start({ kind: "room", id: r.id, from: snap(toPlan(e), grid), original: r })(e);
            }}
          />
        ))}
        {home.rooms.flatMap((r) => (r.objects ?? []).map((o) => (
          <rect key={o.id} x={o.center.x - o.widthIn / 2} y={o.center.y - o.depthIn / 2} width={o.widthIn} height={o.depthIn} fill="none" stroke="#a89a88" pointerEvents="none" transform={`rotate(${o.rotationDeg} ${o.center.x} ${o.center.y})`} />
        )))}
        {home.rooms.map((r) => (
          <text key={r.id} x={r.centroid.x} y={r.centroid.y + (bounds(r.polygon).height < 90 ? 4 : 26)} className="ze-label">
            {r.name}
          </text>
        ))}
        {room?.polygon.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={5} className="ze-vertex" onPointerDown={start({ kind: "vertex", id: room.id, index: i })} />
        ))}
        {home.doors.map((d) => (
          <g key={d.id} onPointerDown={(e) => { setSel({ kind: "door", id: d.id }); start({ kind: "door", id: d.id })(e); }}>
            {/* Drawn along the wall it sits in, at its real width. */}
            <rect
              x={d.center.x - d.widthIn / 2}
              y={d.center.y - 5}
              width={d.widthIn}
              height={10}
              rx={3}
              className="ze-door"
              opacity={door?.id === d.id ? 1 : 0.8}
              transform={`rotate(${(Math.atan2(doorAxis(home, d).y, doorAxis(home, d).x) * 180) / Math.PI} ${d.center.x} ${d.center.y})`}
            />
          </g>
        ))}
        {home.anchors.map((a) => (
          <g key={a.receiverId} onPointerDown={(e) => { setSel({ kind: "anchor", id: a.receiverId }); start({ kind: "anchor", id: a.receiverId })(e); }}>
            <circle cx={a.position.x} cy={a.position.y} r={anchor?.receiverId === a.receiverId ? 9 : 7} className="ze-anchor" />
            <text x={a.position.x} y={a.position.y - 12} className="ze-label">{a.receiverId}</text>
          </g>
        ))}
        {draft.length > 0 && <polygon points={pts(draft)} className="ze-draft" />}
        {draft.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={4} className="ze-vertex" />)}
      </svg>

      <aside className="ze-side">
        <section className="card">
          <div className="ze-row">
            {(["select", "draw", "door", "anchor"] as Mode[]).map((m) => (
              <button key={m} className={mode === m ? "btn small on" : "btn small ghost"} onClick={() => { setMode(m); setDraft([]); }}>
                {m === "select" ? "Select" : m === "draw" ? "Draw zone" : m === "door" ? "Add door" : "Add listener"}
              </button>
            ))}
          </div>
          {mode === "draw" && (
              Click each corner. Click the first corner again or <button className="btn small" onClick={finishDraft} disabled={draft.length < 3}>Finish</button>
          )}
          <label style={{ marginTop: 10 }}>
            Snap
            <select value={grid} onChange={(e) => setGrid(Number(e.target.value))}>
              <option value={0}>Off</option>
              <option value={3}>3 in</option>
              <option value={6}>6 in</option>
              <option value={12}>1 ft</option>
            </select>
          </label>
        </section>

        {room && (
          <section className="card">
            <label>Name<input value={room.name} onChange={(e) => renameRoom(e.target.value)} /></label>
            <label>Kind
              <select value={room.kind} onChange={(e) => setRoom({ kind: e.target.value as RoomKind })}>
                {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </label>
            <label style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <input type="checkbox" checked={!!room.virtual} onChange={(e) => setRoom({ virtual: e.target.checked })} /> Virtual zone (taped off)
            </label>
            <p className="muted small">id <span className="mono">{room.id}</span> · drag the room or its corners</p>
            <button className="btn small ghost" onClick={remove}>Delete room</button>
          </section>
        )}

        {door && (
          <section className="card">
            <p><strong>Door</strong> <span className="mono muted">{door.roomA} ↔ {door.roomB}</span></p>
            <label>Width (in)<input type="number" value={door.widthIn} min={12} max={96} onChange={(e) => setDoor({ widthIn: Number(e.target.value) })} /></label>
            <label>Type
              <select value={door.kind} onChange={(e) => setDoor({ kind: e.target.value as HomeDoor["kind"] })}>
                <option value="door">door</option>
                <option value="opening">opening</option>
              </select>
            </label>
            <button className="btn small ghost" onClick={remove}>Delete door</button>
          </section>
        )}

        {anchor && (
          <section className="card">
            <label>Listener id (the laptop's --id)<input value={anchor.receiverId} onChange={(e) => setAnchor({ receiverId: e.target.value })} /></label>
            <label>Height (in)<input type="number" value={anchor.heightIn} onChange={(e) => setAnchor({ heightIn: Number(e.target.value) })} /></label>
            <p className="muted small mono">({Math.round(anchor.position.x)}, {Math.round(anchor.position.y)}) in</p>
            <button className="btn small ghost" onClick={remove}>Delete listener</button>
          </section>
        )}

        <section className="card">
          <p className="muted small">{home.rooms.length} rooms · {home.doors.length} doors · {home.anchors.length} listeners</p>
          <ul className="ze-list">
            {home.anchors.map((a) => (
              <li key={a.receiverId}>
                <button className={anchor?.receiverId === a.receiverId ? "on" : ""} onClick={() => setSel({ kind: "anchor", id: a.receiverId })}>
                  {a.receiverId} <span className="muted mono">({Math.round(a.position.x)}, {Math.round(a.position.y)})</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="ze-row" style={{ marginTop: 10 }}>
            <button className="btn" onClick={save} disabled={!dirty}>Save version</button>
            <button className="btn ghost" onClick={() => { setHome(initial); setDirty(false); setSel(null); }}>Undo all</button>
          </div>
          <p className="muted small">{status}</p>
          <Link href="/dashboard/world" className="small">← Back to the 3D view</Link>
        </section>
      </aside>
    </div>
  );
}

function pointIn(p: Vec2, r: HomeRoom) {
  const b = bounds(r.polygon);
  return p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY;
}
