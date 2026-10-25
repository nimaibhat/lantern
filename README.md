# Lantern

Dementia home safety built on one scan of the real home. Built for Hack Ohio 2026.

A caregiver scans the home once with an iPhone. From that scan, Lantern builds a measured floor plan and a 3D
model. It audits the home for hazards and accessibility, and follows the person from room to room using a
Bluetooth tag. When something risky happens, such as leaving through the front door or going into the kitchen at
3 AM, Lantern responds in that room first, on a tablet or laptop screen, with a soft glow, a familiar photo and a
calm voice. It contacts the caregiver only if that does not work.

Lantern assists caregivers. It does not replace supervision and is not a medical device.

![Lantern architecture](docs/architecture.png)

## What it does

| Feature | How it works |
|---|---|
| Hazard audit | Claude looks at the room photos for fall risks, missing grab bars, medication or sharp objects left out, and similar, then merges the findings into a short list per room with a suggested fix and rough cost for each |
| Accessibility audit | Rules on the scan's measurements (door widths, walking paths, turning space, toilet and bed clearance), checked for how the person gets around (on their own, cane, walker or wheelchair) |
| Familiar routine | A Now and Next daily guide on the patient screen, built from photos of the person's own rooms |
| Home monitor | Laptops listen for the tag. The dot goes on the walking route between the nearest sensors, a door-graph HMM keeps the room steady, and a Markov predictor guesses the next room. Rules spot risky movement, the patient screen redirects, then the caregiver gets a push (ntfy), a text and a call (Twilio or Vapi) |

The caregiver dashboard sits on top of all four: the floor plan and live 3D view, the audit report, alerts,
analytics, devices and settings.

## How it fits together

The diagram above shows the whole system. Edit it by opening `docs/architecture.excalidraw` in Excalidraw, then
export it again as `docs/architecture.png`.

- **Web app** (`app/`, `lib/`): Next.js App Router, React, TypeScript, plain CSS. It handles the dashboard, the
  scan upload pipeline, the audits, the Tracking page and the patient screen.
- **Monitor** (`monitor/`): a Node service. It takes in listener readings, runs room inference, risk rules and the
  responder, and streams live state over WebSocket.
