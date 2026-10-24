# ml/ (Vineet)

Room classifier, next-room predictor, and the numbers on `/dashboard/models`. Inference itself runs in the monitor (`monitor/inference/`); these scripts train it and measure it.

```bash
python -m venv ml/.venv && ml/.venv/Scripts/pip install -r ml/requirements.txt   # macOS: ml/.venv/bin/pip

# Until real data exists (both are synthetic and labeled that way)
python ml/synth_walks.py          # fixtures/walks.json: 6 weeks of movement, 3 AM kitchen trips rising
python ml/make_fake_rssi.py       # fixtures/rssi-samples.fake.csv from the listener anchors (path loss + walls + noise)

ml/.venv/Scripts/python ml/train.py   # strongest receiver vs kNN vs random forest -> ml/out/knn.json
python ml/train_markov.py             # -> ml/out/markov.json
npx tsx tools/vineet-replay.ts        # night routes through the real engine -> ml/out/pipeline.json
python ml/report.py                   # -> ml/out/metrics.json (the models page)
curl -X POST localhost:8787/model/reload
```

`train.py` uses `fixtures/rssi-samples.csv` (Saran's real data) as soon as it exists, and refuses to train on it when `python ml/check_data.py` finds errors (unknown room ids, missing columns). Run the check right after each collection session: it also warns about thin rooms, a listener that never heard the tag, and rooms that look alike to every listener. Add `--upload` to `train.py`, `train_markov.py` or `report.py` to also insert the result into the Supabase `models` table (keys from `.env.local`).

- The home model comes from `fixtures/home-model.json` (Nimai). Regenerate the fake CSV whenever its anchors or doors change.
- Real data: name sessions so each calibration session covers one room. Any session with more than one room is treated as a route and held out of `knn-holdout.json`, so the replay scores it honestly.
- `DEMO_HOUR=3` on the monitor pins the predictor's clock, so an afternoon demo plays the 3 AM story.
- `/dashboard/models` polls the monitor's `GET /debug/inference` once a second (`NEXT_PUBLIC_MONITOR_URL`, default `http://localhost:8787`) for its live panel, so the monitor host must allow the web origin (CORS).
