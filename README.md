# Lantern

Dementia home safety built on one scan of the real home (Hack Ohio 2026). A tag is heard by room listeners,
Lantern works out where the person is, shows them moving through a 3D model of their home, responds first on the
TV (glow, familiar photo, familiar voice), and wakes the caregiver only when it matters. Lantern assists caregivers;
it does not replace supervision and is not a medical device.

## Run it

```bash
npm install
cp .env.example .env.local   # fill in; without keys the web app runs on demo data
npm run dev:monitor          # monitor service on :8787
npm run dev                  # web app on :3000 (dashboard at /dashboard)
npm run dev:mock-rssi        # optional: fake listeners walking a tag through the rooms
```

`npm run check-env` says what is configured and what answers. Keep `TWILIO_DRY_RUN=1` unless you mean to text
and call real phones. `DEMO_HOUR=3` plays the 3 AM story during the day.

## Docs

- `docs/status.md`: what works, what is left, and who owns it
- `docs/runbook.md`: demo-day startup order and "if X breaks, do Y"
- `PROJECT_PLAN.md`: scope, contracts, ownership and the demo script
- `AGENTS.md`: rules for coding agents and teammates

## Hero video

- `media/lantern-hero-source.mp4`: the original Shader Lab export (HEVC, 18 MB). Kept out of git.
- `public/lantern-hero.mp4`: the web version the page loads (H.264, 1440px, 3 MB).
- `public/lantern-hero.jpg`: the poster frame shown while the video loads.

To re-export after changing the source:

```bash
ffmpeg -y -i media/lantern-hero-source.mp4 -vf scale=1440:-2 -c:v libx264 -preset slow -crf 30 -pix_fmt yuv420p -movflags +faststart -an public/lantern-hero.mp4
ffmpeg -y -ss 0.5 -i public/lantern-hero.mp4 -frames:v 1 -vf scale=960:-2 -q:v 9 public/lantern-hero.jpg
```
