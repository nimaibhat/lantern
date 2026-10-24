# Lantern status and plan

Checked on 2026-10-23 against `PROJECT_PLAN.md`. Update this file when an item moves.

## Where things stand

- `main` holds everything: the four feature branches were merged and deleted upstream.
- `npm run typecheck` is clean, `npm test` passes (124 tests), `npm run build` passes (28 routes).
- **Simulated loop works end to end.** Mock listeners > 1 s frames > kNN + door-graph HMM > `location` and
  `prediction` > `kitchen-night` risk at 3 AM > TV glow, then photo and voice > resolved when the person walks back,
  with no message. Staying put sends the SMS at 30 s and the call at 75 s (demo timers, dry run); acknowledging
  stops it.
- **Every page was driven in a browser** at desktop and phone width (landing, all dashboard pages, rooms, the TV
  page): no console errors, no failed requests other than the expected missing redirect photo, no overflow.
- **Not yet proven with real hardware.** The tag, the laptop listeners and the classifier have not been run together
  in a real space, and the classifier is trained on simulated readings only (the Models page says so).

## Done in the 2026-10-23 pass

- Analytics page (was a stub): kitchen-at-night insight, last night, weekly trend, room-by-hour heat map with a
  table view, and tonight's live outcomes from the monitor. History is labeled demo data.
- Overview: SIMULATED badge for simulator and replay events, predicted or detected on each risk, listener count
  stays live, tag-offline warning, no reconnect after leaving the page, and live room ids (`tv-room`,
  `front-door`) now match the scanned rooms (`living`, `entry`).
- Monitor: the tag counts as offline after 60 s without a reading from any listener (`/health` `tagOnline`, logged).
- 3D view: room, hazard and prediction labels no longer use drei `<Html>`, which logged a React error per label in
  dev and put a red issue badge on the demo screen.
- Routine editor no longer overflows a phone screen.
- A server test failed every night after 22:00 (night rules added frames); it now pins the hour.
- New tools: `tools/find-roku.ts` (finds the TV, prints `ROKU_HOST`), `tools/calibrate-offsets.ts` (per-listener
  `--offset` from a 1 m reading).
- The predictor now reads the household's clock like the risk rules (household timezone, and a mistyped
  `DEMO_HOUR` is ignored instead of silently stopping predictions).
- Retraining is ready for real data: `python ml/train.py` picks up `fixtures/rssi-samples.csv` as soon as it exists
  (checked on simulated data: kNN 91.0 percent against 75.8 percent for the strongest listener).

## Must do before the demo

| # | Item | Owner |
|---|---|---|
| 1 | Real BLE run: tag phone, 3 or more listeners, `/health` and `/debug/vector` change as the tag moves (Gate 2) | Saran |
| 2 | Collect real calibration data (`/dashboard/devices` > Calibration: 3 sessions per room plus the test route) | Saran |
| 3 | Retrain on it (`python ml/train.py`, `tools/vineet-replay.ts`, `ml/report.py`) and reload the model | Vineet |
| 4 | Run `tools/calibrate-offsets.ts` on the demo laptops and start each listener with its `--offset` | Saran |
| 5 | Pick the demo listener set. The home model has a `living-room` anchor from a two-laptop test that nothing else uses (it reads offline on the World view, and the model was trained with it); update anchors in the zone editor, then retrain | Saran, Nimai, Vineet |
| 6 | Align room ids: scanned rooms are `living` and `entry`, the home model says `tv-room` and `front-door`. The overview maps them now; rename in the data (via the Supabase MCP) or rescan with matching names | Nimai, Aarnav |
| 7 | `.env.local` has live Twilio keys and no `TWILIO_DRY_RUN`: a night-time test texts and calls real phones. Keep `TWILIO_DRY_RUN=1` except during the real demo | everyone |
| 8 | The TV redirect shows the message with no photo: no redirect photo has been uploaded and no scanned room has photos (`rooms.photo_paths` are empty). Upload one in Settings > Familiar voice and photo, and record the voice clips | Aarnav |
| 9 | Record the backup video of the full loop as soon as the real run works | Saran |

## Should do

- Settings looks editable but saves nothing (household name, patient, quiet hours), and the monitor uses its own
  copy of the household and zone rules in `monitor/actions/index.ts` instead of Supabase. The database and that
  copy agree today (h1, quiet 21:00 to 07:00, same four rules). Next: save Settings to Supabase, have the monitor
  load the household and `zone_rules` on start and on a reload call, and let Settings edit zone rules and the
  escalation profile (plan Part 6 step 8). Until then `DEMO_HOUR=3` is how an afternoon demo gets night rules.
  Aarnav.
- Roku status on the overview. Aarnav.
- `/analytics/summary` lives in memory and resets when the monitor restarts; persist outcomes (schema change through the Supabase MCP). Aarnav.
- Bathroom and front door are confused about 1 time in 4 on simulated data because neither has a listener of its
  own; weigh that when placing the real listeners (item 5). Vineet, Saran.

## Range meter (`listener/rssi_meter.py`, Saran)

The group saw poor near, mid and far readings. Causes found while reading the code (not changed):

1. The friend laptop re-sends its last tag reading every 0.2 s forever, even when no new advertisement arrives. The
   host never sees that side go stale, so a phone walking away from the friend's laptop keeps its old, close value.
   Send only new readings (with a timestamp) and stop after about 1.5 s of silence.
2. Each calibration point is one smoothed snapshot. A 4 dB blip at 3 ft or 30 ft moves the path-loss exponent by
   0.4, which shifts a mid-span estimate by roughly 25 to 30 percent. Take the median over 10 to 15 s per point, and
   consider a 15 ft point with a least-squares fit.
3. Distance error grows with distance (log-distance), so far readings are the noisiest; the position line
   (`30 * d_you / (d_you + d_friend)`) also assumes the laptops are exactly 30 ft apart with the phone on the line
   between them. Comparing the two calibrated RSSI values directly (equal means the middle) is steadier.
4. Before both points are set it uses -50 dBm at 3 ft and n = 2.8, so the feet shown are guesses; hide them until
   calibrated.

## Stretch (cut first, in the plan's order)

Splat and Marble previews (partly built), ask-your-home (`/ask`), inbound SMS acknowledge, weekly Claude summary,
contextual bandit, anomaly detection, fingerprint position regression and `ml/fit_pathloss.py`, Kasa breadcrumb
lighting, iPhone listener mode.

## Notes

- Database changes go through the Supabase MCP, not new files in `supabase/migrations/`.
- Never commit `.env.local`, keys or phone numbers.
