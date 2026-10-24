"""Room classifier: strongest-receiver baseline vs kNN (k = 3, 5, 7) vs Random Forest on SensorFrame vectors.

Cross-validation groups by recording session, so neighboring windows never sit on both sides of a split.
The best kNN ships (monitor/inference/knn.ts runs it), unless the baseline beats it; then the baseline ships.

    python ml/train.py [--csv fixtures/rssi-samples.csv] [--upload]

Writes ml/out/knn.json (shipped model, all data), ml/out/knn-holdout.json (single-room sessions only, so route
sessions can be replayed honestly), ml/out/cv.json, and ml/out/confusion.png when matplotlib is installed.
"""

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, confusion_matrix
from sklearn.model_selection import StratifiedGroupKFold
from sklearn.neighbors import KNeighborsClassifier

from check_data import check
from home import ROOT, load_home

META = ["session", "ts", "roomId", "x", "y"]
REAL, FAKE = ROOT / "fixtures" / "rssi-samples.csv", ROOT / "fixtures" / "rssi-samples.fake.csv"


def load(path):
    df = pd.read_csv(path)
    order = [c for c in df.columns if c not in META]
    return df, order


def baseline(X, order):
    # Receiver slugs are room slugs, so the loudest listener names the room. Listener --offset is already applied.
    return np.array(order)[X.argmax(axis=1)]


def knn(k):
    return KNeighborsClassifier(n_neighbors=k, weights="distance")


def cross_val(df, order, make):
    X, y, groups = df[order].to_numpy(float), df["roomId"].to_numpy(), df["session"].to_numpy()
    folds = StratifiedGroupKFold(n_splits=min(5, len(set(groups))), shuffle=True, random_state=0)
    pred = np.empty(len(y), dtype=object)
    for train, test in folds.split(X, y, groups):
        pred[test] = baseline(X[test], order) if make is None else make().fit(X[train], y[train]).predict(X[test])
    return pred


def scores(y, pred, labels):
    cm = confusion_matrix(y, pred, labels=labels)
    per_room = {l: float(cm[i, i] / cm[i].sum()) if cm[i].sum() else 0.0 for i, l in enumerate(labels)}
    return {"accuracy": float(accuracy_score(y, pred)), "perRoom": per_room, "confusion": cm.tolist()}


def export(df, order, k, algo, extra):
    labels = sorted(df["roomId"].unique())
    model = {"kind": "knn", "algo": algo, "k": k, "order": order, "rooms": labels, "vectors": [], "labels": []}
    if algo == "knn":
        model["vectors"] = df[order].astype(int).to_numpy().tolist()
        model["labels"] = df["roomId"].tolist()
    return {**model, **extra}


def plot(cm, labels, title, path):
    try:
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError:
        print("matplotlib not installed; skipping", path.name)
        return
    cm = np.array(cm, dtype=float)
    norm = cm / np.maximum(cm.sum(axis=1, keepdims=True), 1)
    fig, ax = plt.subplots(figsize=(6, 5))
    ax.imshow(norm, cmap="Oranges", vmin=0, vmax=1)
    ax.set_xticks(range(len(labels)), labels, rotation=40, ha="right")
    ax.set_yticks(range(len(labels)), labels)
    ax.set_xlabel("Predicted room")
    ax.set_ylabel("True room")
    for i in range(len(labels)):
        for j in range(len(labels)):
            if cm[i, j]:
                ax.text(j, i, f"{norm[i, j]:.0%}", ha="center", va="center", fontsize=8, color="white" if norm[i, j] > 0.5 else "black")
    ax.set_title(title)
    fig.tight_layout()
    fig.savefig(path, dpi=150)
    plt.close(fig)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", help="defaults to the real CSV when it exists, else the fake one")
    ap.add_argument("--upload", action="store_true", help="also insert the model into Supabase models")
    ap.add_argument("--out-dir", default=str(Path(__file__).parent / "out"))
    ap.add_argument("--force", action="store_true", help="train even when ml/check_data.py finds errors")
    a = ap.parse_args()
    OUT = Path(a.out_dir)

    path = Path(a.csv) if a.csv else (REAL if REAL.exists() else FAKE)
    dataset = "synthetic" if "fake" in path.name else "real"
    df, order = load(path)
    labels = sorted(df["roomId"].unique())
    y = df["roomId"].to_numpy()
    print(f"{len(df)} windows, {df['session'].nunique()} sessions, receivers {order} ({dataset}: {path.name})")
    errors, warnings = check(df, load_home()[0])
    for w in warnings:
        print("  warning:", w)
    if errors and not a.force:
        raise SystemExit("\n  ".join(["data errors (python ml/check_data.py for details, --force to train anyway):", *errors]))

    candidates = {"baseline": None, "knn3": lambda: knn(3), "knn5": lambda: knn(5), "knn7": lambda: knn(7),
                  "rf": lambda: RandomForestClassifier(n_estimators=200, random_state=0)}
    results = {}
    for name, make in candidates.items():
        results[name] = scores(y, cross_val(df, order, make), labels)
        print(f"  {name:9s} accuracy {results[name]['accuracy']:.3f}")

    best = max(["knn3", "knn5", "knn7"], key=lambda n: results[n]["accuracy"])
    shipped = best if results[best]["accuracy"] >= results["baseline"]["accuracy"] else "baseline"
    k = int(best[3:]) if shipped != "baseline" else 0
    print(f"ships: {shipped}" + ("" if shipped != "baseline" else " (kNN did not beat the strongest receiver)"))
    print("confusion (rows = true, cols = predicted):", labels)
    for l, row in zip(labels, results[shipped]["confusion"]):
        print(f"  {l:11s}", row)

    OUT.mkdir(exist_ok=True)
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    algo = "knn" if shipped != "baseline" else "baseline"
    extra = {"accuracy": results[shipped]["accuracy"], "baselineAccuracy": results["baseline"]["accuracy"],
             "dataset": dataset, "csv": path.name, "createdAt": now}
    model = export(df, order, k, algo, extra)
    (OUT / "knn.json").write_text(json.dumps(model, separators=(",", ":")))

    single = df.groupby("session")["roomId"].transform("nunique") == 1
    holdout = export(df[single] if single.any() and not single.all() else df, order, k, algo, {**extra, "holdout": True})
    (OUT / "knn-holdout.json").write_text(json.dumps(holdout, separators=(",", ":")))

    cv = {"dataset": dataset, "csv": path.name, "createdAt": now, "windows": len(df), "sessions": int(df["session"].nunique()),
          "windowsPerRoom": {l: int((y == l).sum()) for l in labels}, "labels": labels, "order": order,
          "shipped": shipped, "k": k, "models": {n: {"accuracy": r["accuracy"]} for n, r in results.items()},
          "accuracy": results[shipped]["accuracy"], "perRoom": results[shipped]["perRoom"], "confusion": results[shipped]["confusion"],
          "baselineAccuracy": results["baseline"]["accuracy"], "baselinePerRoom": results["baseline"]["perRoom"]}
    (OUT / "cv.json").write_text(json.dumps(cv, indent=2))
    plot(results[shipped]["confusion"], labels, f"{shipped}: {results[shipped]['accuracy']:.0%} ({dataset} data)", OUT / "confusion.png")
    print(f"wrote {OUT / 'knn.json'}, knn-holdout.json, cv.json")

    if a.upload:
        from supa import upload_model

        upload_model("knn", model, model["accuracy"])


if __name__ == "__main__":
    main()
