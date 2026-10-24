"""Markov destination predictor: weighted counts of the next room given (previous room, current room, 3-hour bucket).

Keys match monitor/inference/predictor.ts: "prev>cur|bucket", "cur|bucket", "cur" (it backs off in that order).
Older walks count less (half-life 7 days), so a new habit like 3 AM kitchen trips shows up within a week or two.
Recorded sessions (fixtures/sessions/*.jsonl, Saran's recorder) count as today.

    python ml/train_markov.py [--half-life 7] [--upload]
"""

import argparse
import glob
import json
from datetime import datetime, timezone
from pathlib import Path

from home import ROOT

OUT = Path(__file__).parent / "out"
BUCKET_H = 3


def add(counts, key, nxt, w):
    c = counts.setdefault(key, {})
    c[nxt] = c.get(nxt, 0) + w


def count_sequence(counts, rooms, hours, w):
    for i in range(len(rooms) - 1):
        cur, nxt, bucket = rooms[i], rooms[i + 1], int(hours[i] // BUCKET_H) % 8
        if i > 0:
            add(counts, f"{rooms[i - 1]}>{cur}|{bucket}", nxt, w)
        add(counts, f"{cur}|{bucket}", nxt, w)
        add(counts, cur, nxt, w)


def recorded(pattern):
    """Room sequences from location events in recorded sessions."""
    for path in sorted(glob.glob(pattern)):
        rooms, hours = [], []
        for line in open(path):
            e = json.loads(line)
            if e.get("k") == "location":
                t = datetime.fromtimestamp(e["ts"] / 1000)  # local time, like the monitor
                rooms.append(e["d"]["roomId"])
                hours.append(t.hour + t.minute / 60)
        if len(rooms) > 1:
            yield rooms, hours


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--walks", default=str(ROOT / "fixtures" / "walks.json"))
    ap.add_argument("--sessions", default=str(ROOT / "fixtures" / "sessions" / "*.jsonl"))
    ap.add_argument("--half-life", type=float, default=7, help="days")
    ap.add_argument("--upload", action="store_true")
    a = ap.parse_args()

    walks = json.load(open(a.walks))
    last = max(w["day"] for w in walks["walks"])
    counts = {}
    for w in walks["walks"]:
        weight = 0.5 ** ((last - w["day"]) / a.half_life)
        count_sequence(counts, [s["room"] for s in w["steps"]], [s["hour"] for s in w["steps"]], weight)
    n_rec = 0
    for rooms, hours in recorded(a.sessions):
        count_sequence(counts, rooms, hours, 1.0)
        n_rec += 1

    counts = {k: {r: round(v, 3) for r, v in c.items()} for k, c in counts.items()}
    model = {"kind": "markov", "bucketHours": BUCKET_H, "minTotal": 5, "halfLifeDays": a.half_life,
             "synthetic": bool(walks.get("synthetic")), "walks": len(walks["walks"]), "recordedSessions": n_rec,
             "createdAt": datetime.now(timezone.utc).isoformat(timespec="seconds"), "counts": counts}
    OUT.mkdir(exist_ok=True)
    (OUT / "markov.json").write_text(json.dumps(model, separators=(",", ":")))
    print(f"{len(counts)} contexts from {len(walks['walks'])} walks + {n_rec} recorded sessions -> {OUT / 'markov.json'}")
    for key in ["bedroom>hallway|0", "bedroom>hallway|1", "hallway|1"]:
        c = counts.get(key)
        if c:
            total = sum(c.values())
            top = sorted(c.items(), key=lambda kv: -kv[1])[:3]
            print(f"  {key:18s} total {total:5.1f}  " + ", ".join(f"{r} {v / total:.2f}" for r, v in top))

    if a.upload:
        from supa import upload_model

        upload_model("markov", model)


if __name__ == "__main__":
    main()
