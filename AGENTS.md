# AGENTS.md

Instructions for coding agents (Claude Code, Codex, Cursor, etc.) working on Lantern.

## What Lantern is

Dementia home safety, built on one scan of the real home. One LiDAR scan (Apple RoomPlan) powers four things:

1. **Hazard audit**: Claude vision on room photos flags rugs, cords, clutter, stairs without rails.
2. **Accessibility audit**: rules on scan measurements (door widths, hallway widths, turning space) produce a report an occupational therapist can review.
3. **Familiar routine**: a step-by-step daily guide built from real photos of the patient's rooms.
4. **Home monitor**: BLE room location (ESP32s + beacon), risky-movement rules, a calm redirect (light + familiar voice), then caregiver escalation (Twilio).

A caregiver dashboard sits on top of all four. See `PROJECT_PLAN.md` for scope, timeline, and owners.

## Priorities

1. **Fast.** Fast to load, fast to build. No heavy libraries when a few lines of code will do.
2. **Simple and readable.** Prefer plain functions, small files, and obvious names. A teammate should understand any file in one read.
3. **The demo loop works end to end.** Scan → audit, and room tracking → redirect → alert, shown on the dashboard. Do not start stretch work while this loop is broken.

## Stack

- **Web**: Next.js (App Router) + TypeScript + React, plain CSS with custom properties. No Tailwind or UI kits unless the team agrees.
- **Data**: Supabase (Postgres, Storage, Realtime, Auth).
- **iOS**: SwiftUI + RoomPlan. Exports `CapturedRoom` JSON + USDZ and uploads to Supabase Storage.
- **Hardware**: ESP32s (Arduino) scanning a Blue Charm BC011 beacon, sending RSSI over MQTT or HTTP.
- **ML**: room classifier on RSSI vectors (kNN or random forest). Python is fine for training; keep inference simple.
- **AI**: Anthropic API (Claude vision for hazards). Use the latest Claude model.
- **Alerts**: Twilio SMS and voice.
- **Stretch**: World Labs Marble preview, Gaussian splats.

## Layout

```
app/                 Next.js routes (landing page at /, dashboard at /dashboard)
app/api/             server routes (scan upload, world model, tracking, sensors, live bridge, alerts)
app/dashboard/       one folder per page; shared shell, nav, overview and styles in _components/
app/routine/         the patient's TV: Now and Next, chime and calm voice, cues, Vapi companion
app/signs/           printable door signs from the scanned rooms
lib/types/           type contracts split by module (world, sensing, inference, actions, live, bus)
lib/cues/            what Lantern says: cue wording, family texts, Vapi agents, routine prompts (docs/cues.md)
lib/world/           home model: geometry, RoomPlan parser, builder, live state, useLive
lib/audit/           accessibility rules, mobility planner, fixes, vision hazards
lib/dashboard/       dashboard reads (data.ts), server actions, demo fallback data
lib/scan/            phone pairing and the World Labs preview
lib/sensing/         browser helpers for Devices and Tracking
lib/analytics/       analytics helpers
lib/supabase/        server-only Supabase client
components/world/    3D scene and avatar
ios/LanternScan/     SwiftUI phone app: Scan tab (RoomPlan) and Tag tab (BLE broadcaster)
ios/project.yml      XcodeGen spec (cd ios && xcodegen)
listener/            Python BLE listeners (bleak, runs on laptop receivers)
monitor/             Node service: HTTP + WS server, module host
monitor/world/       serves the newest home model, routes through doors
monitor/sensing/     listener ingest, Supabase relay (Tracking laptops on other hubs), RssiWindow, SensorFrame, simulator
monitor/inference/   room classifier, door-graph HMM, position, predictor
monitor/actions/     risk engine, responder (grace, repeating cues), Twilio, Vapi calls, time away, TV
tools/               dev helpers (mock-rssi, mock-walk, replay, check-env, find-roku, calibrate-offsets, position-eval, position-lag)
docs/                runbook, project status, spike notes, cues (cues.md), Vapi setup (vapi.md)
ml/                  RSSI training scripts and saved model
fixtures/            sample RoomPlan JSON, RSSI CSV, photos, home model
supabase/            migrations and seed
public/              static assets (hero video, poster)
```

Create folders as they are needed. Keep this section up to date.

## Shared contracts

All workstreams agree on the types in `lib/types/` (one file per module, re-exported from `lib/types/index.ts`). Change them only on purpose, and tell the team when you do. Build against fixtures until the real source is ready.

Units: RoomPlan reports meters. Convert to inches only at the edge (audit rules and UI).

## Commands

```bash
npm install
npm run dev            # http://localhost:3000 (Next.js)
npm run dev:monitor    # http://localhost:8787 (monitor service, tsx watch)
npm run dev:mock-rssi  # fake 4 listeners walking a tag through rooms
npm run dev:mock-walk  # a pretend person walking the loaded home, heard at every placed listener (live map, trail)
npm run build          # production build
npm run typecheck      # web and monitor (tsconfig.json + tsconfig.monitor.json)
npm test               # node:test via tsx: lib/** and monitor/**
npm run check-env      # what is configured and what answers (never prints secrets)
```

Never run `npm run build` while `npm run dev` is running in the same folder; it corrupts `.next`. If the dev server breaks or memory climbs, stop it and run `rm -rf .next && npm run dev`.

## Environment

Copy `.env.example` to `.env.local` and fill it in. Never commit `.env`, `.env.local`, or any key. Server-only secrets (`SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, Twilio) must never be used in client components or prefixed with `NEXT_PUBLIC_`.

## Parallel work (worktrees)

- One worktree per workstream: `claude -w scan`, `claude -w audits`, `claude -w monitor`, `claude -w dashboard`.
- Worktrees do not get `.env.local` or `node_modules`. Copy the env file and run `npm install` in each.
- Each dev server needs its own port: `npm run dev -- -p 3001`.
- Merge small and often. Pull `lib/types.ts` changes first.

## Code style

- TypeScript strict. Type data at the boundaries (API routes, Supabase rows, device payloads).
- Server components by default; add `"use client"` only when a component needs state, effects, or browser APIs.
- Comments explain why, not what. Keep them short.
- No em dashes or emojis in code comments, docs, or UI copy.
- Handle the demo's failure cases (no WebGL, no beacon signal, Twilio error) with a clear fallback rather than a crash.

## Commits

- Very short, human-sounding messages, e.g. `landing page`, `rssi ingest`, `ada door check`.
- No `Co-Authored-By` or other AI attribution trailers.
- Commit or push only when asked.

## Safety and privacy

This handles health-adjacent data about a vulnerable person. Keep photos and scans in private Supabase buckets, use row-level security, and never log phone numbers or keys. Lantern assists caregivers; do not write copy that claims it replaces supervision or is a medical device.
