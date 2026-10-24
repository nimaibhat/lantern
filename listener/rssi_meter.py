"""Temporary dual-laptop RSSI + feet meter. Close the window to stop.

On your laptop (shows both sides of the 30 ft span):
    python listener/rssi_meter.py --host 8790

On a friend's laptop:
    python listener/rssi_meter.py --id friend --send http://YOUR_LAN_IP:8790
"""
from __future__ import annotations

import argparse
import asyncio
import json
import math
import socket
import threading
import time
import tkinter as tk
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from tkinter import ttk

from bleak import BleakScanner

SERVICE_UUID = "4c414e54-4552-4e00-a000-000000000001"
SPAN_S = 1.2
EMA_ALPHA = 0.28
MAX_JUMP_DB = 16
NEAR_FT = 3.0
FAR_FT = 30.0
DEFAULT_N = 2.8  # furnished indoor, until 3 ft + 30 ft are both set
BG = "#1a1a1a"
FG = "#f5f5f5"
MUTED = "#888888"


def lan_ip() -> str:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


def is_tag(name: str) -> bool:
    return "lanterntag" in (name or "").lower()


def is_remote(addr: str) -> bool:
    return addr.startswith("remote:")


def median(xs: list[float]) -> float:
    s = sorted(xs)
    n = len(s)
    m = n // 2
    return s[m] if n % 2 else (s[m - 1] + s[m]) / 2


def path_n(rssi_near: float | None, rssi_far: float | None) -> float:
    if rssi_near is None or rssi_far is None:
        return DEFAULT_N
    delta = rssi_near - rssi_far
    if delta < 6:
        return DEFAULT_N
    n = delta / (10 * math.log10(FAR_FT / NEAR_FT))
    return max(1.8, min(4.2, n))


def feet_from_rssi(rssi: float, rssi_near: float, n: float) -> float:
    d = NEAR_FT * (10 ** ((rssi_near - rssi) / (10 * n)))
    return max(0.5, min(FAR_FT + 15, d))


class Track:
    def __init__(self, addr: str, name: str):
        self.addr = addr
        self.name = name
        self.samples: list[tuple[float, float]] = []
        self.ema: float | None = None
        self.hits = 0
        self.last = 0.0
        self.rssi_near: float | None = None
        self.rssi_far: float | None = None
        self.outliers = 0

    def n(self) -> float:
        return path_n(self.rssi_near, self.rssi_far)

    def ref(self) -> float:
        return self.rssi_near if self.rssi_near is not None else -50.0

    def feet(self) -> float | None:
        if self.ema is None:
            return None
        return feet_from_rssi(self.ema, self.ref(), self.n())

    def push(self, rssi: float, name: str, now: float):
        self.name = name or self.name
        self.hits += 1
        self.last = now
        if self.ema is not None and abs(rssi - self.ema) > MAX_JUMP_DB:
            self.outliers += 1
            if self.outliers < 3:
                return
        else:
            self.outliers = 0
        self.samples.append((now, rssi))
        self.samples = [(t, v) for t, v in self.samples if now - t <= SPAN_S]
        if len(self.samples) < 3:
            return
        med = median([v for _, v in self.samples])
        self.ema = med if self.ema is None else EMA_ALPHA * med + (1 - EMA_ALPHA) * self.ema

    def stale(self, now: float) -> bool:
        return now - self.last > 3

    def raw(self) -> float | None:
        return self.samples[-1][1] if self.samples else None


