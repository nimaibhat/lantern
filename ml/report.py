"""Model metrics for the team and the judges: ml/out/metrics.json (MetricsReport in lib/types/inference.ts).

Combines classifier cross-validation (ml/out/cv.json from train.py) with the replayed pipeline
(ml/out/pipeline.json from tools/vineet-replay.ts): room accuracy with and without the door-graph HMM,
lead times, false redirects, room-change delay. Never hides a bad number: if kNN lost, the baseline ships
and the report says so.

    python ml/report.py [--upload]
"""

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

OUT = Path(__file__).parent / "out"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--upload", action="store_true")
    a = ap.parse_args()

    cv = json.loads((OUT / "cv.json").read_text())
    pipe_path = OUT / "pipeline.json"
    pipe = json.loads(pipe_path.read_text()) if pipe_path.exists() else None
    if not pipe:
        print("no pipeline.json yet (run: npx tsx tools/vineet-replay.ts); pipeline numbers left empty")

    report = {
        "accuracy": cv["accuracy"],
        "baselineAccuracy": cv["baselineAccuracy"],
        "perRoom": cv["perRoom"],
        "baselinePerRoom": cv["baselinePerRoom"],
        "confusion": cv["confusion"],
        "labels": cv["labels"],
        "leadTimesS": pipe["leadTimesS"] if pipe else [],
        "falseRedirectsPerNight": pipe["falseRedirectsPerNight"] if pipe else 0,
        "latencyMs": pipe["latencyMs"] if pipe else 0,
        "dataset": cv["dataset"],
        "shipped": cv["shipped"],
        "models": {name: m["accuracy"] for name, m in cv["models"].items()},
        "windowsPerRoom": cv["windowsPerRoom"],
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    if pipe:
        keys = ["sessions", "nights", "roomAccuracy", "roomAccuracyNoHmm", "impossibleJumps", "impossibleJumpsNoHmm",
                "roomChanges", "roomChangesNoHmm", "trueRoomChanges", "predictions", "predictionsCorrect", "positionErrorIn", "positionErrorRoomCenterIn"]
        report["pipeline"] = {k: pipe[k] for k in keys if pipe.get(k) is not None}
        if pipe.get("unplugged"):
            report["unplugged"] = pipe["unplugged"]

    (OUT / "metrics.json").write_text(json.dumps(report, indent=2) + "\n")
    print(f"{report['shipped']} {report['accuracy']:.1%} vs strongest receiver {report['baselineAccuracy']:.1%} ({report['dataset']} data)")
    if pipe:
        p = report["pipeline"]
        print(f"replayed {p['sessions']} routes: room accuracy {p['roomAccuracy']:.1%} with door graph, "
              f"{p['roomAccuracyNoHmm']:.1%} without; impossible jumps {p['impossibleJumps']} vs {p['impossibleJumpsNoHmm']}")
        lead = sorted(report["leadTimesS"])
        print(f"predictions {p['predictionsCorrect']}/{p['predictions']} right, median lead {lead[len(lead) // 2] if lead else 0} s; "
              f"false redirects/night {report['falseRedirectsPerNight']:.2f}; room-change delay {report['latencyMs'] / 1000:.1f} s")
    print(f"wrote {OUT / 'metrics.json'}")

    if a.upload:
        from supa import upload_model

        upload_model("metrics", report, report["accuracy"])


if __name__ == "__main__":
    main()
