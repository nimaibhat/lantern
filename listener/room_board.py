"""Bedroom vs living room board for this laptop.

Reads the monitor (this laptop is the bedroom listener). Close the window to stop.
Does not scan Bluetooth itself, so it can run beside listener.py.
"""
from __future__ import annotations

import json
import tkinter as tk
import urllib.error
import urllib.request

MONITOR = "http://localhost:8787/debug/vector"
NEAR_DBM = -50.0
PATH_N = 2.8
MARGIN = 5
BG = "#1a1a1a"
FG = "#f5f5f5"
MUTED = "#888888"


def rough_feet(rssi: float) -> float:
    d = 3.0 * (10 ** ((NEAR_DBM - rssi) / (10 * PATH_N)))
    return max(0.5, min(45.0, d))


def fetch() -> dict | None:
    try:
        with urllib.request.urlopen(MONITOR, timeout=1.5) as r:
            return json.loads(r.read().decode())
    except (OSError, json.JSONDecodeError, urllib.error.URLError):
        return None


class Board:
    def __init__(self):
        self.room = "bedroom"
        self.root = tk.Tk()
        self.root.title("Bedroom vs Living room")
        self.root.geometry("820x520")
        self.root.configure(bg=BG)

        self.winner = tk.Label(self.root, text="WAITING", fg="#f59e0b", bg=BG, font=("Segoe UI", 54, "bold"))
        self.winner.pack(pady=(28, 0))
        self.sub = tk.Label(self.root, text="this laptop is the bedroom", fg=MUTED, bg=BG, font=("Segoe UI", 14))
        self.sub.pack()

        row = tk.Frame(self.root, bg=BG)
        row.pack(expand=True, fill="both", padx=16, pady=16)
        self.bed = self.column(row, "Bedroom", "this laptop")
        self.liv = self.column(row, "Living room", "friend's laptop")

        self.note = tk.Label(
            self.root,
            text="Louder laptop wins. It stays put until the other side is clearly stronger.",
            fg="#666",
            bg=BG,
            font=("Segoe UI", 11),
        )
        self.note.pack(pady=(0, 16))
        self.root.after(200, self.tick)

    def column(self, parent, title, who):
        box = tk.Frame(parent, bg="#242424", padx=18, pady=16)
        box.pack(side="left", expand=True, fill="both", padx=8)
        tk.Label(box, text=title, fg=FG, bg="#242424", font=("Segoe UI", 18, "bold")).pack(anchor="w")
        tk.Label(box, text=who, fg=MUTED, bg="#242424", font=("Segoe UI", 11)).pack(anchor="w")
        dbm = tk.Label(box, text="---", fg=FG, bg="#242424", font=("Segoe UI", 42, "bold"))
        dbm.pack(pady=(18, 0))
        unit = tk.Label(box, text="dBm", fg=MUTED, bg="#242424", font=("Segoe UI", 14))
        unit.pack()
        feet = tk.Label(box, text="-- ft", fg=FG, bg="#242424", font=("Segoe UI", 22))
        feet.pack(pady=(8, 0))
        state = tk.Label(box, text="offline", fg="#ef4444", bg="#242424", font=("Segoe UI", 12))
        state.pack(pady=(10, 0))
        return {"dbm": dbm, "feet": feet, "state": state, "box": box}

    def paint(self, col, rssi: float | None, online: bool, lead: bool):
        col["box"].configure(bg="#1e3a2f" if lead else "#242424")
        for w in col["box"].winfo_children():
            w.configure(bg="#1e3a2f" if lead else "#242424")
        if not online:
            col["dbm"].config(text="---", fg=MUTED)
            col["feet"].config(text="-- ft", fg=MUTED)
            col["state"].config(text="offline", fg="#ef4444")
            return
        if rssi is None or rssi <= -100:
            col["dbm"].config(text="---", fg=MUTED)
            col["feet"].config(text="-- ft", fg=MUTED)
            col["state"].config(text="online, no phone yet", fg="#f59e0b")
            return
        col["dbm"].config(text=f"{rssi:.0f}", fg=FG)
        col["feet"].config(text=f"about {rough_feet(rssi):.0f} ft", fg=FG)
        col["state"].config(text="hearing the phone", fg="#22c55e")

    def tick(self):
        data = fetch()
        if not data:
            self.winner.config(text="NO MONITOR", fg="#ef4444")
            self.sub.config(text="start the monitor on this laptop")
        else:
            order = data.get("order") or []
            rssi = data.get("rssi") or []
            online = data.get("online") or {}

            def val(name: str):
                if name not in order:
                    return None, False
                i = order.index(name)
                r = rssi[i] if i < len(rssi) else -100
                return r, bool(online.get(name))

            bed_r, bed_on = val("bedroom")
            liv_r, liv_on = val("living-room")
            bed_ok = bed_on and bed_r is not None and bed_r > -100
            liv_ok = liv_on and liv_r is not None and liv_r > -100

            if bed_ok and liv_ok:
                if liv_r > bed_r + MARGIN:
                    self.room = "living"
                elif bed_r > liv_r + MARGIN:
                    self.room = "bedroom"
            elif bed_ok and not liv_ok:
                self.room = "bedroom"
            elif liv_ok and not bed_ok:
                self.room = "living"

            if self.room == "living" and (liv_ok or bed_ok):
                self.winner.config(text="LIVING ROOM", fg="#93c5fd")
                self.sub.config(text="friend's laptop hears the phone more clearly")
            elif bed_ok or liv_ok:
                self.winner.config(text="BEDROOM", fg="#86efac")
                self.sub.config(text="this laptop hears the phone more clearly")
            elif bed_on and not liv_on:
                self.winner.config(text="BEDROOM", fg="#f59e0b")
                self.sub.config(text="waiting for the phone, and for his living-room listener")
            else:
                self.winner.config(text="WAITING", fg="#f59e0b")
                self.sub.config(text="turn on LightBlue and keep it on screen")

            lead_bed = self.room == "bedroom" and bed_ok
            lead_liv = self.room == "living" and liv_ok
            self.paint(self.bed, bed_r, bed_on, lead_bed)
            self.paint(self.liv, liv_r, liv_on, lead_liv)

        self.root.after(400, self.tick)

    def run(self):
        self.root.mainloop()


if __name__ == "__main__":
    Board().run()
