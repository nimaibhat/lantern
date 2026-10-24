# Lantern Scan (iPhone app)

A small companion app that scans the home with Apple RoomPlan and uploads it to the Lantern website.
It holds no API keys. It only talks to the website, using a pairing code from the dashboard.

```
Pair (code from Dashboard > Settings) -> name a room -> scan it (tap the camera 2 to 4 times) -> repeat -> Upload
```

The website then builds the floor plan, runs the accessibility rules immediately, and runs the Claude photo check in the background.

## Requirements

- An iPhone with LiDAR: iPhone 12 Pro or newer **Pro** model (or an iPad Pro from 2020 on), on iOS 17 or later
- A Mac with Xcode
- A free Apple ID (no paid developer account needed; the app has to be reinstalled every 7 days)

## Set up the Xcode project (one time)

1. Xcode > File > New > Project > **iOS App**.
   - Product name: `LanternScan`, Interface: **SwiftUI**, Language: **Swift**, no tests.
   - Save it anywhere **outside** this repo (or in `ios/` and add the `.xcodeproj` later). Xcode's build folders should not be committed.
2. Delete the generated `ContentView.swift` and `LanternScanApp.swift`.
3. Drag every `.swift` file from `ios/LanternScan/` **and the `Fonts` folder** into the project. Choose **Reference files in place** (or copy them) and tick the app target for all of them. The fonts register themselves at launch, so there is no font entry to add to Info.plist.
4. Target > **General**: set Minimum Deployments to **iOS 17.0**.
5. Target > **Signing & Capabilities**: Team = your Apple ID (Personal Team). Change the bundle identifier if Xcode complains, e.g. `com.yourname.lanternscan`.
6. Target > **Info** (Custom iOS Target Properties), add:

   | Key | Value |
   |---|---|
   | Privacy - Camera Usage Description | `Lantern Scan uses the camera to measure your rooms.` |
   | Privacy - Local Network Usage Description | `Lantern Scan connects to the Lantern website on your network.` |
   | App Transport Security Settings > Allow Arbitrary Loads | `YES` (only needed for a plain `http://` dev server; remove it once the site is on https) |

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
| `LanternScanApp.swift` | App entry; registers the fonts, shows pairing or the home screen |
| `Theme.swift` | The website's look: warm stone and walnut colors (light and dark), amber accent, Tomorrow and Geist fonts, cards, buttons and chips |
| `Fonts/` | Tomorrow, Geist and Geist Mono (SIL Open Font License, see the OFL files) |
| `ScanStore.swift` | App state: pairing, scanned rooms, the shared AR session, upload |
| `API.swift` | The three calls to the website and the file uploads |
| `PairView.swift` | Enter the website address and pairing code |
| `HomeView.swift` | Name rooms, start scans, upload |
| `RoomScanView.swift` | Wraps Apple's `RoomCaptureView`, takes photos from the AR camera |

## Preview without a LiDAR phone

The pairing, home and upload screens run in the iOS Simulator (scanning itself needs LiDAR). In a debug build, launch with the argument `-LanternPreview` (Xcode: Product > Scheme > Edit Scheme > Arguments) to see the home screen with three sample rooms.

## If something breaks

- **"No such module RoomPlan" or LiDAR message:** the device has no LiDAR, or the deployment target is below iOS 17.
- **Pair fails with a network error:** check the address, the Wi-Fi, and the Local Network permission (Settings > Lantern Scan).
- **Upload works but the floor plan looks wrong:** send the uploaded `room-0.json` (Supabase > Storage > scans) so the parser in `lib/scan/parse.ts` can be adjusted. It was written against RoomPlan's documented JSON shape and a synthetic fixture, not a real scan yet.
