# Lantern demo runbook

## Startup order

1. **Hotspot on.** Every device on the same network. Note the monitor laptop's IP.
2. **`npm run dev:monitor`** on the monitor laptop. Confirm `curl http://localhost:8787/health` responds.
3. **`npm run dev:web`** (or `npm run dev`) on the same laptop or open the Vercel URL. Dashboard at `http://localhost:3000/dashboard`.
4. **Listeners** on every laptop. One terminal per receiver:
   ```
   python listener/listener.py --id bedroom --token <LISTENER_TOKEN>
   python listener/listener.py --id hallway --token <LISTENER_TOKEN>
   python listener/listener.py --id kitchen --token <LISTENER_TOKEN>
   python listener/listener.py --id tv-room --token <LISTENER_TOKEN>
   ```
   Confirm all four show in `/health`.
5. **Patient routine** fullscreen on the Mac beside the Roku: open `/routine?h=<id>`, tap once for audio.
6. **Tag phone**: open the Lantern app, Tag tab, tap Start, enable Guided Access (triple-click side button). Hold in the trained hand position.

## Shutdown order

Reverse: stop tag, stop listeners, stop monitor, stop web, turn off hotspot.

## If X breaks, do Y

| Symptom | Fix |
|---|---|
| `scan_test.py` prints nothing | System Settings > Privacy & Security > Bluetooth: allow the terminal; restart it |
| Tag visible for seconds then gone | Phone locked or Auto-Lock on; disable Auto-Lock, enable Guided Access |
| Listener cannot connect | Wrong IP or firewall; `curl http://<ip>:8787/health` from listener laptop; use the hotspot |
| WebSocket closes at once (1008) | Token mismatch; same `LISTENER_TOKEN` everywhere |
| `/debug/vector` all -100 | Receiver ids do not match anchors; `--id` must match the slug in `fixtures/home-model.json` |
| RSSI barely changes between rooms | Zones too close, no walls between listeners; move apart, add foam board |
| 8-15 dB difference between laptops | Antenna variance; run calibration, apply `--offset` per listener |
| Laptop listener stops after 10 min | Laptop sleeps; plug in, run `caffeinate -dims` (macOS) or disable sleep (Windows) |
| IP changes between runs | DHCP lease changed; re-read `ifconfig`/`ipconfig` |
| `/ws/live` empty in browser | Mixed content (https page, http ws); run both on the laptop; check `NEXT_PUBLIC_MONITOR_WS` |
| Sim and BLE fight | Both emitting; 10s sim lock should handle it; check monitor logs for `source` |
| Monitor port in use | Another process on 8787; `MONITOR_PORT=8788 npm run dev:monitor` |

## Testing without Bluetooth

Use the simulator from the dashboard Devices tab or curl:

```bash
# Move to kitchen
curl -X POST http://localhost:8787/sim/room -H "Content-Type: application/json" -d '{"roomId":"kitchen"}'

# Move to coordinates
curl -X POST http://localhost:8787/sim/position -H "Content-Type: application/json" -d '{"x":200,"y":72}'

# Or run the mock RSSI tool that walks through rooms automatically
npm run dev:mock-rssi
```

## Recording a session

```bash
curl -X POST http://localhost:8787/record/start   # returns {session: "rec-..."}
# ... walk around ...
curl -X POST http://localhost:8787/record/stop     # saved to fixtures/sessions/<id>.jsonl
```

## Calibration data collection

1. Tag phone in the same hand and case as the demo, screen on
2. For each room walk slowly inside it for 2 minutes, including near doors and corners
3. 3 separate sessions per room at different times
4. 1 held-out test route: bedroom > hallway > kitchen > hallway > bedroom
5. Export to `fixtures/rssi-samples.csv` for Vineet's training

## Demo-day checklist

- [ ] Laptops charged, plugged in, lids open, sleep disabled
- [ ] Hotspot on; every device on it; monitor IP on tape
- [ ] Tag phone charged, screen on, Auto-Lock off, Lantern app foreground on the Tag tab, Guided Access on
- [ ] All listeners in `/health`; offsets applied
- [ ] `/routine` fullscreen on the TV; audio tapped; volume set
- [ ] Sim buttons open in a spare tab; a recorded run saved locally
