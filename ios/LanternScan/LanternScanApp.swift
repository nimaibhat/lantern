import SwiftUI

// Lantern: the one phone app. Scan maps the home with RoomPlan and uploads it to the Lantern website (it holds no
// API keys and talks only to the website, using a pairing code from the dashboard). Tag broadcasts the Bluetooth
// signal the room listeners hear; it needs no pairing and works on phones without LiDAR.

@main
struct LanternScanApp: App {
    @StateObject private var store = ScanStore()

    init() {
        Theme.registerFonts()
    }

    var body: some Scene {
        WindowGroup {
            TabView {
                Group {
                    if store.householdName == nil {
                        PairView()
                    } else {
                        HomeView()
                    }
                }
                .tabItem { Label("Scan", systemImage: "viewfinder") }

                TagView()
                    .tabItem { Label("Tag", systemImage: "dot.radiowaves.left.and.right") }
            }
            .environmentObject(store)
            .tint(Theme.accent)
        }
    }
}
