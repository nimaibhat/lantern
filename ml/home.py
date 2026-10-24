"""Home model loading and the small bits of geometry the ML scripts need (inches, shared floor frame)."""

import json
import math
from collections import deque
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FIXTURE = ROOT / "fixtures" / "home-model.json"  # Nimai's demo home


def load_home(path=None):
    p = Path(path) if path else FIXTURE
    return json.loads(p.read_text()), p


def receivers(home):
    # Same order the monitor uses for SensorFrame.order
    return sorted(a["receiverId"] for a in home["anchors"])


def point_in_polygon(x, y, poly):
    inside = False
    for i in range(len(poly)):
        a, b = poly[i], poly[i - 1]
        if (a["y"] > y) != (b["y"] > y) and x < (b["x"] - a["x"]) * (y - a["y"]) / (b["y"] - a["y"]) + a["x"]:
            inside = not inside
    return inside


def room_at(home, x, y):
    for r in home["rooms"]:
        if point_in_polygon(x, y, r["polygon"]):
            return r["id"]
    return None


def neighbors(home):
    adj = {r["id"]: [] for r in home["rooms"]}
    for d in home["doors"]:
        adj[d["roomA"]].append(d["roomB"])
        adj[d["roomB"]].append(d["roomA"])
    return adj


def room_path(home, a, b):
    """Rooms from a to b through doors (BFS), both ends included."""
    adj, prev, q = neighbors(home), {a: None}, deque([a])
    while q:
        cur = q.popleft()
        if cur == b:
            break
        for n in adj[cur]:
            if n not in prev:
                prev[n] = cur
                q.append(n)
    if b not in prev:
        raise ValueError(f"no door path from {a} to {b}")
    out = [b]
    while out[-1] != a:
        out.append(prev[out[-1]])
    return out[::-1]


def door_center(home, a, b):
    for d in home["doors"]:
        if {d["roomA"], d["roomB"]} == {a, b}:
            return d["center"]["x"], d["center"]["y"]
    raise ValueError(f"no door between {a} and {b}")


def _hit(p, q, a, b):
    rx, ry, sx, sy = q[0] - p[0], q[1] - p[1], b[0] - a[0], b[1] - a[1]
    den = rx * sy - ry * sx
    if abs(den) < 1e-9:
        return None  # parallel: walking along a wall does not cross it
    t = ((a[0] - p[0]) * sy - (a[1] - p[1]) * sx) / den
    u = ((a[0] - p[0]) * ry - (a[1] - p[1]) * rx) / den
    return t if 0 < t < 1 and 0 <= u <= 1 else None


def walls_crossed(home, p, q):
    """Walls between two points, ignoring door openings. A shared wall is an edge of both rooms, so nearby hits merge."""
    hits = []
    for room in home["rooms"]:
        poly = room["polygon"]
        for i in range(len(poly)):
            a, b = poly[i - 1], poly[i]
            t = _hit(p, q, (a["x"], a["y"]), (b["x"], b["y"]))
            if t is None:
                continue
            x, y = p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])
            if any(math.hypot(x - d["center"]["x"], y - d["center"]["y"]) <= d["widthIn"] / 2 for d in home["doors"]):
                continue
            hits.append(t)
    length = math.hypot(q[0] - p[0], q[1] - p[1])
    count, last = 0, None
    for t in sorted(hits):
        if last is None or (t - last) * length > 2:
            count += 1
        last = t
    return count
