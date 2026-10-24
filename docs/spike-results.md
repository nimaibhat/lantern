# Spike: Real BLE on the Dashboard

Date: 2026-10-23

## Goal

Replace all fake/mock data paths with live monitor WebSocket data and confirm the full stack works end-to-end before pushing.

## What was done

### 1. Live RSSI broadcast (live-rssi)
- `monitor/server.ts`: Added bus listener for `frame` events that broadcasts per-receiver `listener` LiveFrames with RSSI to `/ws/live`.
- `app/dashboard/devices/page.tsx`: Rewrote to show live dBm per receiver, signal strength bars, source badges (ble/sim), connection status, and anchor assignment status.

### 2. Nearest-room estimator (nearest-room)
- `monitor/sensing/nearest.ts`: New module. Listens to `frame` bus events, picks the online receiver with the strongest RSSI, emits `position` and `location` with `source: "ble"`.
- Respects the sim lock guard (10s block after sim events).
- Registered in `monitor/sensing/index.ts`.
- Enabled by default; disable with `NEAREST_ROOM=0`.

### 3. Overview wired to monitor (overview-live)
- `app/dashboard/_components/use-monitor-live.ts`: New hook replacing `useMockLive`. Connects to `/ws/live`, receives location/position/risk events, maintains the same API shape.
- `app/dashboard/_components/overview.tsx`: Switched from `useMockLive` to `useMonitorLive`. Shows "live" / "offline" badge based on WebSocket connection. Receiver count from live data when connected, SSR data as fallback.

### 4. Assign devices to rooms (assign-devices)
- `monitor/world/index.ts`: Added `/world/rooms` (GET), `/world/assign` (POST), `/world/unassign` (POST) endpoints. Assign persists to `home-model.json`.
- Devices page loads rooms dynamically from monitor. Assign/remove buttons update the home model. Simulator room dropdown loads from monitor.

### 5. Test infrastructure fixes
- Fixed `close()` in `monitor/server.ts` to call `ingest.stop()`, preventing the test process from hanging on the 1s frame interval.

## Test results

### Automated
- `npm test`: 9/9 pass (geometry, bus, server health, WS snapshot, sim room, sim lock, bad input). Process exits cleanly.
- RSSI window tests: 6/6 pass (now part of `npm test`).
- `npx tsc --noEmit`: Clean.

### Manual (mock RSSI simulator)
- Started `npm run dev:monitor` and `npm run dev` (Next.js).
- Mock RSSI simulator (`npm run dev:mock-rssi`) connects 4 virtual listeners and walks a fake tag.
- **Devices page**: Shows all 4 receivers with live RSSI values, signal bars, Online status, anchor assignment. Nearest listener highlighted. Source badge shows "ble". Room updates as tag walks.
- **Overview page**: Floor plan highlights the correct room. "Rosa is in the [Room]" updates in real-time. Receiver count shows 4/3 online (from monitor). No more fake browser-only room walk.
- **Assign UI**: Can add/remove listeners. Changes persist to `home-model.json`.

### Real BLE (LightBlue)
Not yet tested. Requires:
1. Install LightBlue on iPhone.
2. Create a virtual peripheral advertising UUID `4C414E54-4552-4E00-A000-000000000001`.
4. Walk the phone between rooms and observe RSSI changes on the Devices page.

## Files changed
- `monitor/server.ts` - RSSI broadcast + close fix
- `monitor/sensing/nearest.ts` - NEW: nearest-room estimator
- `monitor/sensing/index.ts` - register nearest
- `monitor/world/index.ts` - rooms/assign/unassign endpoints
- `app/dashboard/devices/page.tsx` - live RSSI, assign UI
- `app/dashboard/_components/use-monitor-live.ts` - NEW: real monitor hook
- `app/dashboard/_components/overview.tsx` - switched to useMonitorLive

## What's next
- Real BLE test with LightBlue + listener laptops
- Vineet's room classifier to replace the nearest-listener heuristic
- Aarnav's risk engine + Twilio alerts in the actions module
- Calibration UI with real RSSI capture
