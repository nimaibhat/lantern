# Lantern (iPhone app)

One app with two tabs. **Scan** maps the home with Apple RoomPlan and uploads it to the Lantern website; it holds
no API keys and only talks to the website, using a pairing code from the dashboard. **Tag** broadcasts the Bluetooth
signal the room listeners hear; it needs no pairing.

```
Pair (code from Dashboard > Settings) -> name a room -> scan it (tap the camera 2 to 4 times) -> repeat -> Upload
```

The website then builds the floor plan, runs the accessibility rules immediately, and runs the Claude photo check in the background.

## Requirements

- An iPhone with LiDAR: iPhone 12 Pro or newer **Pro** model (or an iPad Pro from 2020 on), on iOS 17 or later (scanning only; the Tag tab works on any iPhone on iOS 17)
- A Mac with Xcode
- A free Apple ID (no paid developer account needed; the app has to be reinstalled every 7 days)

## Set up the Xcode project (one time)

The project is generated from `ios/project.yml` (one app, Lantern, with a Scan tab and a Tag tab), so there is nothing to set up by hand.

```bash
brew install xcodegen   # once
cd ios && xcodegen      # writes ios/Lantern.xcodeproj (not committed)
open Lantern.xcodeproj
```

1. Xcode > Settings > Accounts: add your Apple ID (a free one works).
2. Target LanternScan > Signing & Capabilities > Team = your Personal Team. Regenerating resets this unless you put your team id in `DEVELOPMENT_TEAM` in `project.yml`.
3. If Xcode says the bundle identifier is taken, change `PRODUCT_BUNDLE_IDENTIFIER` in `project.yml` and run `xcodegen` again.

Camera, local network and Bluetooth permissions, the iOS 17 target and the fonts are all in `project.yml`. `LanternScan/Info.plist` only allows plain `http://` to the dev server; remove that once the site is on https.

## Run it on your iPhone

1. Plug in the iPhone and trust the computer. On the phone: Settings > Privacy & Security > **Developer Mode** on (it restarts).
2. In Xcode, pick your iPhone as the run destination and press Run.
3. First launch only: Settings > General > VPN & Device Management > your Apple ID > **Trust**.

## Connect it to the website

1. On the Mac: `npm run dev` in the repo. The terminal prints a **Network** address, like `http://192.168.1.23:3000`. The phone must be on the same Wi-Fi.
2. In the dashboard: Settings > Scanning app > **Pair a phone**. A 6-character code appears (valid for 24 hours).
3. In the app: enter the network address and the code, then tap Pair.

If the phone cannot reach the Mac (some school and venue Wi-Fi blocks this), deploy the site to Vercel, or run a tunnel such as `npx cloudflared tunnel --url http://localhost:3000`, and use that https address instead.

## Scanning tips

- Scan every room in **one session** without closing the app. All rooms share one AR session, and on upload Apple's `StructureBuilder` merges them into one aligned structure (`structure.json`). If the merge fails, the website uses the per-room files, which still line up because they share the session.
- Walk slowly along the walls and point the phone at the corners, doors, and furniture.
- Tap the camera button 2 to 4 times per room to capture photos for the hazard check.
- Name rooms the same way each time ("Bedroom", "Hallway"). A room with an existing name is updated in place, so receivers and routine steps stay linked.

## Files

| File | What it does |
|---|---|
| `LanternScanApp.swift` | App entry; registers the fonts; Scan tab (pairing or the home screen) and Tag tab |
| `Theme.swift` | The website's look: warm stone and walnut colors (light and dark), amber accent, Tomorrow and Geist fonts, cards, buttons and chips |
| `Fonts/` | Tomorrow, Geist and Geist Mono (SIL Open Font License, see the OFL files) |
| `ScanStore.swift` | App state: pairing, scanned rooms, the shared AR session, upload |
| `API.swift` | The three calls to the website and the file uploads |
| `PairView.swift` | Enter the website address and pairing code |
| `HomeView.swift` | Name rooms, start scans, upload |
| `RoomScanView.swift` | Wraps Apple's `RoomCaptureView`, takes photos from the AR camera |
| `TagView.swift` | Tag tab: Start and Stop, time on air, a warning if the app leaves the foreground |
| `TagBroadcaster.swift` | Advertises the Bluetooth service UUID and the name `LanternTag` that the listeners look for |

## Preview without a LiDAR phone

The pairing, home and upload screens run in the iOS Simulator (scanning itself needs LiDAR). In a debug build, launch with the argument `-LanternPreview` (Xcode: Product > Scheme > Edit Scheme > Arguments) to see the home screen with three sample rooms.

## If something breaks

- **"No such module RoomPlan" or LiDAR message:** the device has no LiDAR, or the deployment target is below iOS 17.
- **Pair fails with a network error:** check the address, the Wi-Fi, and the Local Network permission (Settings > Lantern Scan).
- **Upload works but the floor plan looks wrong:** send the uploaded `room-0.json` (Supabase > Storage > scans) so the parser in `lib/world/parse.ts` can be adjusted. It was written against RoomPlan's documented JSON shape and a synthetic fixture, not a real scan yet.
