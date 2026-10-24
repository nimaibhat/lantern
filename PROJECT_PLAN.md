# Lantern: Project Plan (one file, four parts)

**Lantern**: dementia home safety built on one scan of the real home. An iPhone "tag" is heard by laptops, the system works out where the person is, shows them moving through a 3D model of the real home, responds first on a patient screen in the room (glow, familiar photo, familiar voice), and wakes the caregiver only when it matters.

**Changed 2026-10-24:** the Roku TV is dropped. The patient screen is the same `/routine` page, run fullscreen on a tablet or laptop in the room (with its own speaker) instead of being cast to a TV. Nothing else about the redirect changes.

This file replaces all earlier plan files. The landing page already exists; **nobody touches `app/page.tsx` or the landing assets**. The landing page's Enter button goes to `/dashboard`.

## How to use this file (people and AI agents)

1. Everyone reads **Parts 0 to 2** (shared: what we are building, contracts, repo rules, git, gates). They are short and they stop us from stepping on each other.
2. Then read **your own part only**: **Part 3 Saran, Part 4 Nimai, Part 5 Vineet, Part 6 Aarnav**. Each part is a complete plan: what you own, what you produce and consume, build order with "done when" tests, how to run your branch alone, a branch acceptance test, and a debugging roadmap.
3. To start an agent (Claude Code or Cursor), paste: *"Read LANTERN_PROJECT_PLAN.md Parts 0 to 2 and Part N. You are <name>. Start at step 1 of your build order. Do not edit files outside your ownership list. After each step run tests, commit as `<initial>: step N`, and tell me what you need from others."*
4. **Part 7** (demo script, Q&A, cut order, definition of done, system-level debug) is for the whole team at the end.

---

# PART 0. What we are building

## The four features and who owns them

| Person | Feature | In one line |
|---|---|---|
| **Saran** | Bluetooth and devices | Turn an iPhone into the tag, run the laptop listeners, get every RSSI reading into the system reliably, and own the monitor server, simulator, recorder and deployment |
| **Nimai** | World model (LiDAR) and 3D live view | Scan the home, build the shared-coordinate home model, show a 3D room where the person moves as a live coordinate, and run the accessibility audit |
| **Vineet** | ML and AI | Room classifier, door-graph HMM, position estimator, Markov destination predictor, Claude vision hazard audit, model metrics |
| **Aarnav** | Actions, messages and analytics | Rules, redirect on the patient screen, familiar voice, Twilio SMS and calls, the caregiver dashboard, analytics, and the core database |

## Pipeline in one picture

```
Tag iPhone (Saran)  ) ) )  BLE advert: service UUID + name "LanternTag"
        |
Listeners: laptops running bleak (Saran)           listener positions come from Nimai's HomeModel anchors
        | WebSocket {receiverId, tagId, rssi, ts}
        v
monitor/sensing (Saran)      RssiWindow -> SensorFrame every 1 s              bus: "frame"
        v
monitor/inference (Vineet)   kNN room posterior -> door-graph HMM -> room    bus: "location"
                             weighted-centroid position -> smoothing -> clamp  bus: "position" (about 5 Hz)
                             Markov predictor -> next room                    bus: "prediction"
        v
monitor/actions (Aarnav)     zone rules -> risk events -> responder           bus: "risk", "patient"
                             -> patient_state (patient screen), Twilio, analytics
        v
Supabase (events, state)  +  /ws/live (monitor broadcast of every frame, Saran)
        v
Web: /dashboard (Aarnav) | /dashboard/world 3D live view (Nimai) | /routine patient screen on a tablet or laptop (Aarnav)

monitor/world (Nimai) serves the HomeModel (rooms, doors, anchors) to everyone.
Simulator (Saran) emits the same "position" and "location" events with source = "sim".
```

## Honest limits (say these in the pitch)

- BLE gives reliable **room-level** location and a rough **in-room position** (about 2 to 3 m). The 3D avatar is an estimate that is smoothed and kept inside the room Lantern believes the person is in. We label it that way.
- An iPhone tag only advertises while the tag app is open in the foreground. The tag phone stands in for a wearable tag.
- RSSI data is real. Movement histories for the predictor are synthetic.
- Lantern reduces risk and caregiver load. It does not replace supervision. Evidence for redirects comes from small pilots; do not claim it is proven.
- Every simulated value shows SIMULATED in the UI and in the video.

## Device roster

| Device | Role | Who sets it up |
|---|---|---|
| LiDAR iPhone (Pro) | Runs `LanternScan` (scan app) | Nimai |
| Tag iPhone | Runs `LanternTag` (tag app), foreground, screen on, Auto-Lock off, Guided Access on | Saran |
| Caregiver iPhone | Receives SMS and calls, opens the dashboard | Aarnav |
| Demo laptop | Runs the monitor, one listener, the web app | Saran |
| 2 to 3 more laptops | One listener each (bedroom, hallway, kitchen/TV room) | Saran |
| Tablet or laptop in the bedroom or hallway | Patient screen: fullscreen `/routine` with sound (a listener laptop can double as it) | Aarnav |

If you have fewer than 4 laptops, run bedroom, hallway and kitchen listeners and treat the TV room as the same zone as the kitchen for the demo.

**Network:** use a phone hotspot or travel router for everything. Venue Wi-Fi often blocks device-to-device traffic, which breaks the listener WebSocket. Write the monitor laptop's IP on tape on the laptop.

---

# PART 1. Contracts everyone codes against

## 1.1 Conventions

- **Coordinates:** one shared floor frame for the whole home, in **inches**. `x` runs right, `y` runs down the plan (like a screen). In 3D, floor `(x, y)` maps to three.js `(x * 0.0254, 0, y * 0.0254)` meters with up as +Y.
- **Ids:** room ids, receiver ids and tag ids are **text slugs**: `bedroom`, `hallway`, `bathroom`, `kitchen`, `tv-room`, `front-door`. Listener `--id` equals the receiver slug. This keeps `curl -d '{"roomId":"kitchen"}'` readable.
- **Time:** `ts` in epoch milliseconds in code; ISO strings in database columns.
- **Single event entry:** every location source (BLE pipeline, simulator, replay) ends in the same bus events with a `source` of `"ble"` or `"sim"`. Nothing downstream cares where an event came from.

## 1.2 Type files (each owner owns one; the rest read only)

`lib/types/index.ts` re-exports all of them. A change to your file is announced in chat and merged to `main` quickly; consumers merge `main` into their branch.

```ts
// lib/types/world.ts  (Nimai)
export type Vec2 = { x: number; y: number };                 // inches, shared floor frame
export type RoomKind = "bedroom" | "bathroom" | "hallway" | "kitchen" | "living" | "tv-room" | "front-door" | "other";
export interface Segment { id: string; start: Vec2; end: Vec2; heightIn: number }
export interface RoomObject { id: string; category: string; center: Vec2; widthIn: number; depthIn: number; heightIn: number; rotationDeg: number }
export interface HomeRoom {
  id: string; name: string; kind: RoomKind;
  polygon: Vec2[];                         // floor outline, clockwise, in the shared frame
  centroid: Vec2; heightIn: number;
  walls?: Segment[];                       // optional; the viewer derives walls from the polygon if absent
  objects?: RoomObject[]; photoPaths?: string[];
  virtual?: boolean;                       // true for demo zones drawn over a larger scanned room
}
export interface HomeDoor { id: string; roomA: string; roomB: string; center: Vec2; widthIn: number; kind: "door" | "opening" }
export interface Anchor { receiverId: string; position: Vec2; heightIn: number }   // where each listener sits
export interface Hazard { id: string; roomId: string; position: Vec2; title: string; severity: Severity }
export type Severity = "high" | "medium" | "low";
export interface HomeModel {
  householdId: string; version: number; unit: "in";
  rooms: HomeRoom[]; doors: HomeDoor[]; anchors: Anchor[]; hazards: Hazard[];
  assets?: { usdzPath?: string; glbPath?: string; splatPath?: string };
}
export interface AuditItem {
  id: string; roomId: string; source: "ada-rule" | "vision"; code?: string;
  title: string; detail: string; fix: string; severity: Severity;
  measuredIn?: number; requiredIn?: number; photoPath?: string; location?: Vec2;
  status: "open" | "accepted" | "dismissed" | "fixed";
}
```

```ts
// lib/types/sensing.ts  (Saran)
export type LocationSource = "ble" | "sim";
export type ReceiverKind = "mac-bleak" | "iphone" | "replay";
export type ListenerMsg =
  | { type: "hello"; receiverId: string; kind: ReceiverKind }
  | { type: "rssi"; receiverId: string; tagId: string; rssi: number; ts: number }
  | { type: "hb"; receiverId: string; ts: number };
// One reading every second: median RSSI per receiver over the last 3 s, in a fixed order. -100 = no reading.
export interface SensorFrame { ts: number; order: string[]; rssi: number[]; online: Record<string, boolean> }
```

```ts
// lib/types/inference.ts  (Vineet)
export interface RoomPosterior { ts: number; posterior: Record<string, number> }          // before the HMM
export interface PositionEstimate {
  ts: number; x: number; y: number; roomId: string;                                       // x,y in inches, clamped inside roomId
  confidence: number; source: LocationSource; velocity?: Vec2;                             // inches per second
}
export interface LocationEvent {                                                           // emitted only when the room changes
  id: string; householdId: string; roomId: string; prevRoomId?: string;
  confidence: number; source: LocationSource; ts: string;
}
export interface Prediction { ts: number; fromRoomId: string; nextRoomId: string; probability: number }
export interface MetricsReport {
  accuracy: number; baselineAccuracy: number; perRoom: Record<string, number>;
  confusion: number[][]; labels: string[]; leadTimesS: number[]; falseRedirectsPerNight: number; latencyMs: number;
}
```

```ts
// lib/types/actions.ts  (Aarnav)
export type RiskKind = "exit-approach" | "night-wandering" | "kitchen-night" | "long-bathroom-stay" | "no-movement";
export type RiskTrigger = "detected" | "predicted";
export type RiskState = "detected" | "redirecting" | "escalated" | "resolved";
export interface RiskEvent {
  id: string; householdId: string; kind: RiskKind; roomId: string; trigger: RiskTrigger; state: RiskState;
  source: LocationSource; startedAt: string; resolvedAt?: string;
  predictedAt?: string; arrivedAt?: string; leadTimeS?: number;
}
export type PatientMode = "idle" | "glow" | "photo_voice" | "greeting" | "calm";
export interface PatientState { householdId: string; mode: PatientMode; message?: string; photoPath?: string; voicePath?: string; riskEventId?: string; updatedAt: string }
export interface Alert { id: string; riskEventId: string; channel: "sms" | "call"; to: string; status: "sent" | "delivered" | "acknowledged" | "failed"; ts: string }
export interface ZoneRule { id: string; householdId: string; roomKind: RoomKind; kind: RiskKind; startHour: number; endHour: number; action: "redirect" | "allow" | "greet" }
export interface RoutineStep { id: string; routineId: string; order: number; time: string; title: string; roomId?: string; photoPath?: string; voicePath?: string }
```

```ts
// lib/types/live.ts  (SHARED: all four sign off on changes)
// Everything the 3D view and dashboard need, pushed over WS /ws/live. Not stored per frame.
export type LiveFrame =
  | { t: "snapshot"; ts: number; home: HomeModel; room?: string; patient?: PatientMode; listeners: Record<string, boolean> }
  | { t: "position"; ts: number; x: number; y: number; roomId: string; confidence: number; source: LocationSource; velocity?: Vec2 }
  | { t: "location"; ts: number; roomId: string; prevRoomId?: string; source: LocationSource }
  | { t: "prediction"; ts: number; fromRoomId: string; nextRoomId: string; probability: number }
  | { t: "risk"; ts: number; riskEventId: string; kind: RiskKind; roomId: string; state: RiskState; trigger: RiskTrigger }
  | { t: "patient"; ts: number; mode: PatientMode }
  | { t: "listener"; ts: number; receiverId: string; online: boolean; rssi?: number };

// lib/types/bus.ts  (SHARED)
export interface BusEvents {
  frame: SensorFrame;            // Saran  -> Vineet
  position: PositionEstimate;    // Vineet (or Saran's sim) -> Nimai view, Aarnav, recorder
  location: LocationEvent;       // Vineet (or sim)         -> Aarnav, recorder
  prediction: Prediction;        // Vineet                  -> Aarnav, Nimai view
  risk: RiskEvent;               // Aarnav                  -> view, recorder
  patient: PatientState;         // Aarnav                  -> view, recorder
}
```

## 1.3 Monitor module contract

The monitor is one Node process with four modules. Saran writes the host (`monitor/server.ts`, `bus.ts`, `store.ts`, `config.ts`, `log.ts`, `modules.ts`). Each owner implements `register()` in their own folder only.