- **Listeners**: each room laptop reports the tag's signal strength. Most join from the dashboard's Tracking page
  (Chrome's Web Bluetooth, or a one-line terminal command it gives you), which saves readings to Supabase; the
  monitor relays them in (`monitor/sensing/relay.ts`). The Python scripts in `listener/` (bleak) report to the
  monitor directly.
- **iPhone app** (`ios/LanternScan`): SwiftUI. The Scan tab maps rooms with RoomPlan; the Tag tab broadcasts the
  Bluetooth signal.
- **ML** (`ml/`): Python training for the kNN room classifier and the next-room predictor. Inference runs in the
  monitor. A kNN model only fits the home it was trained on, so a newly scanned home uses the floor grid instead.

## Requirements

- Node 20 or newer, and npm
- A Supabase project (optional: without keys, the web app runs on demo data)
- Python 3, for the listeners and ML training
- For scanning: an iPhone 12 Pro or newer Pro model with LiDAR, and a Mac with Xcode

## Setup

```bash
npm install
cp .env.example .env.local     # fill in what you have; see Environment below
npm run check-env              # shows what is configured and what answers (never prints secrets)
```

Database changes live in `supabase/migrations/`, and demo data lives in `supabase/seed.sql` and `supabase/seed/`.

## Run it

Start the monitor and the web app in two terminals:

```bash
npm run dev:monitor     # monitor on http://localhost:8787
npm run dev             # web app on https://localhost:3000, reachable from other devices on the network
npm run dev:web         # or: plain http://localhost:3000, this machine only
```

Then open:

- `/dashboard`: your homes. Pick one for the overview, 3D view, audit, alerts and settings.
- `/dashboard/tracking`: pair each room laptop and see what every sensor hears.
- `/routine?room=<room id>`: the patient screen. Open it fullscreen on a tablet or laptop in that room and tap once
  to allow audio. It only plays when the person is in its room.
- `/dashboard/new`: add a home and pair the iPhone app.

`npm run dev` uses a self-signed certificate so other devices on the network can use the browser listener. The
browser warns about it the first time.

### Without hardware

```bash
npm run dev:mock-rssi   # fake listeners walk a tag through the rooms
npm run dev:mock-walk   # a pretend person walks the loaded home, heard at every placed sensor

# or move the person by hand
curl -X POST localhost:8787/sim/room -H "Content-Type: application/json" -d '{"roomId":"kitchen"}'
```

The Devices page in the dashboard has the same simulator buttons. To play the 3 AM story during the day, set
`DEMO_HOUR=3` on the monitor.

### With hardware

1. **Scan the home.** Build the iPhone app (see `ios/README.md`). Pair it with the code from Add a home or
   Settings, then name and scan each room, taking 2 to 4 photos per room, and tap Upload. The website builds the
   floor plan and runs the audits.
2. **Start a listener on each room laptop.** On the hub laptop (the one running the web app and the monitor), open
   `/dashboard/tracking`. On each room laptop, open the hub's Tracking page in Chrome and pair it, or run the
   terminal command it shows. Place each laptop in its room on that page. The alternative is the Python listener:
   `pip install -r listener/requirements.txt`, then `python listener/pair.py`.
3. **Start the tag.** Open the iPhone app's Tag tab and tap Start. Keep the screen on, with Guided Access on.
4. **Check the listeners.** Every laptop should show as online on the Tracking page, and the dot should move on
   the Overview.

See `docs/runbook.md` for the demo-day startup order and fixes for common problems.

## Environment

Copy `.env.example` to `.env.local`. Only the Supabase keys matter for most work; everything else turns on one
feature.

| Variable | For |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Database and storage |
| `ANTHROPIC_API_KEY` | Photo hazard check |
| `TWILIO_*`, `CAREGIVER_PHONE_NUMBER`, `BACKUP_PHONE_NUMBER` | Caregiver texts and calls |
| `TWILIO_DRY_RUN=1` | Logs messages instead of sending them. Keep it on except during the real demo |
| `NTFY_*` | Free push alerts to the caregiver's phone, with an Acknowledge button |
| `WORLD_LABS_API_KEY` | 3D photo previews per room (paid, started by hand from a room page) |
| `VAPI_*` | Voice agents (`docs/vapi.md`) |
| `ROKU_HOST` | Optional: wakes a Roku TV (`npx tsx tools/find-roku.ts`). The demo uses a tablet or laptop instead |
| `ESCALATION_PROFILE` | `demo` (short timers) or `real` |
| `ROOM_FROM=closest`, `NIGHT_ANY_ROOM=1` | Take the room from the laptop that hears the phone best, and remind at night in any room but bed and the bathroom |
| `NEXT_PUBLIC_MONITOR_URL`, `NEXT_PUBLIC_MONITOR_WS` | Where the dashboard reaches the monitor (default `localhost:8787`) |
| `LISTENER_TOKEN` | Shared secret between listeners and the monitor |

Server-only keys must never be used in client components or prefixed with `NEXT_PUBLIC_`. Never commit
`.env.local`.

## Development

```bash
npm run typecheck   # web and monitor
npm test            # node:test via tsx, lib/** and monitor/**
npm run build       # production build (stop npm run dev first, or .next gets corrupted)
```

To retrain the room classifier after collecting real readings, follow `ml/README.md`.

## Project layout

```
app/            routes: landing, dashboard pages, API routes, /routine (patient screen), /signs (door signs)
lib/            shared code: types, home model (lib/world), audits, cues, dashboard data
components/     3D scene and avatar
monitor/        Node service: sensing, inference, actions, world
listener/       Python BLE listeners for the room laptops
ios/            iPhone app (XcodeGen spec in ios/project.yml)
ml/             training scripts and saved models
supabase/       migrations and seed data
fixtures/       sample scans, readings and the demo home model
tools/          dev helpers (mock-rssi, mock-walk, check-env, calibrate-offsets, position-eval, position-lag)
docs/           runbook, status, cue wording, Vapi setup
```

## Docs

- `docs/status.md`: what works, what is left, and who owns it
- `docs/runbook.md`: demo-day startup order, and what to do when something breaks
- `docs/cues.md`: what Lantern says on the patient screen and in texts
- `PROJECT_PLAN.md`: scope, shared contracts, ownership and the demo script
- `AGENTS.md`: conventions for teammates and coding agents

## Hero video

The landing page loads `public/lantern-hero.mp4` (H.264, 1440 px) with `public/lantern-hero.jpg` as the poster.
The source export, `media/lantern-hero-source.mp4`, is kept out of git. To re-export it:

```bash
ffmpeg -y -i media/lantern-hero-source.mp4 -vf scale=1440:-2 -c:v libx264 -preset slow -crf 30 -pix_fmt yuv420p -movflags +faststart -an public/lantern-hero.mp4
ffmpeg -y -ss 0.5 -i public/lantern-hero.mp4 -frames:v 1 -vf scale=960:-2 -q:v 9 public/lantern-hero.jpg
```
