"""Checks an RSSI CSV against the home model and Saran's collection protocol before anyone trains on it.

Errors (exit 1) would make training wrong: missing columns, room ids the home model does not know.
Warnings are worth fixing before the demo: thin rooms, too few sessions, a listener that never hears the tag,
two rooms that look the same to every listener.

    python ml/check_data.py [fixtures/rssi-samples.csv]
"""

import sys
from pathlib import Path

import pandas as pd

from home import ROOT, load_home, receivers

META = ["session", "ts", "roomId", "x", "y"]
MIN_WINDOWS, MIN_SESSIONS = 100, 3  # per room, from the collection protocol


def check(df, home):
    errors, warnings = [], []
    missing = [c for c in META if c not in df.columns]
    if missing:
        return [f"missing columns: {missing}"], []
    order = [c for c in df.columns if c not in META]
    anchors, rooms = set(receivers(home)), {r["id"] for r in home["rooms"]}

    if set(order) - anchors:
        warnings.append(f"receivers not in the home model's anchors (no position, ignored by the avatar): {sorted(set(order) - anchors)}")
    if anchors - set(order):
        warnings.append(f"anchors with no column in the CSV (their listener never ran): {sorted(anchors - set(order))}")
    unknown = sorted(set(df["roomId"]) - rooms)
    if unknown:
        errors.append(f"room ids the home model does not have (typo, or the model changed): {unknown}")

    single = df.groupby("session")["roomId"].transform("nunique") == 1
    for room in sorted(rooms):
        n = int((df["roomId"] == room).sum())
        sessions = df[single & (df["roomId"] == room)]["session"].nunique()
        if n == 0:
            warnings.append(f"{room}: no data; the classifier can never say this room")
        elif n < MIN_WINDOWS:
            warnings.append(f"{room}: {n} windows (aim for {MIN_WINDOWS}+)")
        if 0 < sessions < MIN_SESSIONS:
            warnings.append(f"{room}: {sessions} calibration session(s) (aim for {MIN_SESSIONS}, at different times)")
    if not (~single).any():
        warnings.append("no route session (one that crosses rooms); the replay cannot score the full pipeline")

    for r in order:
        silent = float((df[r] <= -100).mean())
        if silent == 1:
            warnings.append(f"{r}: never heard the tag (wrong --id, Bluetooth permission, or not running)")
        elif silent > 0.5:
            warnings.append(f"{r}: no reading in {silent:.0%} of windows")

    # Rooms whose median readings are within 3 dB on every listener look the same to a kNN
    med = df[df["roomId"].isin(rooms)].groupby("roomId")[order].median()
    names = list(med.index)
    for i, a in enumerate(names):
        for b in names[i + 1:]:
            if (abs(med.loc[a] - med.loc[b]) <= 3).all():
                warnings.append(f"{a} and {b} look alike to every listener; move a listener or add one between them")

    for s, g in df.groupby("session"):
        gaps = g["ts"].sort_values().diff().dropna()
        if (gaps > 5000).any():
            warnings.append(f"session {s}: {int((gaps > 5000).sum())} gap(s) over 5 s (listener or tag dropped out)")
    return errors, warnings


def report(df, home):
    order = [c for c in df.columns if c not in META]
    print(f"{len(df)} windows, {df['session'].nunique()} sessions, receivers {order}")
    print("median RSSI per room (rows) and listener (columns):")
    print(df.groupby("roomId")[order].median().round().astype(int).to_string())
    errors, warnings = check(df, home)
    for e in errors:
        print("ERROR  ", e)
    for w in warnings:
        print("warning", w)
    if not errors and not warnings:
        print("looks good")
    return errors


if __name__ == "__main__":
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "fixtures" / "rssi-samples.csv"
    if not path.exists():
        sys.exit(f"{path} not found (Saran exports it from /calibrate)")
    home, home_path = load_home()
    print(f"checking {path.name} against {home_path.name}")
    sys.exit(1 if report(pd.read_csv(path), home) else 0)