class ScanState:
    def __init__(self):
        self.lock = threading.Lock()
        self.tracks: dict[str, Track] = {}
        self.latest_local: dict | None = None

    def _push(self, addr: str, name: str, rssi: float):
        now = time.time()
        t = self.tracks.get(addr)
        if t is None:
            t = Track(addr, name or addr[-8:])
            self.tracks[addr] = t
        t.push(rssi, name or t.name, now)

    def on_adv(self, device, adv):
        name = device.name or ""
        uuids = [u.lower() for u in (adv.service_uuids or [])]
        if not name and not uuids:
            return
        with self.lock:
            self._push(device.address, name or device.address[-8:], adv.rssi)
            if is_tag(name) or SERVICE_UUID in uuids:
                self.latest_local = {"name": name or "LanternTag", "rssi": adv.rssi}

    def on_remote(self, laptop_id: str, name: str, rssi: float):
        with self.lock:
            self._push(f"remote:{laptop_id}", f"{laptop_id} laptop", rssi)

    async def scan(self):
        async with BleakScanner(self.on_adv):
            while True:
                await asyncio.sleep(1)


def start_host(state: ScanState, port: int):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt, *args):
            return

        def do_POST(self):
            if self.path != "/rssi":
                self.send_response(404)
                self.end_headers()
                return
            n = int(self.headers.get("Content-Length", "0"))
            body = json.loads(self.rfile.read(n).decode("utf-8"))
            state.on_remote(str(body.get("id") or "friend"), str(body.get("name") or ""), float(body["rssi"]))
            self.send_response(204)
            self.end_headers()

    httpd = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def start_sender(state: ScanState, url: str, laptop_id: str):
    def loop():
        while True:
            time.sleep(0.2)
            with state.lock:
                sample = state.latest_local
            if not sample:
                continue
            payload = json.dumps({"id": laptop_id, "name": sample["name"], "rssi": sample["rssi"]}).encode()
            req = urllib.request.Request(
                url.rstrip("/") + "/rssi",
                data=payload,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            try:
                urllib.request.urlopen(req, timeout=1.5)
            except (urllib.error.URLError, TimeoutError, OSError):
                pass

    threading.Thread(target=loop, daemon=True).start()


class Column:
    def __init__(self, parent, title: str, state: ScanState):
        self.state = state
        self.addr: str | None = None
        self.pick = tk.StringVar(value="(none)")
        self.last_feet: float | None = None

        box = tk.Frame(parent, bg="#242424", padx=16, pady=12)
        box.pack(side="left", expand=True, fill="both", padx=8, pady=8)

        tk.Label(box, text=title, fg=MUTED, bg="#242424", font=("Segoe UI", 12)).pack(anchor="w")
        self.menu = ttk.Combobox(box, textvariable=self.pick, state="readonly", width=36)
        self.menu.pack(fill="x", pady=(4, 8))
        self.menu.bind("<<ComboboxSelected>>", self._on_pick)

        self.ft = tk.Label(box, text="-- ft", fg=FG, bg="#242424", font=("Segoe UI", 40, "bold"))
        self.ft.pack()
        self.dbm = tk.Label(box, text="--- dBm", fg=FG, bg="#242424", font=("Segoe UI", 20))
        self.dbm.pack()
        self.raw = tk.Label(box, text="raw ---", fg=MUTED, bg="#242424", font=("Segoe UI", 11))
        self.raw.pack()
        self.meta = tk.Label(box, text="", fg=MUTED, bg="#242424", font=("Segoe UI", 10))
        self.meta.pack(pady=(4, 8))

        btns = tk.Frame(box, bg="#242424")
        btns.pack()
        tk.Button(btns, text="Phone is 3 ft away", command=lambda: self.calibrate("near"),
                  bg="#3b82f6", fg="white", relief="flat", padx=8, pady=5).pack(side="left", padx=4)
        tk.Button(btns, text="Phone is 30 ft away", command=lambda: self.calibrate("far"),
                  bg="#6366f1", fg="white", relief="flat", padx=8, pady=5).pack(side="left", padx=4)
        self.cal = tk.Label(box, text="not calibrated  (do 3 ft, then 30 ft)", fg="#f59e0b", bg="#242424", font=("Segoe UI", 10))
        self.cal.pack(pady=(8, 0))
        self._choices: dict[str, str] = {}

    def _on_pick(self, _=None):
        self.addr = self._choices.get(self.pick.get())

    def set_choices(self, tracks: dict[str, Track], prefer: str, avoid: str | None):
        now = time.time()

        def rank(t: Track):
            remote = is_remote(t.addr)
            tag = is_tag(t.name)
            if prefer == "remote":
                return (not remote, not tag, now - t.last, t.name)
            return (remote, not tag, now - t.last, t.name)

        items = sorted(tracks.values(), key=rank)
        labels = []
        self._choices = {}
        for t in items:
            if t.addr == avoid:
                continue
            kind = "laptop" if is_remote(t.addr) else ("tag" if is_tag(t.name) else "other")
            label = f"{t.name or '?'}  [{kind}]  {t.addr[-8:]}"
            self._choices[label] = t.addr
            labels.append(label)
        self.menu["values"] = labels
        if self.addr and self.addr in tracks:
            return
        for t in items:
            if t.addr == avoid:
                continue
            if prefer == "remote" and not is_remote(t.addr):
                continue
            if prefer == "local" and is_remote(t.addr):
                continue
            self.addr = t.addr
            self.pick.set(next(k for k, v in self._choices.items() if v == t.addr))
            return
        if labels:
            self.addr = self._choices[labels[0]]
            self.pick.set(labels[0])

    def calibrate(self, which: str):
        with self.state.lock:
            t = self.state.tracks.get(self.addr or "")
            if t is None or t.ema is None:
                return
            if which == "near":
                t.rssi_near = t.ema
            else:
                t.rssi_far = t.ema
            near, far, n = t.rssi_near, t.rssi_far, t.n()
        if near is not None and far is not None:
            self.cal.config(text=f"3 ft={near:.0f} dBm   30 ft={far:.0f} dBm   n={n:.2f}", fg="#22c55e")
        elif near is not None:
            self.cal.config(text=f"3 ft={near:.0f} dBm   now walk to the other laptop and tap 30 ft", fg="#f59e0b")
        else:
            self.cal.config(text=f"30 ft={far:.0f} dBm   still need 3 ft", fg="#f59e0b")

    def render(self) -> float | None:
        now = time.time()
        with self.state.lock:
            t = self.state.tracks.get(self.addr or "")
        if t is None or t.ema is None:
            self.last_feet = None
            self.ft.config(text="-- ft", fg=MUTED)
            self.dbm.config(text="--- dBm")
            self.raw.config(text="raw ---")
            self.meta.config(text="waiting")
            return None
        stale = t.stale(now)
        d = t.feet()
        self.last_feet = None if stale else d
        color = MUTED if stale else FG
        self.ft.config(text=("lost" if stale else f"{d:.1f} ft"), fg="#ef4444" if stale else FG)
        self.dbm.config(text=f"{t.ema:.0f} dBm", fg=color)
        raw = t.raw()
        self.raw.config(text=f"raw {raw:.0f} dBm" if raw is not None else "raw ---")
        need = []
        if t.rssi_near is None:
            need.append("3 ft")
        if t.rssi_far is None:
            need.append("30 ft")
        extra = f"   calibrate {', '.join(need)}" if need else f"   n={t.n():.2f}"
        self.meta.config(text=f"{t.hits} hits   last {now - t.last:.1f}s{extra}")
        return self.last_feet


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--host", type=int, metavar="PORT", help="accept a friend's readings on this port")
    p.add_argument("--send", metavar="URL", help="send this laptop's readings to the host meter")
    p.add_argument("--id", default="friend", help="name this laptop when sending")
    args = p.parse_args()

    state = ScanState()
    threading.Thread(target=lambda: asyncio.run(state.scan()), daemon=True).start()
    ip = lan_ip()
    if args.host:
        start_host(state, args.host)
    if args.send:
        start_sender(state, args.send, args.id)

    root = tk.Tk()
    root.title("Lantern 30 ft range meter")
    root.geometry("960x640")
    root.configure(bg=BG)

    if args.host:
        cmd = f"python listener/rssi_meter.py --id friend --send http://{ip}:{args.host}"
        status = f"Hosting on {ip}:{args.host}   |   friend runs:  {cmd}"
    elif args.send:
        status = f"Sending as {args.id} to {args.send}"
    else:
        status = "Local only. Restart with --host 8790 to compare a friend's laptop."

    tk.Label(root, text=status, fg="#93c5fd", bg=BG, font=("Segoe UI", 10), wraplength=920).pack(pady=(12, 0))
    tk.Label(
        root,
        text="1) Phone 3 ft from THIS laptop, tap 3 ft on the left.  2) Walk to his laptop, tap 30 ft on the left.  3) Repeat on the right column (3 ft at his end, 30 ft at yours).  4) Walk the phone between you.",
        fg=MUTED,
        bg=BG,
        font=("Segoe UI", 10),
        wraplength=920,
        justify="left",
    ).pack(pady=(4, 0))

    row = tk.Frame(root, bg=BG)
    row.pack(expand=True, fill="both", padx=8)
    a = Column(row, "This laptop  (you)", state)
    b = Column(row, "Friend laptop", state)

    hall = tk.Frame(root, bg=BG)
    hall.pack(fill="x", padx=24, pady=(4, 8))
    tk.Label(hall, text="You", fg=FG, bg=BG, font=("Segoe UI", 11, "bold")).pack(side="left")
    tk.Label(hall, text="Friend", fg=FG, bg=BG, font=("Segoe UI", 11, "bold")).pack(side="right")
    canvas = tk.Canvas(root, height=46, bg="#242424", highlightthickness=0)
    canvas.pack(fill="x", padx=24)
    pos_lbl = tk.Label(root, text="walk the phone after both sides are calibrated", fg=MUTED, bg=BG, font=("Segoe UI", 11))
    pos_lbl.pack(pady=8)
    tk.Label(root, text="Close this window to stop.", fg="#555", bg=BG, font=("Segoe UI", 10)).pack(pady=(0, 10))

    def draw_bar(d_you: float | None, d_fr: float | None):
        canvas.delete("all")
        w = max(canvas.winfo_width(), 100)
        y = 23
        canvas.create_line(16, y, w - 16, y, fill="#555", width=6)
        canvas.create_text(16, 8, text="0 ft", fill=MUTED, anchor="w", font=("Segoe UI", 9))
        canvas.create_text(w - 16, 8, text=f"{FAR_FT:.0f} ft", fill=MUTED, anchor="e", font=("Segoe UI", 9))
        if d_you is None:
            pos_lbl.config(text="waiting for this laptop's phone signal")
            return
        if d_fr is not None and d_you + d_fr > 1:
            # Ratio of the two ranges, pinned to the 30 ft sofa span.
            pos = FAR_FT * d_you / (d_you + d_fr)
            pos_lbl.config(text=f"phone is about {pos:.0f} ft from you  /  {FAR_FT - pos:.0f} ft from him   (you {d_you:.1f} ft, him {d_fr:.1f} ft)")
        else:
            pos = min(FAR_FT, d_you)
            pos_lbl.config(text=f"phone is about {d_you:.1f} ft from you  (friend not connected yet)")
        x = 16 + (w - 32) * (pos / FAR_FT)
        canvas.create_oval(x - 10, y - 10, x + 10, y + 10, fill="#f59e0b", outline="")

    def tick():
        with state.lock:
            tracks = dict(state.tracks)
        a.set_choices(tracks, prefer="local", avoid=b.addr)
        b.set_choices(tracks, prefer="remote", avoid=a.addr)
        draw_bar(a.render(), b.render())
        root.after(100, tick)

    root.after(100, tick)
    root.mainloop()


if __name__ == "__main__":
    main()