```ts
// monitor/module.ts  (Saran)
export interface ModuleCtx {
  http: { get(p: string, h: Handler): void; post(p: string, h: Handler): void };
  bus: Bus; store: Store; cfg: Config; log: Logger;
  world(): HomeModel;                  // current home model, provided by Nimai's module
}
export interface MonitorModule { name: string; register(ctx: ModuleCtx): void | Promise<void> }

// monitor/modules.ts (all four lines exist from the scaffold, each pointing at a stub)
export default [world, sensing, inference, actions];    // registered in this order
```

## 1.4 HTTP and WebSocket surface (port 8787, owned per row)

| Path | Owner | Purpose |
|---|---|---|
| `WS /ws/listener?token=` | Saran | Listener ingest (`ListenerMsg`) |
| `WS /ws/live` | Saran | Broadcast of `LiveFrame` to the web app; sends a `snapshot` on connect |
| `GET /health` | Saran | Uptime, connected listeners, tag last seen |
| `GET /debug/vector` | Saran | Latest `SensorFrame` |
| `POST /debug/emit {event, payload}` | Saran | Emit **any** bus event for testing (this is how Aarnav and Nimai test without Bluetooth) |
| `POST /sim/room {roomId}` | Saran | Pretend the person walked to the room's centroid (emits `position` + `location`, `source: "sim"`) |
| `POST /sim/position {x, y}` | Saran | Pretend the person is at that coordinate |
| `POST /calibrate/start {roomId, x?, y?}` and `/calibrate/stop` | Saran | Record labeled RSSI into `rssi_samples` |
| `POST /record/start`, `/record/stop` | Saran | Record every bus event and frame to a session file |
| `POST /replay/start {session, speed, mode}` | Saran | `mode = "live"` replays `LiveFrame`s to the web; `mode = "raw"` replays `SensorFrame`s through inference |
| `POST /world/reload`, `GET /world/route?from=&to=`, `GET /debug/world` | Nimai | Reload the home model, route through doors, summary |
| `POST /model/reload`, `GET /debug/inference` | Vineet | Reload models; posterior, HMM belief, raw vs smoothed position |
| `POST /ask {question}` | Vineet (stretch) | Claude answers questions over the event tables |
| `GET /debug/state`, `POST /debug/force-risk {kind, roomId}`, `POST /debug/patient {mode,...}`, `POST /ack/:alertId`, `GET /analytics/summary` | Aarnav | Risk, patient and escalation state; test hooks; acknowledgement; analytics |

CORS: allow the web origin. The browser cannot reach `localhost` on another machine; run the web app on the demo laptop (or tunnel the monitor over https) so there is no mixed content.

## 1.5 Shared data formats

**Home model fixture (`fixtures/home-model.json`, Nimai writes it in the first hour).** The demo home used by everyone until the real scan lands. Rectangular rooms in inches:

```
bedroom (0,0)-(144,144)      hallway (144,0)-(216,288)     kitchen  (216,0)-(384,144)
bathroom (0,144)-(144,288)                                 tv-room  (216,144)-(384,288)
front-door (144,288)-(216,336)
doors:  bedroom|hallway at (144,72)   bathroom|hallway at (144,216)   kitchen|hallway at (216,72)
        tv-room|hallway at (216,216)  hallway|front-door at (180,288)         (all about 32 to 36 in wide)
anchors (listeners): bedroom (72,72)  hallway (180,144)  kitchen (300,72)  tv-room (300,216)   height 36 in
```

Write it as valid `HomeModel` JSON with `polygon` and `centroid` for each room. Real scans or the zone editor replace it later (same shape).

**RSSI dataset (`fixtures/rssi-samples.csv`, Saran produces, Vineet consumes).** Wide format, one row per second per session:

```
session,ts,roomId,x,y,bedroom,hallway,kitchen,tv-room
s1,1730000000000,kitchen,,,-78,-66,-52,-80
```

`x`,`y` are empty unless the sample was collected at a marked floor point. Receiver columns use receiver slugs; missing reading = -100. Vineet's `fixtures/rssi-samples.fake.csv` has the same columns and is used until real data exists.

**Session files (`sessions/<id>.jsonl`).** One JSON object per line: `{ "k": "frame" | "position" | "location" | "prediction" | "risk" | "patient", "ts": number, "d": <payload> }`. Written by Saran's recorder; read by replay, metrics and analytics.

