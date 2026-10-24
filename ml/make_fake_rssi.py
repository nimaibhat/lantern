"""Fake RSSI in the shared CSV format (PROJECT_PLAN 1.5), simulated from the listener anchors in the home model.

Each listener hears the tag at 5 Hz: rssi = txPower - 10 n log10(d) - 6 dB per wall + noise. Readings are then
reduced to one frame per second, the median of the last 3 s per receiver (-100 if fewer than 2), like the
monitor's RssiWindow. Sessions mirror Saran's collection protocol: 3 calibration sessions per room, plus
night routes taken from fixtures/walks.json. x,y hold the true position, which real data will not have.

    python ml/make_fake_rssi.py [--routes 10] [--seed 11]
"""

import argparse
import csv
import json
import math
import random
from datetime import datetime, timezone

from home import ROOT, door_center, load_home, point_in_polygon, receivers, room_at, room_path, walls_crossed

TX_POWER, PATH_N, WALL_DB, HEARD_FLOOR = -59, 2.5, 6.0, -95
HZ, WINDOW_S, MIN_SAMPLES = 5, 3, 2
TAG_HEIGHT_IN = 40
WALK_IN_S = (22, 34)  # slow walking speed
DWELL_CAP_S = 45  # keeps the CSV small; the room label does not change while dwelling
BASE = datetime(2026, 9, 1, tzinfo=timezone.utc).timestamp()


def random_point(rng, room, margin=12):
    xs, ys = [p["x"] for p in room["polygon"]], [p["y"] for p in room["polygon"]]
    for _ in range(200):
        x, y = rng.uniform(min(xs) + margin, max(xs) - margin), rng.uniform(min(ys) + margin, max(ys) - margin)
        if point_in_polygon(x, y, room["polygon"]):
            return x, y
    return room["centroid"]["x"], room["centroid"]["y"]


class Mover:
    """Walks a point around at 5 Hz and records (x, y) per tick."""

    def __init__(self, rng, start):
        self.rng, self.x, self.y, self.track = rng, start[0], start[1], []

    def go(self, x, y):
        speed = self.rng.uniform(*WALK_IN_S)
        steps = max(1, int(math.hypot(x - self.x, y - self.y) / speed * HZ))
        x0, y0 = self.x, self.y
        for i in range(1, steps + 1):
            self.track.append((x0 + (x - x0) * i / steps, y0 + (y - y0) * i / steps))
        self.x, self.y = x, y

    def wait(self, seconds):
        self.track += [(self.x, self.y)] * int(seconds * HZ)

    def wander(self, room, seconds):
        if seconds <= 0:
            return
        end = len(self.track) + int(seconds * HZ)
        while len(self.track) < end:
            self.go(*random_point(self.rng, room))
            self.wait(self.rng.uniform(0, 4))
        del self.track[end:]
        self.x, self.y = self.track[-1]


def listen(rng, home, track):
    """Raw 5 Hz readings per receiver. Per-session bias and slow body shadowing make it less clean than a formula."""
    anchors = {a["receiverId"]: a for a in home["anchors"]}
    bias = {r: rng.gauss(0, 2) for r in anchors}
    shadow = {r: 0.0 for r in anchors}
    heard = {r: [] for r in anchors}
    for i, (x, y) in enumerate(track):
        for r, a in anchors.items():
            shadow[r] = 0.95 * shadow[r] + rng.gauss(0, 0.9)
            ax, ay = a["position"]["x"], a["position"]["y"]
            d_m = max(math.sqrt((x - ax) ** 2 + (y - ay) ** 2 + (TAG_HEIGHT_IN - a["heightIn"]) ** 2) * 0.0254, 0.1)
            walls = walls_crossed(home, (x, y), (ax, ay))
            rssi = TX_POWER - 10 * PATH_N * math.log10(d_m) - WALL_DB * walls + bias[r] + shadow[r] + rng.gauss(0, 3)
            if rssi >= HEARD_FLOOR and rng.random() > 0.15:  # BLE misses some advertisements
                heard[r].append((i / HZ, rssi))
    return heard


