import SwiftUI

// Lantern Scan: a small companion app that scans the home with RoomPlan and uploads it to the Lantern website.
// It holds no API keys. It talks only to the website, using a pairing code from the dashboard.

@main
struct LanternScanApp: App {
    @StateObject private var store = ScanStore()

    init() {
        Theme.registerFonts()
    }

    var body: some Scene {
        WindowGroup {
            Group {
                if store.householdName == nil {
                    PairView()
                } else {
                    HomeView()
                }
            }
            .environmentObject(store)
            .tint(Theme.accent)
        }
    }
}