## 1.6 Environment (`.env.example`; Aarnav keeps it current)

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
ANTHROPIC_API_KEY=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM=
TWILIO_DRY_RUN=1                              # 1 = log SMS and calls instead of sending
PUBLIC_BASE_URL=http://localhost:3000          # used in SMS acknowledge links
HOUSEHOLD_ID=                                  # fixed demo household uuid from the seed
MONITOR_PORT=8787
NEXT_PUBLIC_MONITOR_URL=http://localhost:8787
NEXT_PUBLIC_MONITOR_WS=ws://localhost:8787/ws/live
LISTENER_TOKEN=change-me
TAG_SERVICE_UUID=4C414E54-4552-4E00-A000-000000000001
ESCALATION_PROFILE=demo                        # demo | real
NEXT_PUBLIC_MOCK=0                             # 1 = web runs on fixtures and a scripted walk, no backend
```

---

# PART 2. Repo, ownership, git

## 2.1 Layout and who owns what

```
app/page.tsx                       EXISTING landing page. Do not touch.
app/dashboard/layout.tsx, _components/**   Aarnav (shell, nav.config.ts, overview, floor plan, live hook, dashboard.css)
app/dashboard/page.tsx, alerts/, analytics/, routine/, settings/      Aarnav
app/dashboard/devices/**           Saran   (listeners, calibration, sim buttons, recording)
app/dashboard/world/**             Nimai   (3D live view, replay, zone editor)
app/dashboard/audit/**             Nimai   (accessibility + hazard report)
app/dashboard/models/**            Vineet  (model metrics)
app/routine/**                     Aarnav  (patient screen on a tablet or laptop in the room)
app/api/scans/**, app/api/world/** Nimai
app/api/alerts/**, app/api/patient/**, app/api/twilio/**   Aarnav
app/api/ask/**                     Vineet (stretch)
components/<owner>/**              each owner uses their own folder (components/saran, vineet, aarnav; Nimai uses components/world)
lib/types/world.ts, lib/world/**   Nimai   (geometry helpers shared with the monitor)
lib/types/sensing.ts               Saran
lib/types/inference.ts             Vineet
lib/types/actions.ts               Aarnav
lib/types/live.ts, bus.ts          shared (all four sign off)
lib/audit/ada.ts, mobility.ts, fixes.ts       Nimai
lib/audit/vision.ts                Vineet
lib/supabase/**, lib/env.ts        Aarnav
lib/dashboard/**                   Aarnav  (dashboard reads, server actions, demo fallback data)
lib/scan/**                        Nimai   (phone pairing, World Labs preview)
lib/sensing/**                     Saran   (browser-side helpers for the Devices and Tracking pages)
monitor/server.ts, bus.ts, store.ts, config.ts, log.ts, modules.ts, module.ts    Saran
monitor/sensing/**                 Saran
monitor/world/**                   Nimai
monitor/inference/**               Vineet
monitor/actions/**                 Aarnav
ios/LanternTag/**                  Saran   (separate Xcode project)
ios/LanternScan/**                 Nimai   (separate Xcode project)
listener/**                        Saran
ml/**                              Vineet
tools/**                           Saran (shared scripts), tools/<owner>-*.ts for your own
supabase/migrations/0005_core.sql  Aarnav
supabase/migrations/0006_sensing.sql   Saran
supabase/migrations/0007_world.sql     Nimai
supabase/migrations/0008_ml.sql        Vineet
supabase/seed/<owner>.ts           each owner seeds their own tables; `npm run seed` runs all
fixtures/home-model.json, captured-*.json, photos/**     Nimai
fixtures/rssi-samples.csv, sessions/**                   Saran
fixtures/rssi-samples.fake.csv, walks.json               Vineet
.github/**, CODEOWNERS, AGENTS.md                        Saran
```

Rules:

- Edit only what you own. Need a change in someone else's area? Ask in chat, or write it under "Requests for others" at the end of your part and tell them.
- Separate migration files per owner mean no merge fights on the database. `0001` to `0004` are the shared baseline already applied to the live project; never edit them. Owner files start at `0005`. Add to your own file only.
- Shared files (`live.ts`, `bus.ts`, `package.json`, lockfile) are changed in small PRs that all four have seen.

## 2.2 Git

- Branches: `feat/saran-bluetooth`, `feat/nimai-world`, `feat/vineet-ml`, `feat/aarnav-actions`. `main` is always working.
- Merge `main` into your branch at least twice a day. Commit small: `s: step 4 window`, `n: step 7 avatar`, `v: step 5 hmm`, `a: step 6 responder`.
- **Every branch runs alone** with fixtures, the scripted walk, `/debug/emit` and `/sim/*`. A branch is ready only when it passes its own acceptance test in its part.
- At each gate Saran creates `integration/gate-N`, merges the four branches in the order **Aarnav (core DB) > Nimai (world) > Saran (sensing) > Vineet (inference)**, runs the gate test, and fast-forwards `main` only if it passes. After Gate 3 `main` already holds everything, so the final push is a clean fast-forward.

## 2.3 First-hour foundation (do these first; everyone is waiting)

| Who | Foundation task | Done when |
|---|---|---|
| Saran | Monitor skeleton: `server.ts`, `bus.ts`, `module.ts`, `modules.ts` with four stub modules, `/health`, `/debug/emit`, `/ws/live`, in-memory `store.ts`; `lib/types/` files created and re-exported; CI (`typecheck`, `test`); `CODEOWNERS`, `AGENTS.md`; branches created | `npm run dev:monitor` starts; `curl /debug/emit` shows up on `/ws/live` |
| Aarnav | Supabase project, `0005_core.sql`, RLS, Realtime, seed (household with a fixed id, contacts, zone rules); `lib/env.ts`, `.env.example`; dashboard `layout.tsx` + `nav.config.ts` with a stub page for every route | The dashboard loads with empty pages; keys shared privately |
| Nimai | `fixtures/home-model.json` (section 1.5) and `lib/types/world.ts`; `lib/world/geometry.ts` with `roomAt`, `clampToRoom`, `routeBetween`, `adjacency`; `monitor/world` serving the model | `GET /debug/world` returns the demo home; route test passes |
| Vineet | `lib/types/inference.ts`, `ml/make_fake_rssi.py` (path-loss simulation from the anchors in the home model), `fixtures/rssi-samples.fake.csv`, `fixtures/walks.json`, stub `monitor/inference` | Fake CSV exists and trains a kNN that beats chance |

## 2.4 Phases and gates

Percentages are of the time remaining before submission. Replace them with clock times once the hackathon start and end are known.

| Phase | Time | Focus |
|---|---|---|
| 0 Spike and foundation | 0 to 10% | Part 2.3 plus the Bluetooth spike in Part 3 step 1 |
| **Gate 1** | 10% | Spike passes (tag seen by a laptop, WebSocket to the monitor, patient screen plays sound, SMS sent, scan app builds). Foundation on `main` |
| 1 Core loop | 10 to 40% | Tag > listeners > room > patient-screen glow + voice > SMS. The 3D avatar moves from `/sim` and from real positions |
| **Gate 2** | 40% | Full loop runs (even if simulated); record a backup video of it; merge to `main` |
| 2 Depth | 40 to 70% | HMM, position, predictor, lead time, TV-room greeting, audit, analytics, replay, vision hazards |
| **Gate 3** | 70% | Feature freeze: everything Must and Should demoed to the team; Stretch cut if unfinished |
| 3 Polish | 70 to 85% | Bugs only, demo data, copy |
| **Gate 4** | 85% | The 3-minute demo runs clean twice in a row |
| 4 Video | 85 to 100% | Shoot, edit, rehearse Q&A, submit |

### Gate tests (run on `integration/gate-N` with real devices)

- **Gate 1:** `npm ci && npm run typecheck && npm test` pass on `main`; spike table (Part 3 step 1) passes or a fallback is chosen; seed loads; `/dashboard` and `/dashboard/world` open with fixtures.
- **Gate 2:**
  1. Start monitor, web, 3 to 4 listeners, `/routine` on the patient screen, tag phone advertising.
  2. Set quiet hours to include now. Walk the tag bedroom > hallway > kitchen.
  3. The 3D avatar follows within about 5 s; the patient screen glows, then shows the bedroom photo with the family voice. Walk back to the bedroom: no SMS.
  4. Repeat and stay in the kitchen: SMS, then the call.
  5. Turn off Bluetooth and repeat with `/dashboard/devices` sim buttons (or dragging the avatar).
- **Gate 3:** Gate 2 plus: HMM on (no impossible jumps in the log), predicted kitchen shown in the hallway with lead time recorded, TV-room greeting, real scan's audit report, metrics page showing baseline vs model, analytics page with a night summary, a recorded night replayed in 3D.
- **Gate 4:** the full demo script (Part 7) twice with no manual fixes.

## 2.5 Fakes to use until the real piece lands

| Need | Use |
|---|---|
| Home model | `fixtures/home-model.json` |
| RSSI | `fixtures/rssi-samples.fake.csv` + `npm run dev:mock-rssi` |
| Positions and room changes | `POST /sim/position`, `POST /sim/room`, or the scripted walk in `NEXT_PUBLIC_MOCK=1` |
| Any bus event | `POST /debug/emit` |
| Risk and patient screen | `POST /debug/force-risk`, `POST /debug/patient`, a browser tab on `/routine?preview=1` |
| Twilio | `TWILIO_DRY_RUN=1` (texts and calls are logged) |

---

# PART 3. SARAN: Bluetooth, devices and platform

Branch `feat/saran-bluetooth`. Commit prefix `s:`.

## Mission

Make the physical signal path rock solid: an iPhone advertises, laptops hear it, RSSI reaches the monitor every second, and anyone can test the system without Bluetooth through the simulator. Own the monitor host, the recorder and replayer, calibration, data collection, CI and the demo-day device runbook.

## You own

`ios/LanternTag/**`, `listener/**`, `monitor/server.ts bus.ts store.ts config.ts log.ts module.ts modules.ts`, `monitor/sensing/**`, `lib/types/sensing.ts`, `app/dashboard/devices/**`, `components/saran/**`, `supabase/migrations/0006_sensing.sql`, `supabase/seed/saran.ts`, `tools/**`, `fixtures/rssi-samples.csv`, `fixtures/sessions/**`, `.github/**`, `CODEOWNERS`, `AGENTS.md`.

## You produce and consume

| Produce | Who uses it |
|---|---|
| `bus` `frame` events (1 per second) | Vineet |
| `/ws/live`, `/debug/emit`, `/sim/*`, `/record/*`, `/replay/*` | Nimai, Aarnav (all testing and the 3D view) |
| `fixtures/rssi-samples.csv`, `fixtures/sessions/*.jsonl` | Vineet (training), Aarnav (analytics) |
| Running tag app and listeners | everyone at gates |
| **Consume** | From |
| `HomeModel.anchors`, `roomAt()` | Nimai (for sim position to room) |

## Build order

### Step 1. Foundation and the Bluetooth spike (Phase 0, Gate 1)

Do the foundation row in 2.3 first (about 45 min), then the spike below with the team. Write results in `docs/spike-results.md`.

| # | Test | Pass looks like | Fallback |
|---|---|---|---|
| 1 | Tag phone advertises `LanternTag` + service UUID. Try nRF Connect and LightBlue (LightBlue's "virtual peripheral" can create a custom service; I could not confirm nRF Connect has an iOS advertiser) | A second phone's scanner lists it | Build `LanternTag` (step 2) |
| 2 | `python listener/scan_test.py` on a Mac | Prints `LanternTag rssi=-55` several times a second | Other laptop; check Bluetooth permission |
| 3 | Walk the tag away from the laptop | RSSI drops 10+ dB | Remove body blocking, fix hand position |
| 4 | Listener posts to `tools/ws-echo.ts` | Echo prints JSON | Use the hotspot |
| 5 | Patient screen: open `/routine?h=<id>` on the tablet or laptop and tap once (Aarnav owns the screen; you only verify the network) | The page loads and the monitor socket connects | Same network; use the hotspot |
| 6 | Supabase insert from the monitor | Row visible | Check keys |

### Step 2. Tag app `ios/LanternTag` (Phase 0)

What iOS allows: only a **local name and service UUIDs** can be advertised. No custom manufacturer data, no raw packets. True iBeacon needs CoreLocation and the foreground. We do not need a true beacon: listeners filter by our service UUID. When the app is backgrounded iOS removes the name and hides the UUID in an "overflow area" that Macs cannot see, so **the tag app must stay open**.

- New SwiftUI app, iOS 17, Info.plist `NSBluetoothAlwaysUsageDescription`
- `TagBroadcaster.swift`:

```swift
import CoreBluetooth
import UIKit

final class TagBroadcaster: NSObject, ObservableObject, CBPeripheralManagerDelegate {
    static let serviceUUID = CBUUID(string: "4C414E54-4552-4E00-A000-000000000001")
    @Published var status = "idle"
    @Published var isAdvertising = false
    private var manager: CBPeripheralManager?

    func start() {
        UIApplication.shared.isIdleTimerDisabled = true      // screen stays on
        manager = CBPeripheralManager(delegate: self, queue: nil)
    }
    func stop() {
        manager?.stopAdvertising(); isAdvertising = false
        UIApplication.shared.isIdleTimerDisabled = false
    }
    func peripheralManagerDidUpdateState(_ p: CBPeripheralManager) {
        status = "bluetooth state \(p.state.rawValue)"       // 5 = poweredOn
        guard p.state == .poweredOn else { return }
        p.startAdvertising([CBAdvertisementDataServiceUUIDsKey: [Self.serviceUUID],
                            CBAdvertisementDataLocalNameKey: "LanternTag"])
    }
    func peripheralManagerDidStartAdvertising(_ p: CBPeripheralManager, error: Error?) {
        isAdvertising = (error == nil)
        status = error.map { "error: \($0.localizedDescription)" } ?? "advertising"
    }
}
```

- `TagView`: giant status (Advertising / Stopped / Bluetooth off), seconds-advertising counter, UUID in small text, big Start/Stop button, banner "Keep this screen open. Do not switch apps." When `scenePhase` leaves `.active`, post a local notification "Lantern tag paused"
- Turn on Guided Access (Settings > Accessibility > Guided Access)
- Do **not** add the `bluetooth-peripheral` background mode as a fix: it keeps advertising but without the name and with the UUID in the overflow area, which Mac scanners cannot read
- Done when: LightBlue on another phone and `scan_test.py` both see `LanternTag`, and the status line is correct when Bluetooth is turned off

### Step 3. Listeners `listener/` (Phase 1)

A listener filters advertisements to our service UUID and forwards RSSI. macOS identifies peripherals by a device UUID rather than a MAC, so we filter by service UUID.

- `listener/requirements.txt`: `bleak`, `websockets`
- `listener/scan_test.py`: print every sighting (`--all` prints everything for debugging)
- `listener/listener.py`:

```python
import argparse, asyncio, json, time
from bleak import BleakScanner
import websockets

SERVICE_UUID = "4c414e54-4552-4e00-a000-000000000001"

async def run(a):
    q: asyncio.Queue = asyncio.Queue(maxsize=500)
    last = 0.0
    def on_detect(device, adv):
        nonlocal last
        now = time.time()
        if now - last < a.min_interval: return           # cap the rate (0.2 s = 5 Hz)
        last = now
        try: q.put_nowait({"type": "rssi", "receiverId": a.id, "tagId": a.tag,
                           "rssi": adv.rssi + a.offset, "ts": int(now * 1000)})
        except asyncio.QueueFull: pass
    async with BleakScanner(on_detect, service_uuids=[SERVICE_UUID]):
        while True:
            try:
                async with websockets.connect(f"{a.url}?token={a.token}") as ws:
                    await ws.send(json.dumps({"type": "hello", "receiverId": a.id, "kind": "mac-bleak"}))
                    async def hb():
                        while True:
                            await asyncio.sleep(5)
                            await ws.send(json.dumps({"type": "hb", "receiverId": a.id, "ts": int(time.time() * 1000)}))
                    t = asyncio.create_task(hb())
                    try:
                        while True: await ws.send(json.dumps(await q.get()))
                    finally: t.cancel()
            except Exception as e:
                print("ws error, retrying in 2 s:", e); await asyncio.sleep(2)

if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--id", required=True)                # receiver slug: bedroom, hallway, kitchen, tv-room
    p.add_argument("--tag", default="tag-1")
    p.add_argument("--url", default="ws://localhost:8787/ws/listener")
    p.add_argument("--token", default="change-me")
    p.add_argument("--offset", type=int, default=0)       # per-listener calibration in dB
    p.add_argument("--min-interval", type=float, default=0.2)
    asyncio.run(run(p.parse_args()))
```

- Placement: one per zone, 3 to 5 m apart, about 1 m high, lid open and plugged in, not in a bag or on metal. In a small demo space add foam board or a partition between zones. **Put the listener exactly at the anchor position in Nimai's home model**, or tell Nimai where it really is so the model matches
- `tools/calibrate-offsets.py`: tag phone 1 m from each listener for 30 s in the same hand position; record the median RSSI; print each `--offset` that aligns them; save to `receivers.offset_db`
- Done when: all listeners show in `/health`, and `/debug/vector` changes as you walk

### Step 4. Monitor sensing module (Phase 1)

- `monitor/sensing/ingest.ts`: validate `ListenerMsg` with zod, reject a bad token (close code 1008), drop readings older than 5 s or from unknown receivers (log once), update `receivers.last_seen` on heartbeat, mark a listener offline after 15 s (emit a `listener` live frame)
- `monitor/sensing/window.ts`:

```ts
export class RssiWindow {
  private buf = new Map<string, { rssi: number; ts: number }[]>();
  constructor(private order: string[], private spanMs = 3000, private minSamples = 2) {}
  push(r: { receiverId: string; rssi: number; ts: number }) {
    const a = this.buf.get(r.receiverId) ?? []; a.push({ rssi: r.rssi, ts: r.ts }); this.buf.set(r.receiverId, a);
  }
  vector(now: number): number[] {
    return this.order.map(id => {
      const a = (this.buf.get(id) ?? []).filter(x => now - x.ts <= this.spanMs);
      this.buf.set(id, a);
      if (a.length < this.minSamples) return -100;
      const s = a.map(x => x.rssi).sort((p, q) => p - q), m = Math.floor(s.length / 2);
      return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    });
  }
}
```

- Every 1000 ms emit `bus.emit("frame", { ts, order, rssi, online })`. Receiver order = sorted receiver ids from the home model anchors
- Tag offline: no readings from any listener for 60 s emits a `listener`-style status and an event Aarnav can show
- Done when: unit tests pass (median, -100 rule, 3 s expiry), and `dev:mock-rssi` shows live frames

### Step 5. `/ws/live`, simulator, debug emit (Phase 0 to 1; **before Gate 1**)

- `/ws/live`: on connect send a `snapshot` (home model, current room, patient mode, listener states). Forward `position` (cap at 5 Hz), `location`, `prediction`, `risk`, `patient`, `listener` as `LiveFrame`s
- `POST /debug/emit {event, payload}` calls `bus.emit(event, payload)` (dev only; guard with `NODE_ENV !== "production"` or an env flag)
- Simulator: `POST /sim/position {x, y}` emits `position` with `source: "sim"` and, when `world().roomAt(x, y)` differs from the last room, a `location`. `POST /sim/room {roomId}` does the same at that room's centroid. When a sim event arrives, **suppress `ble` position and location events for 10 s** so the two sources do not fight
- Done when: Nimai's 3D view and Aarnav's responder both react to `/sim/*` with no Bluetooth

### Step 6. Calibration and data collection (Phase 1 to 2; Vineet is waiting)

- `POST /calibrate/start {roomId, x?, y?}` writes the window vector each second into `rssi_samples` (`session`, `ts`, room, optional coordinates, per-receiver RSSI). `/calibrate/stop` ends the session. `app/dashboard/devices` has buttons and live sample counts
- Collection protocol:
  1. Tag phone in the same hand and case as the demo, screen on
  2. For each room walk slowly inside it for 2 minutes, including near doors and corners
  3. **3 separate sessions per room** at different times so training and testing never share a session
  4. 1 held-out "test route" session: bedroom > hallway > kitchen > hallway > bedroom, with room labels from a stopwatch
  5. Optional (position fingerprints): stand on 8 to 12 tape marks (known coordinates from Nimai's plan) for 20 s each with `x,y` set
  6. Export to `fixtures/rssi-samples.csv` (format in 1.5) and tell Vineet how many windows per room (aim for at least 100 per room)
- Done when: the CSV is committed and Vineet can train on it

### Step 7. Recorder and replayer (Phase 2)

- `/record/start` and `/record/stop` write every bus event to `fixtures/sessions/<id>.jsonl` (format in 1.5)
- `/replay/start {session, speed, mode}`: `mode = "live"` pushes the recorded `LiveFrame`s to `/ws/live` (drives Nimai's 3D replay and the dashboard); `mode = "raw"` re-emits `frame` events so Vineet can rerun inference on real nights; a `source: "replay"` marker is shown in the UI
- Record the first successful full loop as soon as Gate 2 works: it is the insurance video and the retake source
- Done when: a recorded walk replays in `/dashboard/world` with the same motion

### Step 8. CI, deployment, runbook (Phase 2 to 3)

- GitHub Actions: install, `typecheck`, `test` on every push and PR; protect `main` after Gate 1
- `tools/check-env.ts`: prints missing env vars and whether Supabase, the monitor and Twilio (dry run) answer
- `docs/runbook.md`: startup order and the one-page "if X breaks, do Y" table. **Startup order:** (1) hotspot on, (2) `npm run dev:monitor`, (3) `npm run dev:web` (or the Vercel URL), (4) listeners on every laptop, (5) `/routine?h=<id>` fullscreen on the patient-screen tablet or laptop, tap once for audio, (6) tag phone: open `LanternTag`, tap Start, Guided Access on
- If the web app is on Vercel (https) and the monitor on a laptop (http), browsers block it. Run the web app on the laptop for the demo, or tunnel the monitor over https

### Step 9. Demo-day device checklist (Phase 3)

- [ ] Laptops charged, plugged in, lids open, sleep disabled (`caffeinate -dims`), Bluetooth on
- [ ] Hotspot on; every device on it; monitor IP on tape
- [ ] Tag phone charged, screen on, Auto-Lock off, app foreground, Guided Access on, in the trained hand position
- [ ] All listeners in `/health`; offsets applied
- [ ] `/routine` fullscreen on the patient screen; audio tapped; volume set; auto-lock off
- [ ] `ESCALATION_PROFILE=demo`; quiet hours include now
- [ ] Sim buttons open in a spare tab; a recorded run saved locally

### Step 10. Stretch

- iPhone listener mode in `LanternTag` (`CBCentralManager`, service filter, `AllowDuplicatesKey`, post to the WebSocket; foreground only)
- Tag phone sensors: `CMMotionActivityManager` and barometer uploads (got out of bed, stairs)
- Synthetic-RSSI simulator (`/sim/position` generates RSSI from the path-loss model so the whole ML pipeline runs on simulated data)
- Kasa smart bulb (`python-kasa`) as a second light output

## Branch acceptance test

1. `npm run typecheck && npm test` pass
2. `npm run dev:monitor`: `curl localhost:8787/health` answers; `POST /debug/emit` shows on `/ws/live`
3. Tag visible to `scan_test.py`; at least two listeners connect and `GET /debug/vector` shows different values as the tag moves
4. `POST /sim/position` and `/sim/room` produce `position` and `location` live frames
5. Record 60 s, replay it in `live` mode

## Debugging roadmap (Bluetooth, network, monitor host)

| Symptom | Likely cause | Check | Fix |
|---|---|---|---|
| `scan_test.py` prints nothing | Terminal lacks Bluetooth permission | System Settings > Privacy & Security > Bluetooth | Allow the terminal, restart it |
| Prints nothing but LightBlue sees the tag | UUID mismatch or app backgrounded | `scan_test.py --all`, look for `LanternTag` | Same UUID everywhere; keep the app foreground, screen on |
| Tag visible for seconds then gone | Phone locked or Auto-Lock | Phone | Auto-Lock off, Guided Access |
| Status `bluetooth state 3` or `4` | Permission denied or Bluetooth off | Settings > Lantern > Bluetooth | Allow, toggle Bluetooth |
| RSSI updates only every 1 to 2 s | macOS coalescing or low-power advertising | Count lines per second | Normal on some Macs; use the 3 s window; try another laptop |
| `bleak` import error | Python or PyObjC mismatch | `pip install -U bleak` in a fresh venv | Python 3.11+ |
| Windows laptop sees nothing | Adapter lacks LE scanning | Device manager | Use a different laptop |
| 8 to 15 dB difference between laptops at the same distance | Different antennas | Calibration | Apply `--offset` |
| RSSI barely changes between rooms | Zones too close, no walls | Walk and watch | Move listeners apart, add foam board |
| RSSI changes when you hold the phone differently | Body blocking | Same test | Fixed hand position |
| Listener runs 10 min then stops | Laptop sleeps | Power settings | Plug in, `caffeinate -dims` |
| Listener cannot connect | Wrong IP, firewall, venue Wi-Fi isolation | `curl http://<ip>:8787/health` from the listener laptop | Use the hotspot; allow the port |
| WebSocket closes at once (1008) | Token mismatch | Monitor log | Same `LISTENER_TOKEN` |
| IP changes between runs | DHCP | `ifconfig` | Re-read the IP; tape |
| `/debug/vector` all -100 | Receiver ids do not match anchors | `[ws]` unknown-receiver log | `--id` must equal the receiver slug in the home model |
| Vector has one receiver | Other listeners offline | `/health` | Check battery and Bluetooth |
| Sim and BLE fight | Both emitting | Log `source` | Confirm the 10 s sim lock works |
| `/ws/live` empty in the browser | Mixed content or wrong URL | Browser console | Run web and monitor on the laptop; fix `NEXT_PUBLIC_MONITOR_WS` |
| Replay jumps | Timestamps not rebased | Session file | Rebase `ts` to now at start |
| CI red on main | Merge without tests | Actions log | Revert, fix on branch |

## Starter prompt

> Read LANTERN_PROJECT_PLAN.md Parts 0 to 2 and Part 3. You are Saran. Start at step 1: build the monitor skeleton and the foundation row, then the Bluetooth spike. Do not edit files outside your ownership list. After each step run tests, commit as `s: step N`, and tell me what you need from others.

## Requests for others

- (fill in as you go)

---

# PART 4. NIMAI: World model (LiDAR) and 3D live view

Branch `feat/nimai-world`. Commit prefix `n:`.

## Mission

Turn a phone scan of the real home into one shared-coordinate home model (rooms, doors, listener anchors, hazards), render it as an interactive 3D room, and show the person **moving through it live as a coordinate** (an avatar with a trail, a predicted route, listener markers, hazard markers, and a replay scrubber). Also run the accessibility audit (ADA rules and the mobility planner) and the audit report.

## You own

`ios/LanternScan/**`, `lib/types/world.ts`, `lib/world/**`, `monitor/world/**`, `lib/audit/ada.ts mobility.ts fixes.ts`, `app/dashboard/world/**`, `app/dashboard/audit/**`, `app/api/scans/**`, `app/api/world/**`, `components/world/**`, `supabase/migrations/0007_world.sql`, `supabase/seed/nimai.ts`, `fixtures/home-model.json`, `fixtures/captured-*.json`, `fixtures/photos/**`.

## You produce and consume

| Produce | Who uses it |
|---|---|
| `fixtures/home-model.json` (first hour) | Everyone |
| `HomeModel` in Supabase (`home_models`) + `monitor/world` API (`roomAt`, `clampToRoom`, `routeBetween`, `adjacency`) | Vineet (graph, anchors, clamp), Saran (sim), Aarnav (room kinds, photos) |
| `audit_items` (ADA) and the audit report page | Aarnav (analytics link), judges |
| `/dashboard/world` live 3D view | the demo and the video |
| **Consume** | From |
| `/ws/live` frames (`position`, `location`, `prediction`, `risk`, `patient`, `listener`) | Saran (host), Vineet (position), Aarnav (risk, patient) |
| Vision hazard `audit_items` | Vineet |
| Listener real positions | Saran (tell him where they sit, or place them from the model) |

## Build order

### Step 1. Home model fixture and geometry library (first hour)

- Write `fixtures/home-model.json` from section 1.5 as valid `HomeModel` JSON. Commit immediately
- `lib/world/geometry.ts` (pure, tested, shared with the monitor):

```ts
export const inToM = (v: number) => v * 0.0254;
export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean { /* ray casting */ }
export function roomAt(home: HomeModel, p: Vec2): HomeRoom | undefined {
  return home.rooms.find(r => pointInPolygon(p, r.polygon));
}
export function nearestPointInPolygon(p: Vec2, poly: Vec2[]): Vec2 { /* project onto the closest edge */ }
export function clampToRoom(home: HomeModel, roomId: string, p: Vec2): Vec2 {
  const r = home.rooms.find(x => x.id === roomId)!;
  return pointInPolygon(p, r.polygon) ? p : nearestPointInPolygon(p, r.polygon);
}
export function adjacency(home: HomeModel): Record<string, string[]> { /* from doors */ }
// path through doors: centroid(from) > door(from,next) > ... > centroid(to)   (BFS on adjacency)
export function routeBetween(home: HomeModel, fromRoomId: string, toRoomId: string): Vec2[] { /* ... */ }
```

- Tests: the fixture has no isolated room; `roomAt` of each centroid returns that room; `routeBetween("bedroom", "kitchen")` goes bedroom > door > hallway > door > kitchen; `clampToRoom` of an outside point lands on the boundary
- `monitor/world/index.ts`: load the latest `home_models` row (or the fixture), expose `ctx.world()`, `GET /debug/world`, `GET /world/route`, `POST /world/reload`
- Done when: tests pass and `GET /debug/world` returns the demo home. Tell everyone

### Step 2. Scan app `ios/LanternScan` (Phase 1)

Requires a LiDAR iPhone or iPad Pro.

- SwiftUI app, iOS 17, `supabase-swift`, Info.plist `NSCameraUsageDescription`
- Capture: `RoomCaptureViewRepresentable` and `ScanController` (`RoomCaptureSessionDelegate`, `RoomCaptureViewDelegate`). **For one shared coordinate frame**, scan all rooms in one continuous AR session (create `RoomCaptureSession(arSession:)` with a shared `ARSession`) and merge the results with `StructureBuilder` into a `CapturedStructure`. If merging fails or is slow, use the fallbacks in step 4
- Export: `JSONEncoder` for the structure or each `CapturedRoom` (both are `Codable`), and `export(to:exportOptions: .parametric)` for USDZ
- `PhotoCapture`: 2 to 4 photos per room tagged with the room name
- `Uploader`: upload JSON, USDZ and photos to Storage under `scans/{householdId}/{scanId}/`, insert the `scans` row, call `POST /api/scans/{id}/process`, show progress, retry
- Scan one real room (or the whole demo space), save the JSON as `fixtures/captured-room.json`, tape-measure one door and one wall for later comparison, commit
- Free provisioning expires after 7 days: reinstall before the demo
- Done when: the JSON is in the repo

### Step 3. Parse the scan into the shared frame (Phase 1)

- `lib/world/units.ts` and `lib/world/parse.ts`. Inspect the fixture first: each surface has `dimensions` and a `transform`; a `simd_float4x4` encodes as 16 numbers (or four arrays of four) in **column-major** order; categories are encoded enums like `{"door": {"isOpen": false}}`. The file wins over this brief if they differ
- Floor plane = RoomPlan `(x, z)` in meters, so `y_plan = z`. Convert with `* 39.3701`. Wall center = translation (flat indexes 12 and 14); direction = first column projected to the floor; start/end = center ∓ dir × width/2

```ts
export const metersToInches = (m: number) => m * 39.3701;
export const colMajor = (t: number[] | number[][]) => (Array.isArray(t[0]) ? (t as number[][]).flat() : (t as number[]));
export function toFloor(t: number[] | number[][], widthM: number) {
  const m = colMajor(t), cx = m[12], cz = m[14];
  const dx = m[0], dz = m[2], len = Math.hypot(dx, dz) || 1, ux = dx / len, uz = dz / len, h = widthM / 2;
  return {
    center: { x: metersToInches(cx), y: metersToInches(cz) },
    start: { x: metersToInches(cx - ux * h), y: metersToInches(cz - uz * h) },
    end: { x: metersToInches(cx + ux * h), y: metersToInches(cz + uz * h) },
  };
}
```

- Door width = `dimensions.x`. Floor polygon from `floors[0].polygonCorners` if present, else from the walls
- Tests: wall count matches your room; door width within 1 in of your tape measure
- `POST /api/scans/[id]/process`: download, parse, build the `HomeModel` (step 4), run ADA rules (step 8), write `home_models` and `audit_items`. Room ids are slugs of the room name (`slug("TV room")` = `tv-room`)
- Done when: `npx tsx lib/world/cli.ts fixtures/captured-room.json` prints rooms and doors in inches

### Step 4. Build the shared home model: zones, doors, anchors (Phase 1)

A venue or lab is rarely a real bedroom-hallway-kitchen. The demo can be **one scanned space divided into virtual rooms** (marked with tape on the floor), so build for that:

- `lib/world/build.ts`: `buildHomeModel(scan, edits)` combines parsed rooms with editor changes into a `HomeModel` with `version + 1`
- **Zone editor** (`/dashboard/world/edit`): 2D plan; click to add polygon vertices; name each zone and set its `kind`; mark `virtual: true`; place door markers between zones; **drag the listener anchors to where the laptops really are**; save as a new `home_models` row. If multi-room merge fails you can also drag whole scanned rooms into place here
- Fallbacks in order: merged `CapturedStructure` > one scan divided into virtual zones > the hand-written fixture
- Hazard pins: Vineet's vision hazards and your ADA items carry a position; show them as `Hazard`s in the model
- Done when: the demo space (or the fixture) opens in the editor, zones can be redrawn, and saving updates `GET /debug/world`

### Step 5. 3D scene from the home model (Phase 1)

`/dashboard/world` renders the world with React Three Fiber (`@react-three/fiber`, `@react-three/drei`). Build the scene **procedurally from the `HomeModel`** (not from the USDZ), because that guarantees the 3D matches the coordinates the avatar uses.

- Floor: `ShapeGeometry` from each `polygon`, color by `kind`, warm tint when the person is in that room, red edge when a risk is open there
- Walls: for each polygon edge, subtract door intervals along it (1D interval subtraction using `HomeDoor.center` and `widthIn`) and extrude the remaining pieces as thin boxes of `heightIn` (default 96 in); doors show a lintel and an open gap. Make walls semi-transparent so the avatar is visible
- Objects (from the scan) as boxes; room labels as `Html` from drei; listener anchors as small cones with a pulsing ring scaled by the latest RSSI (`listener` frames); hazards as amber sprites with a tooltip
- Coordinate mapping: `scene = [x * 0.0254, 0, y * 0.0254]`; up is +Y
- Camera presets: top-down, isometric, follow-person; `OrbitControls`
- Done when: the fixture home renders in 3D with rooms, doors, listeners and labels, and orbiting works at 60 fps on the demo laptop

### Step 6. Live data hook and the moving avatar (Phase 1; the signature feature)

- `lib/world/useLive.ts`: connects to `NEXT_PUBLIC_MONITOR_WS`, handles `snapshot` then incremental frames, reconnects with backoff, exposes `{ home, position, room, prediction, risks, patient, listeners, source }`. In `NEXT_PUBLIC_MOCK=1` it plays a scripted walk generated from `routeBetween` (bedroom > hallway > kitchen, 1 point per 200 ms at about 50 in/s) so you can build with no backend
- Avatar component (smooth motion, never teleports):

```tsx
function Avatar({ target, source }: { target: { x: number; y: number }; source: "ble" | "sim" }) {
  const ref = useRef<THREE.Group>(null!);
  const cur = useRef(new THREE.Vector3(target.x * IN, 0, target.y * IN));
  useFrame((_, dt) => {
    const goal = new THREE.Vector3(target.x * IN, 0, target.y * IN);
    cur.current.lerp(goal, 1 - Math.exp(-6 * dt));          // critically-damped feel; no jumps
    ref.current.position.copy(cur.current);
  });
  return (
    <group ref={ref}>
      <mesh position={[0, 0.9, 0]}><capsuleGeometry args={[0.22, 1.0, 8, 16]} /><meshStandardMaterial color="#f5a54a" emissive="#f5a54a" emissiveIntensity={0.6} /></mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}><ringGeometry args={[0.35, 0.45, 32]} /><meshBasicMaterial color="#f5a54a" transparent opacity={0.6} /></mesh>
    </group>
  );
}
```

- Trail: keep the last 10 s of positions and draw a fading `Line`; show a heading arrow from `velocity`
- Prediction: when a `prediction` frame arrives, draw a dashed route with `routeBetween(current room, nextRoom)` and light the target room outline with its probability ("kitchen 78%")
- State coloring: floor of a risky room turns amber at `redirecting`, red at `escalated`; a small HUD shows current room, confidence, patient mode (screen glow / photo + voice), and a source chip. **SIMULATED badge** whenever `source = "sim"` or the session is a replay
- **Drag to simulate:** a toggle lets you drag the avatar on the floor; on release call `POST /sim/position {x, y}` (this is the wizard-of-oz control and the best live demo for judges)
- Position confidence ring: radius grows when confidence is low
- Done when: moving the avatar by dragging, by `POST /sim/room`, and by the mock walk all produce smooth motion, and a room change recolors the floor within a frame

### Step 7. Replay and time-machine (Phase 2)

- `/dashboard/world/replay`: pick a recorded session (Saran's `fixtures/sessions/*.jsonl`), scrub a timeline, play, pause, speed 1x to 8x; the avatar, trail, risk coloring and patient screen mode follow the recording. Calls `POST /replay/start {mode: "live"}` or reads the file directly
- Heat map: accumulate positions into a grid and show where time was spent (kitchen at 3 AM), as a translucent floor overlay
- Done when: Saran's recorded night replays with the same motion and a scrubber

### Step 8. Accessibility audit and mobility planner (Phase 2)

- `lib/audit/ada.ts`: one pure function per rule `(room: HomeRoom, home: HomeModel) => AuditItem[]`. Rules (2010 ADA Standards are the benchmark; private homes do not have to comply, so near-limit results say "Verify with a tape measure"):

| Rule | Check | Reference |
|---|---|---|
| Door clear width | at least 32 in | ADA 404.2.3 |
| Hallway / route width | at least 36 in | ADA 403.5.1 |
| Turning space | 60 in circle in bathroom and bedroom | ADA 304.3 |
| Toilet clearance | clear floor space beside and in front | ADA 604.3 |
| Bed clearance | 36 in on the exit side | OT guideline |
| Stairs, bathtub | flag for handrails (both sides, 34 to 38 in), grab bars (33 to 36 in), non-slip | ADA 505, 607, 609 |
| Thresholds, reach range | flagged from photos by Vineet's vision pass | ADA 303, 308 |

- Turning space: grid-sample the polygon every 4 in; a point passes if its distance to every wall and object is at least 30 in. Route width: sample along the line between two door centers; take the minimum clearance
- `lib/audit/mobility.ts`: rasterize the plan (2 in cells), inflate obstacles by 12 (walker) or 13 in (wheelchair), A* between doors; return the route and which door or turn blocks it. Draw failures in red in the 3D view
- `lib/audit/fixes.ts`: hazard to product and rough cost (stove knob covers, door chime, stair-edge tape, grab bar)
- Tests: 28 in door fails; 34 in passes; cluttered hallway fails; wheelchair through a 30 in door fails
- Done when: the fixture or real scan yields at least 3 sensible items with locations

### Step 9. Audit report page (Phase 2)

- `/dashboard/audit/[scanId]`: items grouped by room, sorted by severity, measured vs required, photo or plan crop, fix and product, OT actions (accept, dismiss, mark fixed, note) updating `status`; summary of counts and top 3 fixes; `@media print` so Save as PDF is clean; read-only share link. Vision items from Vineet appear here with source "vision"
- Done when: Print to PDF produces a clean report

### Step 10. Stretch (cut first)

- Splat of one room (Scaniverse or Polycam) rendered with Spark inside the same R3F scene, labeled "the real home"
- Marble "what if" fix previews (stove guard, stair gate) via the World Labs API, pre-generated, labeled "preview"
- Show the USDZ with `<model-viewer>` or convert to GLB
- Re-scan diff: a before and after Home Safety Score
- Ray-cast hazard markers onto real object positions

## Branch acceptance test

1. `npm run typecheck && npm test` pass (geometry, parse, ADA, mobility)
2. `NEXT_PUBLIC_MOCK=1 npm run dev:web`: `/dashboard/world` shows the fixture home and a scripted walk with smooth motion, trail, prediction route and a SIMULATED badge
3. With Saran's monitor: dragging the avatar posts `/sim/position`, and `POST /sim/room {"roomId":"kitchen"}` moves it
4. `npx tsx lib/world/cli.ts fixtures/captured-room.json` prints a valid model
5. The audit report prints cleanly

## Handoffs

| When | To | What |
|---|---|---|
| First hour | everyone | `fixtures/home-model.json`, `lib/world/geometry.ts`, `GET /debug/world` |
| Step 4 | Saran | Final listener anchor positions (or confirm the real ones) |
| Step 6 | Aarnav, Saran | The 3D page URL and `useLive` for the dashboard overview |
| Gate 2 | Vineet | Real home model (graph and anchors changed? tell him) |
| Phase 2 | Aarnav | Audit summary for analytics |

## Debugging roadmap

| Symptom | Likely cause | Check | Fix |
|---|---|---|---|
| `RoomCaptureSession.isSupported` false | No LiDAR | Phone model | Use a Pro iPhone or iPad Pro |
| Xcode signing error | Free Personal Team | Signing tab | Unique bundle id; trust the profile on the phone |
| App stops working after a week | 7-day expiry | | Reinstall before the demo |
| Camera crash on launch | Missing plist key | Xcode console | Add `NSCameraUsageDescription` |
| Rooms do not line up after merge | Separate AR sessions | | Scan in one continuous session or place rooms by hand in the zone editor |
| Walls rotated or mirrored | Wrong axis or sign | Draw one known wall | Try `atan2(-uz, ux)` or swap x and z; keep one convention in the tests |
| Distances off by a constant | Units | Print raw dimensions | `metersToInches` once, in one place |
| Door width equals wall thickness | Used `dimensions.z` | Print all three | Use `dimensions.x` for doors |
| Parser throws on `category` | It is an object | `JSON.stringify` | Read the first key |
| Upload 401 or 403 | Storage or RLS | Supabase logs | Service role in the API route; check bucket policies with Aarnav |
| `process` times out | Sequential work | Server log | Parallelize; respond fast and finish in the background |
| 3D scene blank | Camera inside a wall or units wrong | Log bounding box | Fit the camera to the model bounds in meters |
| Avatar appears mirrored on the plan | Y axis vs Z | Compare to the real room | Map plan `y` to scene `z` once, in one place |
| Avatar teleports | Using position directly instead of lerp | | Smooth in `useFrame` |
| Avatar leaves the room | Clamp missing | Check `source` | Vineet clamps; also clamp in the view as a safety |
| Walls hide the avatar | Opaque walls | | 30 to 40 percent opacity, or cut walls near the camera |
| `useLive` receives nothing | Wrong WS URL or mixed content | Browser console | `NEXT_PUBLIC_MONITOR_WS`; run web and monitor on the laptop |
| Frame rate drops | Too many meshes or high-DPR | R3F perf | Instance walls, `dpr={[1,1.5]}` |
| ADA flags everything | Wrong unit or counted walls as obstacles | Log measured vs required | Fix units; exclude wall-mounted categories |
| A* finds no path | Doors treated as walls or too much inflation | Draw the grid | Keep door cells free; reduce inflation |

## Starter prompt

> Read LANTERN_PROJECT_PLAN.md Parts 0 to 2 and Part 4. You are Nimai. Start at step 1: write `fixtures/home-model.json` and `lib/world/geometry.ts` with tests, then the 3D scene in mock mode. Do not edit files outside your ownership list. After each step run tests, commit as `n: step N`, and tell me what you need from others.

## Requests for others

- **Aarnav:** add a **World** entry (`/dashboard/world`) to the dashboard nav; it is reachable by URL until then. `/dashboard/world/edit` and `/dashboard/world/replay` hang off it.
- **Aarnav:** `lib/dashboard/data.ts` now maps `audit_items.note` to `AuditItem.note` (one line) for the OT notes on the audit report.
- **Saran:** listener `--id`s must equal the anchor `receiverId`s in the home model (`GET /debug/world`). Place them in `/dashboard/world/edit` and save; the monitor's world module reloads the newest `home_models` row on `POST /world/reload` (the web app calls it after every save).
- **Saran:** the recorder's `fixtures/sessions/*.jsonl` replay at `/dashboard/world/replay` (lines `{k, ts, d}` with bus payloads; raw `frame` lines are skipped).
- **Vineet:** `HomeModel.doors` is the door graph for the HMM; `lib/world/geometry.ts` has `adjacency`, `roomPath`, `routeBetween`, `clampToRoom`. ADA and mobility items carry a `location`; your vision items get the room centroid until you have better positions.
- **Everyone:** `package.json` gained `@react-three/fiber` and `@react-three/drei` for the 3D view.

---

# PART 5. VINEET: ML and AI

Branch `feat/vineet-ml`. Commit prefix `v:`.

## Mission

Turn RSSI into a room, a position and a prediction. Build the classifier, the door-graph HMM (the scan feeds the ML), the position estimator that drives the 3D avatar, the Markov destination predictor, the training and metrics pipeline, and the Claude vision hazard audit.

## You own

`monitor/inference/**`, `ml/**`, `lib/types/inference.ts`, `lib/audit/vision.ts`, `app/dashboard/models/**`, `app/api/ask/**` (stretch), `components/vineet/**`, `supabase/migrations/0008_ml.sql`, `supabase/seed/vineet.ts`, `fixtures/rssi-samples.fake.csv`, `fixtures/walks.json`.

## You produce and consume

| Produce | Who uses it |
|---|---|
| bus `position` (about 5 Hz), `location` (room changes), `prediction` | Nimai (3D avatar), Aarnav (rules, responder), recorder |
| Models in `models` table (kNN, Markov, pathloss) | the monitor |
| `/dashboard/models` metrics page and `MetricsReport` JSON | team, judges |
| Vision hazard `audit_items` | Nimai (audit report), Aarnav (analytics) |
| **Consume** | From |
| `frame` events | Saran |
| `HomeModel` (graph, anchors, polygons), `clampToRoom`, `routeBetween` | Nimai |
| `fixtures/rssi-samples.csv` (real) | Saran |

## Build order

### Step 1. Types, fake data, stub module (first hour)

- `lib/types/inference.ts` (section 1.2)
- `ml/make_fake_rssi.py`: simulate RSSI from the **anchors in `fixtures/home-model.json`** with a log-distance path-loss model plus noise and wall attenuation: `rssi = txPower - 10 n log10(d) - wallPenalty + N(0, 3)` with `txPower = -59`, `n = 2.5`, wall penalty about 6 dB per wall crossed (count door-less boundaries between room polygons). Generate walks from `fixtures/walks.json` and write `fixtures/rssi-samples.fake.csv` in the shared format
- `ml/synth_walks.py` generates `fixtures/walks.json`: sequences of `{room, hour}` for simulated nights over the door graph (bedroom > hallway > bathroom > hallway > bedroom is common; bedroom > hallway > kitchen > hallway > bedroom is rarer and rises over simulated weeks)
- `monitor/inference/index.ts` stub that subscribes to `frame` and logs
- Done when: the fake CSV exists and trains a kNN well above chance

### Step 2. kNN classifier and baseline (Phase 1)

- `ml/train.py`: features = the SensorFrame vector (median RSSI per receiver, -100 missing). Models: **strongest-receiver baseline**, kNN with k = 3, 5, 7, and Random Forest. Cross-validate by **recording session** (group k-fold) so adjacent windows never leak between train and test; print accuracy and a confusion matrix; save PNGs to `ml/out/`. Save the best kNN (or the baseline if it wins) to `models` with `kind = "knn"`, the receiver order, `k`, vectors and labels, and `accuracy`
- `monitor/inference/knn.ts`: Euclidean distance, distance-weighted votes, returns a **posterior over all rooms**. `baseline.ts`: strongest receiver after offsets
- Done when: tests pass (three clusters classify; all -100 gives a flat posterior) and `python ml/train.py` writes a model that `POST /model/reload` loads

### Step 3. Room estimate and the `location` event (Phase 1)

- Every `frame`: posterior > room estimate. First version: require 2 consecutive agreeing frames with confidence at or above 0.6, then emit `location`
- Done when: replaying the fake walk emits exactly bedroom, hallway, kitchen with no flapping

### Step 4. Position estimator and the `position` stream (Phase 1; drives the avatar)

- `monitor/inference/position.ts`: **weighted centroid of the listener anchors** with weights from a path-loss distance estimate, then smoothing, a speed limit, and a clamp into the room polygon of the current room belief

```ts
export function estimatePosition(vec: number[], order: string[], anchors: Record<string, Vec2>,
                                 p = { txPower: -59, n: 2.5, floor: -95 }): Vec2 | undefined {
  let sx = 0, sy = 0, sw = 0;
  order.forEach((id, i) => {
    const rssi = vec[i];
    if (rssi <= p.floor || !anchors[id]) return;                       // ignore missing readings
    const dIn = Math.pow(10, (p.txPower - rssi) / (10 * p.n)) * 39.37; // metres -> inches
    const w = 1 / Math.max(dIn * dIn, 1);
    sx += w * anchors[id].x; sy += w * anchors[id].y; sw += w;
  });
  return sw ? { x: sx / sw, y: sy / sw } : undefined;
}

export class PositionFilter {
  private cur?: Vec2; private last = 0;
  constructor(private alpha = 0.35, private maxSpeed = 100 /* in/s */) {}
  step(raw: Vec2, ts: number, clamp: (p: Vec2) => Vec2): Vec2 {
    if (!this.cur) { this.cur = clamp(raw); this.last = ts; return this.cur; }
    const dt = Math.max((ts - this.last) / 1000, 0.05); this.last = ts;
    let nx = this.cur.x + this.alpha * (raw.x - this.cur.x);
    let ny = this.cur.y + this.alpha * (raw.y - this.cur.y);
    const dx = nx - this.cur.x, dy = ny - this.cur.y, d = Math.hypot(dx, dy), max = this.maxSpeed * dt;
    if (d > max) { nx = this.cur.x + (dx / d) * max; ny = this.cur.y + (dy / d) * max; }
    this.cur = clamp({ x: nx, y: ny });                                  // never leave the believed room
    return this.cur;
  }
}
```

- Emit `position` at about 5 Hz by interpolating between 1 Hz frames (or run the filter at 5 Hz using the latest vector). Include `roomId`, `confidence`, `source: "ble"`, and a velocity estimate
- When the room changes, move through the shared door: use `routeBetween` so the avatar walks through the doorway, not through a wall (the filter's `maxSpeed` plus the clamp to the new room does most of this; for large jumps animate along the route)
- Done when: replaying the fake walk gives a smooth coordinate path that stays inside the believed room; log raw vs smoothed in `GET /debug/inference`
- Honest note for the pitch: this is a coarse in-room estimate; the room is reliable, the exact spot is not

### Step 5. Door-graph HMM (Phase 2; "the scan feeds the ML")

- `monitor/inference/hmm.ts`:

```ts
export function buildTransition(roomIds: string[], edges: [string, string][], stay = 0.9, eps = 1e-3): number[][] {
  const idx = new Map(roomIds.map((id, i) => [id, i]));
  const adj = roomIds.map(() => new Set<number>());
  for (const [a, b] of edges) { adj[idx.get(a)!].add(idx.get(b)!); adj[idx.get(b)!].add(idx.get(a)!); }
  return roomIds.map((_, i) => {
    const row = roomIds.map((_, j) => (i === j ? stay : adj[i].has(j) ? (1 - stay) / Math.max(adj[i].size, 1) : eps));
    const z = row.reduce((s, v) => s + v, 0);
    return row.map(v => v / z);
  });
}
// alpha_t(j) is proportional to emission_j * sum_i alpha_{t-1}(i) * T[i][j]
export function forward(alpha: number[], T: number[][], emission: number[]): number[] {
  const n = alpha.length, out = new Array(n).fill(0);
  for (let j = 0; j < n; j++) { let s = 0; for (let i = 0; i < n; i++) s += alpha[i] * T[i][j]; out[j] = s * emission[j]; }
  const z = out.reduce((a, b) => a + b, 0) || 1;
  return out.map(v => v / z);
}
```

- Edges come from `adjacency(world())` (Nimai). Emission = kNN posterior + 0.02. The room changes when the top belief exceeds 0.6 for 2 steps. Rebuild when `/world/reload` fires
- Tests: with bedroom-hallway-kitchen edges, the observation sequence bedroom, bedroom, **kitchen**, bedroom never outputs kitchen right after bedroom; bedroom, hallway, hallway, kitchen reaches kitchen
- Done when: no impossible jumps in the replay log; record accuracy with and without the HMM for the metrics page

### Step 6. Markov destination predictor (Phase 2)

- `ml/train_markov.py`: counts with context `(prev, cur, hourBucket)` from `fixtures/walks.json` plus recorded sessions; write a `markov` model
- `monitor/inference/predictor.ts`:

```ts
export function predictNext(m: MarkovModel, prev: string | undefined, cur: string, hour: number) {
  const bucket = Math.floor(hour / 3);                                  // 8 buckets a day
  for (const k of [`${prev}>${cur}|${bucket}`, `${cur}|${bucket}`, cur]) {   // back off in order
    const c = m.counts[k]; if (!c) continue;
    const total = Object.values(c).reduce((s, v) => s + v, 0);
    if (total >= 5) { const [room, n] = Object.entries(c).sort((a, b) => b[1] - a[1])[0]; return { nextRoomId: room, probability: n / total }; }
  }
}
```

- After every room change emit `prediction` (`fromRoomId`, `nextRoomId`, `probability`). Aarnav's risk engine decides whether it matters. Nimai draws the predicted route
- Done when: a replayed 3 AM walk emits "hallway > kitchen 0.78" before the kitchen `location`

### Step 7. Claude vision hazard audit (Phase 2)

- `lib/audit/vision.ts`: forced tool call, latest Claude model in one constant; photos in parallel with `Promise.all`; cache by photo path; one failed photo must not fail the report

```ts
import Anthropic from "@anthropic-ai/sdk";
const client = new Anthropic(); const MODEL = "claude-sonnet-5-5";
export async function findHazards(photoUrl: string, roomName: string, roomId: string): Promise<AuditItem[]> {
  const res = await client.messages.create({
    model: MODEL, max_tokens: 1500,
    tools: [{ name: "report_hazards", description: "Report hazards visible in the photo.",
      input_schema: { type: "object", required: ["hazards"], properties: { hazards: { type: "array", items: {
        type: "object", required: ["title", "detail", "fix", "severity"],
        properties: { title: { type: "string" }, detail: { type: "string" }, fix: { type: "string" },
                      severity: { type: "string", enum: ["high", "medium", "low"] } } } } } } }],
    tool_choice: { type: "tool", name: "report_hazards" },
    messages: [{ role: "user", content: [
      { type: "image", source: { type: "url", url: photoUrl } },
      { type: "text", text: `Room: ${roomName}. You assist an occupational therapist reviewing a home for a person with dementia. List only hazards you can actually see: trip hazards, wandering cues (keys, coats, shoes by the exit), confusion (mirrors, dark floors, low contrast), bathroom, kitchen. Do not guess at anything out of frame.` }] }],
  });
  const block = res.content.find(b => b.type === "tool_use");
  const hazards = (block && "input" in block ? (block.input as any).hazards : []) as any[];
  return hazards.map((h, i) => ({ id: `${roomId}-v-${i}`, roomId, source: "vision" as const, ...h, status: "open" as const }));
}
```

- Done when: the fixture photos produce plausible items, a bad URL returns `[]` without throwing, and a re-run costs no new API call. Nimai's process route calls you

### Step 8. Metrics, models page, replay evaluation (Phase 2)

- `ml/report.py` computes accuracy vs baseline, per-room accuracy, confusion matrix, **lead time** (seconds between the hallway prediction and arriving in the kitchen), **false redirects per simulated night**, and **end-to-end latency** (sighting timestamp to `patient_state` update). It can run on Saran's recorded sessions in `raw` replay mode. Save a `MetricsReport` JSON and PNGs
- `/dashboard/models`: baseline vs model accuracy, confusion matrix heat map, per-room accuracy, lead-time dots, false redirects, latency. **Never hide a bad number**: if kNN loses to the baseline, show both and say which one ships
- Retrain button documents the command (training runs from the CLI)
- Done when: the page shows real numbers from real data

### Step 9. Stretch

- **Fingerprint position regression:** with `x,y` labeled fingerprints from Saran, train kNN regression on coordinates and blend with the weighted centroid; fit `txPower` and `n` per listener with `ml/fit_pathloss.py`
- **Contextual bandit:** Thompson sampling over `glow`, `voice`, `photo` by hour bucket; reward = seconds until the person returned (`interventions` table)
- **Anomaly detection:** per-hour baselines or Isolation Forest on synthetic months with an injected change ("3 AM kitchen visits 3x baseline for 2 weeks")
- **Ask your home:** `POST /ask {question}` gives Claude tool access to the event tables and returns a plain-language answer ("What happened last night?"); chat box in Aarnav's dashboard
- **Natural-language rules:** "Alert me if Dad goes in the garage after dark" parsed into a `zone_rules` row (coordinate with Aarnav)

## Branch acceptance test

1. `npm run typecheck && npm test` pass (window input, kNN, HMM, predictor, position filter)
2. `npm run dev:monitor` + `npm run dev:mock-rssi`: `GET /debug/inference` follows the replayed walk; `/ws/live` shows smooth `position` and clean `location` and `prediction` frames
3. `python ml/train.py` prints baseline vs kNN and writes a model; `POST /model/reload` loads it
4. A replayed 3 AM walk produces a prediction before the kitchen arrival
5. The vision function returns hazards for fixture photos

## Handoffs

| When | To | What |
|---|---|---|
| First hour | Nimai, Saran | Fake CSV and walks |
| Step 3 | Aarnav | `location` events (via `/debug/emit` first) |
| Step 4 | Nimai | `position` stream (Nimai uses the mock walk until then) |
| Step 6 | Aarnav | `prediction` events |
| Before training | Saran | Exactly what labeled data you need (see Saran step 6) |
| Phase 2 | Aarnav, Nimai | Metrics JSON, vision hazards |

## Debugging roadmap (inference)

| Symptom | Likely cause | Check | Fix |
|---|---|---|---|
| Classifier always says one room | Unbalanced data or wrong offsets | Confusion matrix | Balance samples; recalibrate |
| Accuracy worse than baseline | Too little data, k too small, leakage hiding it | Group-by-session CV | More data; k = 7; ship the baseline and say so |
| Accuracy great in training, bad live | Phone held differently or listeners moved | Compare live vector to training | Retrain in the demo setup |
| Room flaps between two rooms | Hysteresis too weak, overlapping zones | `[loc]` log | Raise threshold to 0.7, require 3 steps, move listeners apart |
| Room never changes | HMM stay too high or hysteresis too strong | `[hmm]` belief | Stay 0.85 |
| HMM blocks a real move | Missing door edge | Print adjacency | Fix doors in the zone editor |
| Avatar jitters | No smoothing | Raw vs smoothed in `/debug/inference` | Lower alpha to 0.25 |
| Avatar lags behind | Too much smoothing | | Raise alpha to 0.5, raise `maxSpeed` |
| Avatar sits at the middle of the home | Weighted centroid with equal weights | Print distances | Calibrate `txPower` and `n`; use the room-clamped estimate; fit path loss |
| Avatar stuck in a doorway | Clamp to the old room after a switch | | Clamp to the new room immediately after `location` |
| Position far from the true spot | Anchors in the model differ from the listeners' real places | Compare | Nimai updates anchors to reality |
| Predictor never fires | Probability under 0.6 or too few counts | Print matched key and counts | More synthetic walks; threshold 0.5 |
| Predictor fires constantly | Counts dominated by one target | | Balance walks; include hour context |
| Metrics page empty | Report JSON not written | `ml/out/` | Run `report.py` and save to the `models` table |
| Vision returns prose | `tool_choice` missing | | Force the tool |
| Vision returns nothing | Dark photo or prompt too strict | Print raw response | Retake photo; ask for "all visible hazards" |
| Rate limits | Sequential bursts | | Cache and cap at about 12 photos per scan |

## Starter prompt

> Read LANTERN_PROJECT_PLAN.md Parts 0 to 2 and Part 5. You are Vineet. Start at step 1: generate fake RSSI from the home model anchors, then the kNN baseline, then the room and position streams. Do not edit files outside your ownership list. After each step run tests, commit as `v: step N`, and tell me what you need from others.

## Requests for others

- (fill in as you go)

---

# PART 6. AARNAV: Actions, messages, analytics and the dashboard

Branch `feat/aarnav-actions`. Commit prefix `a:`.

## Mission

Everything that **happens as a result** of the signal: decide whether a movement is risky, respond first on the patient screen (glow, familiar photo, familiar voice), message the caregiver only if needed (SMS, call, backup), and show it all in the dashboard with analytics. Also own the core database, the patient screen, and the routine.

## You own

`monitor/actions/**`, `lib/types/actions.ts`, `lib/supabase/**`, `lib/env.ts`, `.env.example`, `supabase/migrations/0005_core.sql`, `supabase/seed/aarnav.ts` (core seed), `app/dashboard/layout.tsx nav.config.ts page.tsx alerts/ analytics/ routine/ settings/`, `app/routine/**`, `app/api/alerts/** patient/** twilio/**`, `components/aarnav/**`.

## You produce and consume

| Produce | Who uses it |
|---|---|
| `0005_core.sql`, Supabase keys, seed, `.env.example` (first hour) | Everyone |
| Dashboard shell and `nav.config.ts` | Everyone (each owner fills in their stub pages) |
| bus `risk` and `patient` events; `patient_state`, `risk_events`, `alerts`, `location_events` rows | Nimai (3D coloring), recorder, analytics |
| `/routine` patient screen on a tablet or laptop in the room | the demo |
| SMS and calls | the caregiver |
| **Consume** | From |
| `position`, `location`, `prediction` events | Vineet (or `/sim/*`, `/debug/emit`) |
| `HomeModel` room kinds and photos | Nimai |
| Vision hazards and audit items | Vineet, Nimai |

## Build order

### Step 1. Core database, seed, dashboard shell (first hour)

- Supabase project; `0005_core.sql` with: `households`, `members`, `contacts`, `zone_rules`, `location_events`, `risk_events`, `alerts`, `patient_state`, `routines`, `routine_steps`, `interventions`. Room id columns are **text slugs**. RLS on every table via an `is_member(household_id)` function; Realtime enabled for `location_events`, `risk_events`, `alerts`, `patient_state`; `patient_state` is readable by the `anon` role (the patient screen has no login; it holds only a mode, a short message and storage paths; the household id is an unguessable UUID capability) while photos and voice go through a signed-URL route
- Storage bucket `voice` (private). Other owners create their own buckets in their migrations
- Seed with a **fixed** household UUID (`HOUSEHOLD_ID`), a primary and a backup contact with verified Twilio numbers, zone rules (front-door any time = redirect; kitchen 22 to 6 = redirect; bathroom 22 to 6 = allow; tv-room 8 to 20 = greet), a starter routine of 4 steps
- `app/dashboard/layout.tsx`, `nav.config.ts` with entries for Overview, World (Nimai), Alerts, Analytics, Routine, Audit (Nimai), Models (Vineet), Devices (Saran), Settings, and a stub page for each route
- Share the keys privately (never commit them). Done when: everyone can read and write their own tables and the dashboard loads empty

### Step 2. Patient screen `/routine` (Phase 1)

- `app/routine/page.tsx?h=<householdId>`: no login, no branding. First render shows a full-screen **Tap to start** (browsers block audio until a gesture). Subscribes to `patient_state` for that household and renders by mode:

| Mode | Screen | Audio |
|---|---|---|
| `idle` | Current routine step: huge text, the room's real photo, high contrast; dim at night | none |
| `glow` | Full-screen warm amber (#f5a54a, low intensity), 4 s slow fade, nothing else | none |
| `photo_voice` | Real photo of the target room (e.g. bedroom), one short line ("It's still night, Mom. Let's go back to bed."), amber border | familiar voice clip |
| `greeting` | Daytime welcome with the next routine step | greeting clip |
| `calm` | Slow 3 s fade back to idle | none |

```tsx
useEffect(() => {
  if (!unlocked || !(state?.mode === "photo_voice" || state?.mode === "greeting") || !state.voicePath) return;
  const a = new Audio(`/api/patient/media?h=${h}&path=${encodeURIComponent(state.voicePath)}`);
  a.play().catch(() => setNeedsTap(true));          // autoplay blocked: show the tap overlay again
  return () => a.pause();
}, [state?.mode, state?.updatedAt, unlocked]);
```

- Rules: text 6 to 8 vw, nothing that blinks, no menus; `?preview=1` adds a corner label "TV (simulated)" for tests
- `GET /api/patient/media?h=&path=` checks the household id and redirects to a signed URL (cache 5 min)
- Idle step player: auto-advances by time of day
- Done when: `POST /debug/patient {"mode":"photo_voice", ...}` changes the page in under 2 s and audio plays after one tap

### Step 3. The patient screen device (Phase 1)

The Roku TV was dropped on 2026-10-24. The patient screen is the `/routine` page on a device in the room.

- Use a tablet or laptop with a speaker in the bedroom or hallway (where the person is when they get up). A listener laptop can double as it
- Setup, written in `docs/runbook.md`: open `/routine?h=<HOUSEHOLD_ID>` fullscreen, tap once (sound, and the microphone if the Vapi companion is on), set the volume, turn off sleep and auto-lock, keep it plugged in
- More than one room: `/routine?room=<room id>` on a device in each room plays only that room's cues
- `monitor/actions/roku.ts` and `tools/find-roku.ts` stay in the code but are unused (`ROKU_HOST` empty)
- Done when: glow and photo plus voice show on the device within 2 s of `/debug/patient`

### Step 4. Risk engine (Phase 1)

- `monitor/actions/risk.ts`: a pure `evaluate(ctx)` function reading `zone_rules`, the room's `kind` (from `world()`), the clock and quiet hours:

| Rule | Trigger |
|---|---|
| `exit-approach` | Enters (or is predicted to enter) the front-door zone in quiet hours |
| `kitchen-night` | Enters (or is predicted to enter) the kitchen in quiet hours |
| `night-wandering` | Out of bedroom for more than N minutes in quiet hours |
| `long-bathroom-stay` | In the bathroom more than 30 minutes (possible fall) |
| `no-movement` | No room change for 2 hours in daytime |
| greeting (not a risk) | Enters a room whose action is `greet` (TV room, daytime) |

- Bathroom trips at night are `allow`: light only, no redirect
- A `prediction` with probability at or above 0.6 for a redirect room creates a `trigger = "predicted"` risk event; cancel it (counted as a false redirect) if the person does not arrive within 60 s. Record `predictedAt`, `arrivedAt`, `leadTimeS`
- Subscribes to `location` and `prediction`; works the same for `source: "sim"`
- Done when: tests cover each rule, `/debug/emit` of a `location` kitchen at 3 AM makes a risk event, and a bathroom trip makes none

### Step 5. Responder and escalation ladder (Phase 1, before Gate 2)

- `monitor/actions/responder.ts`: one state machine per risk event: `detected > redirecting > escalated > resolved`, with an injectable clock for tests

```ts
export const ESCALATION = {
  demo: { voiceAfterS: 5,  returnWindowS: 30, smsAtS: 30,  callIfNoAckS: 45,  backupIfNoAckS: 60 },
  real: { voiceAfterS: 10, returnWindowS: 90, smsAtS: 120, callIfNoAckS: 120, backupIfNoAckS: 240 },
} as const;
```

  1. Immediately: `patient_state = glow`
  2. After `voiceAfterS`: `photo_voice` with the safe room's real photo and the matching voice clip (the familiar voice in a familiar home)
  3. If the person reaches a room with no redirect rule within `returnWindowS`: `resolved`, `calm` then `idle`, **no SMS**
  4. At `smsAtS`: `escalated`, SMS to the priority-1 contact. After `callIfNoAckS` without acknowledgement: voice call. After `backupIfNoAckS`: the backup contact. An acknowledgement stops everything
  5. Acknowledgement arrives two ways: `POST /ack/:alertId` or `alerts.status = 'acknowledged'` via Realtime; handle both idempotently
- Emit `risk` and `patient` bus events on every transition (Nimai colors the room, the recorder logs them)
- Done when: tests with fake timers prove (a) return in time sends nothing, (b) staying sends SMS, then call, then backup at the right times, (c) acknowledgement stops everything, (d) a bathroom trip only lights up

### Step 6. Messages: Twilio SMS and calls (Phase 1)

- `monitor/actions/notify.ts`: `sms(to, body)` and `call(to, twimlSay)`, honoring `TWILIO_DRY_RUN`; every attempt writes an `alerts` row
- SMS text: `Lantern: Mom is in the kitchen (3:07 AM). Redirect played. Acknowledge: ${PUBLIC_BASE_URL}/api/alerts/<id>/ack`
- `GET /api/alerts/[id]/ack`: sets the alert to `acknowledged` and calls `POST ${NEXT_PUBLIC_MONITOR_URL}/ack/:alertId` (if the monitor is unreachable the DB update alone is enough; the responder also watches `alerts`)
- Trial accounts can only reach verified numbers; `PUBLIC_BASE_URL` must be reachable from the caregiver's phone (use the Vercel URL or a tunnel)
- Stretch: inbound SMS reply "OK" acknowledges via `app/api/twilio/sms`
- Done when: a forced risk in the demo profile rings the caregiver's phone with the room and time

### Step 7. TV-room greeting (Phase 2)

- When the person enters a room whose rule action is `greet` during allowed hours, write `patient_state = greeting` with a message from the routine ("Good morning, Mom. Next: breakfast at 8"), then return to `idle` after 15 s. No risk event, no SMS
- Done when: arriving at the TV-room listener (or `/sim/room tv-room`) shows the greeting

### Step 8. Caregiver dashboard (Phase 1 to 2)

- Overview `/dashboard`: current room card, today's timeline of `location_events`, open `RiskCard`s (kind, room, state, **predicted or detected**, timers), listener health, patient screen online, tag-offline warning, a SIMULATED badge when the last event is `source = "sim"`, and an embedded mini-map linking to Nimai's 3D view
- `/dashboard/alerts`: alert log with context ("kitchen, 3 min, redirect played"), acknowledge status
- `/dashboard/routine`: editor with add, reorder, delete steps (time, title, room, photo from the scan's photos); record voice lines with `MediaRecorder` (use `audio/mp4` if WebM is unsupported) and upload to the `voice` bucket; four redirect voice slots (bedtime, kitchen, front door, morning greeting)
- `/dashboard/settings`: contacts, quiet hours, zone rules, escalation profile
- Night mode: warm charcoal tokens during quiet hours; amber means attention, red only for true emergencies
- `useRealtimeRows(table, householdId)` hook (initial select, subscription, de-duplicate by id)
- Done when: the overview updates live from real events and from `/sim/*`

### Step 9. Analytics (Phase 2)

- `monitor/actions/analytics.ts` and `GET /analytics/summary` compute from the DB and session files: events per night, rooms visited by hour, risk events by kind, outcomes (resolved without an alert vs escalated), median time to return after a redirect, lead time of predictions, false redirects, caregiver acknowledgement time, bathroom trips per night
- `supabase/seed/aarnav-history.ts`: seed 14 days of **synthetic, clearly labeled** nights (with a rising 3 AM kitchen trend) so the charts have something real to show
- `/dashboard/analytics`: night summary, weekly trend chart, heat of activity by hour, "3 AM kitchen visits 3x baseline for 2 weeks" insight, outcome breakdown. Label synthetic history "demo data". Print-friendly clinician summary (a stretch: a Claude-written weekly summary from the numbers)
- Done when: the page renders trends and today's real night next to the demo history

### Step 10. Stretch

- Breadcrumb lighting: light the path bedroom to bathroom (Kasa or Hue via the monitor) so allowed trips are safe
- Contextual bandit hookup with Vineet (use the `interventions` table)
- Backup contact call tree with a custom TwiML menu ("press 1: I'm up")
- Weekly Claude-written summary and clinician report PDF

## Branch acceptance test

1. `npm run typecheck && npm test && npm run build` pass
2. `npm run seed` fills a fresh project; the anon key can read `patient_state` and nothing else
3. `POST /debug/emit` of a night `location` kitchen creates a risk event, glows the patient screen (or the preview), then photo plus voice
4. With `ESCALATION_PROFILE=demo`, staying produces SMS then call then backup (logged under `TWILIO_DRY_RUN=1`); returning in time produces none
5. The dashboard overview updates live and shows SIMULATED for sim events

## Handoffs

| When | To | What |
|---|---|---|
| First hour | everyone | Keys, schema, seed, dashboard shell and nav stubs |
| Step 2 | Saran | `/routine` loading with `?h=` and the tap overlay (for device setup tests) |
| Gate 2 | Nimai | `risk` and `patient` events so the 3D view recolors |
| Gate 2 | Vineet | The voice and photo paths used for each redirect mode |
| Phase 2 | team | Analytics screenshots for the video |

## Debugging roadmap (actions, database, dashboard)

| Symptom | Likely cause | Check | Fix |
|---|---|---|---|
| Dashboard empty | RLS blocks the user or wrong household | Supabase logs; `HOUSEHOLD_ID` | Use the seeded household; fix the policy |
| Realtime never updates | Table not in the publication, or filter column missing | `select * from pg_publication_tables` | `alter publication supabase_realtime add table ...` |
| Duplicate rows in lists | Initial select plus subscription both insert | | De-duplicate by id |
| Anon reads other tables | RLS not enabled | `pg_class.relrowsecurity` | Enable on every table |
| Seed fails | Foreign key order | Error | households, contacts, rules, routines |
| `/routine` blank on the patient screen | Wrong `h`, or waiting on the tap overlay | Open it on the device | Tap once |
| No audio on `/routine` | Autoplay blocked, or the device is muted | Click the page; device volume | Re-show the tap overlay; turn the volume up |
| Audio plays twice or overlaps | Effect re-runs | | Depend on `mode` and `updatedAt`; pause in cleanup |
| Patient screen sleeps | Auto-lock or sleep | Device settings | Turn off auto-lock and sleep; keep it plugged in |
| Risk never fires | Rule hours do not include now | Print the rule match | Set quiet hours to include the current time |
| Risk fires for bathroom | Rule action not `allow` | `zone_rules` | Fix the seed |
| Predicted risk never cancels | Timer not cleared | Fake-timer test | One timer map per risk id |
| Returned in time but SMS still sent | "Safe room" test wrong | `[resp]` log | Safe = a room with no redirect rule |
| Timers double-fire | Not cleared on resolve or ack | Test | Clear all timers on resolve and ack |
| Twilio 21608 | Trial account, unverified number | Twilio console | Verify; use `TWILIO_DRY_RUN=1` while testing |
| Ack link 404 | `PUBLIC_BASE_URL` wrong | Open the link | Public URL or tunnel |
| 3D view does not recolor | `risk` bus events not emitted | `/ws/live` | Emit on every transition |
| Mic recording fails | Not https or permission denied | Prompt | Use localhost or https; allow the mic |
| Safari will not play recordings | WebM unsupported | `MediaRecorder.isTypeSupported` | Use `audio/mp4` |
| Hydration errors | Time-based render on the server | Console | Compute quiet hours client-side |
| Wrong night mode | Timezone | `households.timezone` | Convert with it |
| Analytics blank | No data or wrong date filter | Query | Seed history; check timezone |

## Starter prompt

> Read LANTERN_PROJECT_PLAN.md Parts 0 to 2 and Part 6. You are Aarnav. Start at step 1: the core database, seed, and the dashboard shell with stub pages, because the team is waiting for them. Then the patient screen and the responder. Do not edit files outside your ownership list. After each step run tests, commit as `a: step N`, and tell me what you need from others.

## Requests for others

- (fill in as you go)

---

# PART 7. Demo, video, Q&A and wrap-up

## Demo script (3 minutes)

Concept: **"3:07 AM."** Show the scary night, show the setup, then replay the same night with Lantern running. Everything shown is real or labeled simulated. The landing page already exists and opens the demo.

| Time | Beat | Notes |
|---|---|---|
| 0:00 to 0:20 | Cold open: dark hallway, slippers, a hand reaching for the stove, caregiver asleep. One wandering statistic (verify it before using). Title card | Show feet, hands and silhouettes, not acted confusion |
| 0:20 to 0:40 | The problem in a caregiver's voice (quote a real one if possible) | Quiet-room voiceover |
| 0:40 to 1:20 | Setup: RoomPlan scan, the 3D home appears, hazards pop up, accessibility check, mobility check; zone editor placing listeners | Nimai |
| 1:20 to 2:20 | "3:07 AM. Again." Split screen: footage plus the **3D view with the avatar walking** bedroom > hallway. "Predicted: kitchen 78%" in the hallway; the bedside screen glows, the family voice plays, the person turns back, the caregiver keeps sleeping. Then the escalation version: the caregiver's phone rings with context | Saran and Aarnav |
| 2:20 to 2:45 | Dashboard and analytics, the 3 AM trend, model metrics (baseline vs model, lead time, false redirects) | Vineet and Aarnav |
| 2:45 to 3:00 | Calm morning, pitch line, team name | |

**Pitch line:** "Wander alarms scream when the door opens. We respond first, with a familiar voice in a familiar home, and wake you only when it matters."

- **Judge-interactive moment:** a judge carries the tag phone toward the kitchen while the 3D avatar follows and the patient screen responds
- Film with the DJI Osmo Action 5 handheld at chest height, low-light mode, a small warm light in frame, 4K for cropping; DJI Mic for the voice. Record the real working run first (insurance), then retakes. Name clips `scene-take-date`
- **Edit (Vineet edits, Saran films, everyone provides screen recordings):** keep amber as the accent; captions on; overlay "Simulated" exactly when the simulator or a replay drove something; end with a one-line real vs simulated note
- Check the Hack Ohio rules (hardware policy, video length, tracks) and talk to 2 to 3 caregivers or professionals (an OT, OSU Nursing, the Alzheimer's Association Central Ohio chapter) to get a quote for the pitch

## Real vs simulated (say it precisely)

Real: the scan and home model, hazards, accessibility audit, BLE tag and listeners, classifier, HMM, position estimate, escalation, patient screen and phone alerts. Stand-ins: the tag is an iPhone, the listeners are laptops. Synthetic: predictor movement histories and the demo analytics history. If the simulator drove anything, say exactly what.

## Judge Q&A (about 20 seconds each; keep the dashboard running)

| Question | Answer |
|---|---|
| What's real vs simulated? | See above. Be exact |
| Why a phone as the tag? | A stand-in. Every source ends in the same location event, so a $10 beacon or wristband drops in |
| Why not use their phone? | People with dementia often leave it behind. Room sensors or a wearable track the person |
| Why the scan? | Real measurements for the audit, real photos for redirects, and the door graph the location model uses. The 3D view shows exactly where the person is in their own home |
| How accurate is the position? | Room-level is reliable; the exact spot in the room is approximate (about 2 to 3 m). The HMM uses the door graph to reject impossible jumps. We show accuracy against a strongest-signal baseline |
| Why not cameras? | Privacy and dignity. Room-level only, no cameras or audio after setup |
| Why not a door alarm? | It fires once the person is already leaving. Lantern responds first and wakes you only when it matters |
| Do homes have to meet ADA? | No. We use ADA and OT practice as a benchmark and mark borderline results to verify |
| What about bathroom trips? | Allowed and lit; only high-risk zones trigger a redirect |
| Won't a voice at night scare them? | Light first, then a family voice, and caregivers can turn it off. Redirects suggest, never restrain |
| What if they take off the tag? | A tag-offline alert fires, and per-room motion sensors need no wearable |
| Who checks the audit? | An occupational therapist. Lantern drafts, the OT decides |
| Is it a medical device? | No. It assists caregivers and does not replace supervision |
| Competitors? | SafelyYou, Vayyar, CarePredict and Nobi alert after the fact; we respond first, personalized to the home |
| Is the 3D their real home? | The structure is measured by LiDAR; the avatar is an estimate. Marble/splat layers (if shown) are labeled preview or capture |

## Cut order if time runs short

1. Splat, Marble, GLB conversion (Nimai step 10)
2. Contextual bandit, anomaly detection, ask-your-home, natural-language rules (Vineet step 9)
3. Weekly Claude summary, breadcrumb lighting, inbound SMS (Aarnav step 10)
4. iPhone listener mode, tag sensors, synthetic-RSSI sim (Saran step 10)
5. Multi-room merge (use the zone editor on one scanned space)
6. Destination predictor (keep detected redirects; show HMM and metrics)
7. Voice-call escalation (SMS only)

**Never cut:** scan > home model > 3D view with the live avatar; tag > room > redirect > alert; the simulator fallback; the dashboard showing both.

## Definition of done

- The live loop works with the real tag phone, and every part also works without Bluetooth through the simulator
- The 3D view shows the person moving through the home model as a live coordinate, with a trail, a predicted route and risk coloring
- Every simulated value is labeled
- The scan produces a home model, a prioritized fix list and an OT-reviewable report
- A teammate who has never seen the project can follow `docs/runbook.md` and start the whole system

## System-level debug (when you do not know which part is wrong)

Debug in layers from the tag outward. Find the first wrong layer and fix it before looking at later ones.

| Layer | Check | Tool | Owner of the fix |
|---|---|---|---|
| 1 Tag advertising | Another phone's scanner sees `LanternTag` | LightBlue | Saran |
| 2 Listener sees the tag | RSSI prints | `scan_test.py` | Saran |
| 3 Listener reaches the monitor | `[ws]` log lines, `/health` | monitor log | Saran |
| 4 Frame vector | Sensible dB per receiver, not all -100 | `GET /debug/vector` | Saran |
| 5 Room posterior and HMM | Correct room, no impossible jumps | `GET /debug/inference` | Vineet |
| 6 Position | Smooth, inside the room | `/debug/inference` raw vs smoothed | Vineet |
| 7 Home model | Rooms, doors, anchors correct | `GET /debug/world` | Nimai |
| 8 Live frames | Frames reach the browser | `/ws/live` in the network tab | Saran |
| 9 3D avatar | Moves smoothly, correct floor | `/dashboard/world` | Nimai |
| 10 Risk and responder | Risk event, timers | `GET /debug/state` | Aarnav |
| 11 Patient state and screen | `patient_state` changes, the patient screen updates | `POST /debug/patient` | Aarnav |
| 12 Alerts | SMS and call logged or sent | Twilio console, `TWILIO_DRY_RUN` log | Aarnav |

Log prefixes in the monitor: `[ws] [win] [knn] [hmm] [loc] [pos] [pred] [risk] [resp] [roku] [twilio] [world] [live]`.

## Honest future work (not for the hackathon)

Room sensors (ESP32 + ESPresense, mmWave LD2410) and a real wearable tag plug into the same `ListenerMsg` and bus events, so nothing downstream changes. UWB (two U1-or-newer iPhones with Nearby Interaction) and Wi-Fi CSI sensing could improve the in-room position. A mobile caregiver app, multi-patient households and clinician integrations come after validation.