def frames(home, track, heard, label_room=None):
    order = receivers(home)
    last_room = label_room
    for s in range(1, int(len(track) / HZ) + 1):
        x, y = track[min(s * HZ, len(track)) - 1]
        room = label_room or room_at(home, x, y) or last_room
        last_room = room
        vec = []
        for r in order:
            w = sorted(v for t, v in heard[r] if s - WINDOW_S < t <= s)
            if len(w) < MIN_SAMPLES:
                vec.append(-100)
            else:
                m = len(w) // 2
                vec.append(round(w[m] if len(w) % 2 else (w[m - 1] + w[m]) / 2))
        yield s, room, x, y, vec


def calibration(rng, home, room, seconds=120):
    m = Mover(rng, random_point(rng, room))
    m.wander(room, seconds)
    return m.track


def route(rng, home, rooms_with_dwell):
    rooms = {r["id"]: r for r in home["rooms"]}
    first = rooms_with_dwell[0][0]
    m = Mover(rng, random_point(rng, rooms[first]))
    for i, (rid, dwell) in enumerate(rooms_with_dwell):
        m.wander(rooms[rid], min(dwell, DWELL_CAP_S))
        if i + 1 < len(rooms_with_dwell):
            nxt = rooms_with_dwell[i + 1][0]
            path = room_path(home, rid, nxt)
            for a, b in zip(path, path[1:]):
                m.go(*door_center(home, a, b))
            m.go(*random_point(rng, rooms[nxt], margin=18))
    return m.track


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--routes", type=int, default=10, help="recent night walks to turn into route sessions")
    ap.add_argument("--seed", type=int, default=11)
    ap.add_argument("--home")
    ap.add_argument("--walks", default=str(ROOT / "fixtures" / "walks.json"))
    ap.add_argument("--out", default=str(ROOT / "fixtures" / "rssi-samples.fake.csv"))
    a = ap.parse_args()

    home, home_path = load_home(a.home)
    rng = random.Random(a.seed)
    order = receivers(home)
    sessions = []  # (id, start_ts_seconds, track, fixed_label)

    for n in range(3):
        for room in home["rooms"]:
            start = BASE + (40 + n) * 86400 + rng.uniform(10, 16) * 3600
            sessions.append((f"cal-{room['id']}-{n + 1}", start, calibration(rng, home, room), room["id"]))

    walks = json.load(open(a.walks))["walks"]
    nights = sorted((w for w in walks if w["kind"] == "night"), key=lambda w: w["day"])[-a.routes:]
    for w in nights:
        steps = [(s["room"], s["dwellS"]) for s in w["steps"]]
        start = BASE + w["day"] * 86400 + w["steps"][0]["hour"] * 3600
        sessions.append((f"route-{w['id']}", start, route(rng, home, steps), None))
    # The held-out test route from the collection protocol, at 3 AM on the last day
    test = [("bedroom", 30), ("hallway", 0), ("kitchen", 45), ("hallway", 0), ("bedroom", 30)]
    last_day = max(w["day"] for w in walks)
    sessions.append(("route-test", BASE + last_day * 86400 + 3 * 3600, route(rng, home, test), None))

    rows = 0
    per_room = {}
    with open(a.out, "w", newline="") as f:
        out = csv.writer(f)
        out.writerow(["session", "ts", "roomId", "x", "y", *order])
        for sid, start, track, label in sessions:
            for s, room, x, y, vec in frames(home, track, listen(rng, home, track), label):
                out.writerow([sid, int((start + s) * 1000), room, round(x, 1), round(y, 1), *vec])
                per_room[room] = per_room.get(room, 0) + 1
                rows += 1

    print(f"{rows} windows in {len(sessions)} sessions from {home_path.name} -> {a.out}")
    print("windows per room:", dict(sorted(per_room.items())))


if __name__ == "__main__":
    main()
