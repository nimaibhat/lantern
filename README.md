# Lantern

Dementia home safety built on one scan of the real home. Built for Hack Ohio 2026.

A caregiver scans the home once with an iPhone. From that scan, Lantern builds a measured floor plan and a 3D
model. It audits the home for hazards and accessibility, and follows the person from room to room using a
Bluetooth tag. When something risky happens, such as leaving through the front door or going into the kitchen at
3 AM, Lantern responds on the TV first, with a soft glow, a familiar photo and a familiar voice. It contacts the
caregiver only if that does not work.

Lantern assists caregivers. It does not replace supervision and is not a medical device.

## What it does

| Feature | How it works |
|---|---|
| Hazard audit | Claude looks at the room photos for rugs, cords, clutter, missing grab bars and similar, then merges the findings into a short list per room |
| Accessibility audit | Rules on the scan's measurements (door widths, walking paths, turning space, toilet and bed clearance), checked for how the person gets around (on their own, cane, walker or wheelchair) |
| Familiar routine | A Now and Next daily guide on the TV, built from photos of the person's own rooms |
| Home monitor | Laptops listen for the tag, a classifier picks the room, rules spot risky movement, the TV redirects, then the caregiver gets a text and a call (Twilio) |

The caregiver dashboard sits on top of all four: the floor plan and live 3D view, the audit report, alerts,
analytics, devices and settings.

## How it fits together

```
iPhone (RoomPlan scan) --upload--> Next.js app --> Supabase (Postgres, Storage)
                                        |
Tag phone --BLE--> laptop listeners --> monitor (:8787) --> risk rules --> TV (/routine), Twilio
                                        |
                                 dashboard (/dashboard) <-- live WebSocket
```

- **Web app** (`app/`, `lib/`): Next.js App Router, React, TypeScript, plain CSS. It handles the dashboard, the
  scan upload pipeline, the audits and the patient's TV screen.
- **Monitor** (`monitor/`): a Node service. It takes in listener readings, runs room inference, risk rules and the
  responder, and streams live state over WebSocket.
- **Listeners** (`listener/`): Python scripts (bleak) on each room laptop that report the tag's signal strength.
- **iPhone app** (`ios/LanternScan`): SwiftUI. The Scan tab maps rooms with RoomPlan; the Tag tab broadcasts the
  Bluetooth signal.
- **ML** (`ml/`): Python training for the room classifier and next-room predictor. Inference runs in the monitor.

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
- `/routine`: the patient's TV screen. Open it fullscreen on the TV and tap once to allow audio.
- `/dashboard/new`: add a home and pair the iPhone app.

`npm run dev` uses a self-signed certificate so other devices on the network can use the browser listener. The
browser warns about it the first time.

### Without hardware

```bash
npm run dev:mock-rssi   # fake listeners walk a tag through the rooms

# or move the person by hand
curl -X POST localhost:8787/sim/room -H "Content-Type: application/json" -d '{"roomId":"kitchen"}'
```

The Devices page in the dashboard has the same simulator buttons. To play the 3 AM story during the day, set
`DEMO_HOUR=3` on the monitor.

### With hardware

1. **Scan the home.** Build the iPhone app (see `ios/README.md`). Pair it with the code from Add a home or
   Settings, then name and scan each room, taking 2 to 4 photos per room, and tap Upload. The website builds the
   floor plan and runs the audits.
2. **Start a listener on each room laptop.** Run `pip install -r listener/requirements.txt`, then
   `python listener/pair.py`. It asks for the room and the hub laptop's IP once, then starts scanning.
3. **Start the tag.** Open the iPhone app's Tag tab and tap Start. Keep the screen on, with Guided Access on.
4. **Check the listeners.** `curl localhost:8787/health` should list every listener as online.

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
| `WORLD_LABS_API_KEY` | 3D photo previews per room (paid, started by hand from a room page) |
| `VAPI_*` | Voice agents (`docs/vapi.md`) |
| `ROKU_HOST` | Wakes the TV (`npx tsx tools/find-roku.ts` finds it) |
| `ESCALATION_PROFILE` | `demo` (short timers) or `real` |
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
app/            routes: landing, dashboard pages, API routes, /routine (TV), /signs (door signs)
lib/            shared code: types, home model (lib/world), audits, cues, dashboard data
components/     3D scene and avatar
monitor/        Node service: sensing, inference, actions, world
listener/       Python BLE listeners for the room laptops
ios/            iPhone app (XcodeGen spec in ios/project.yml)
ml/             training scripts and saved models
supabase/       migrations and seed data
fixtures/       sample scans, readings and the demo home model
tools/          dev helpers (mock-rssi, check-env, find-roku, calibrate-offsets)
docs/           runbook, status, cue wording, Vapi setup
```

## Docs

- `docs/status.md`: what works, what is left, and who owns it
- `docs/runbook.md`: demo-day startup order, and what to do when something breaks
- `docs/cues.md`: what Lantern says on the TV and in texts
- `PROJECT_PLAN.md`: scope, shared contracts, ownership and the demo script
- `AGENTS.md`: conventions for teammates and coding agents

## Hero video

The landing page loads `public/lantern-hero.mp4` (H.264, 1440 px) with `public/lantern-hero.jpg` as the poster.
The source export, `media/lantern-hero-source.mp4`, is kept out of git. To re-export it:

```bash
ffmpeg -y -i media/lantern-hero-source.mp4 -vf scale=1440:-2 -c:v libx264 -preset slow -crf 30 -pix_fmt yuv420p -movflags +faststart -an public/lantern-hero.mp4
ffmpeg -y -ss 0.5 -i public/lantern-hero.mp4 -frames:v 1 -vf scale=960:-2 -q:v 9 public/lantern-hero.jpg
```
