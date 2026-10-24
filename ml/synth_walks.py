"""Synthetic movement histories for the Markov predictor: fixtures/walks.json.

RSSI is real once Saran collects it; weeks of movement are not, so these are simulated and labeled that way.
Night trips mostly go bedroom > hallway > bathroom > hallway > bedroom. Kitchen trips start rare and rise over
the weeks, which is the change the predictor (and the analytics page) should pick up.

    python ml/synth_walks.py [--days 42] [--seed 7]
"""

import argparse
import json
import random

from home import ROOT, load_home, room_path

NIGHT_DWELL_S = {"bathroom": (120, 360), "kitchen": (90, 300), "front-door": (20, 60), "tv-room": (120, 600)}
DAY_DWELL_MIN = {"kitchen": (10, 40), "tv-room": (30, 90), "bathroom": (3, 10), "bedroom": (10, 60), "front-door": (1, 5)}
# Where the person heads next from the hallway, by part of the day
DAY_PREFS = {
    "morning": {"bathroom": 0.3, "kitchen": 0.4, "tv-room": 0.2, "bedroom": 0.1},
    "midday": {"tv-room": 0.4, "kitchen": 0.3, "bathroom": 0.15, "bedroom": 0.1, "front-door": 0.05},
    "evening": {"kitchen": 0.3, "tv-room": 0.3, "bathroom": 0.2, "bedroom": 0.2},
}


def night_target(rng, day, days):
    kitchen = 0.08 + 0.67 * (day / max(days - 1, 1)) ** 1.3
    w = {"kitchen": kitchen, "front-door": 0.03, "tv-room": 0.03, "bedroom": 0.03}  # bedroom = turned back
    w["bathroom"] = 1 - sum(w.values())
    return rng.choices(list(w), list(w.values()))[0]


def expand(home, rooms):
    """Fill in the rooms passed through, so every step is one door away from the last."""
    out = [rooms[0]]
    for nxt in rooms[1:]:
        out += room_path(home, out[-1], nxt)[1:]
    return out


def timed(home, rooms, hour, dwell, start=0):
    steps = []
    for r in expand(home, rooms)[start:]:
        s = dwell(r)
        steps.append({"room": r, "hour": round(hour % 24, 4), "dwellS": s})
        hour += s / 3600
    return steps, hour


def night(rng, home, day, days):
    walks, hour = [], 0.3
    for n in range(rng.choice([0, 1, 1, 1, 2, 2])):
        hour = max(hour, rng.triangular(0.5, 5.5, 3.0))
        target = night_target(rng, day, days)
        rooms = ["bedroom", "hallway", "bedroom"] if target == "bedroom" else ["bedroom", target, "bedroom"]

        def dwell(r):
            if r == "hallway":
                return rng.randint(6, 20)
            if r == "bedroom":
                return 30
            return rng.randint(*NIGHT_DWELL_S.get(r, (60, 180)))

        steps, hour = timed(home, rooms, hour, dwell)
        walks.append({"id": f"d{day:02d}-n{n + 1}", "day": day, "kind": "night", "steps": steps})
        hour += 0.5
    return walks


def daytime(rng, home, day):
    def dwell(r):
        if r == "hallway":
            return rng.randint(5, 20)
        return int(rng.uniform(*DAY_DWELL_MIN.get(r, (1, 5))) * 60)

    steps, hour = timed(home, ["bedroom"], rng.gauss(7.0, 0.3), dwell)
    while hour < 21.5:
        cur = steps[-1]["room"]
        if cur == "hallway":
            part = "morning" if hour < 10 else "midday" if hour < 17 else "evening"
            came_from = steps[-2]["room"] if len(steps) > 1 else None
            prefs = {r: w for r, w in DAY_PREFS[part].items() if r != came_from}
            nxt = rng.choices(list(prefs), list(prefs.values()))[0]
        else:
            nxt = "hallway"
        more, hour = timed(home, [cur, nxt], hour, dwell, start=1)
        steps += more
    if steps[-1]["room"] != "bedroom":
        steps += timed(home, [steps[-1]["room"], "bedroom"], hour, dwell, start=1)[0]
    return {"id": f"d{day:02d}-day", "day": day, "kind": "day", "steps": steps}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=42)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--home")
    ap.add_argument("--out", default=str(ROOT / "fixtures" / "walks.json"))
    a = ap.parse_args()

    home, home_path = load_home(a.home)
    rng = random.Random(a.seed)
    walks = []
    for day in range(a.days):
        walks += night(rng, home, day, a.days)
        walks.append(daytime(rng, home, day))

    out = {"synthetic": True, "seed": a.seed, "days": a.days, "home": home_path.name, "walks": walks}
    with open(a.out, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    nights = [w for w in walks if w["kind"] == "night"]
    recent = [w for w in nights if w["day"] >= a.days - 7]
    kitchen = sum(any(s["room"] == "kitchen" for s in w["steps"]) for w in recent)
    print(f"{len(walks)} walks ({len(nights)} night trips) over {a.days} days -> {a.out}")
    print(f"last 7 days: {kitchen}/{len(recent)} night trips went to the kitchen")


if __name__ == "__main__":
    main()
