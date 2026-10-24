import SwiftUI
import UserNotifications

struct TagView: View {
    @StateObject private var broadcaster = TagBroadcaster()
    @Environment(\.scenePhase) private var scenePhase
    @State private var secondsActive: Int = 0
    @State private var timer: Timer?

    var body: some View {
        VStack(spacing: 32) {
            Spacer()

            Circle()
                .fill(broadcaster.isAdvertising ? Color.green : Color.gray)
                .frame(width: 120, height: 120)
                .overlay(
                    Text(broadcaster.isAdvertising ? "ON" : "OFF")
                        .font(.title)
                        .fontWeight(.bold)
                        .foregroundColor(.white)
                )

            Text(broadcaster.isAdvertising ? "Advertising" : "Stopped")
                .font(.largeTitle)
                .fontWeight(.heavy)

            if broadcaster.isAdvertising {
                Text(formatTime(secondsActive))
                    .font(.title2)
                    .monospacedDigit()
            }

            Text(broadcaster.status)
                .font(.caption)
                .foregroundColor(.secondary)

            Text(TagBroadcaster.serviceUUID.uuidString)
                .font(.caption2)
                .foregroundColor(.secondary)
                .textSelection(.enabled)

            Spacer()

            Button(action: {
                if broadcaster.isAdvertising {
                    broadcaster.stop()
                    timer?.invalidate()
                    timer = nil
                } else {
                    broadcaster.start()
                    secondsActive = 0
                    timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { _ in
                        secondsActive += 1
                    }
                }
            }) {
                Text(broadcaster.isAdvertising ? "Stop" : "Start")
                    .font(.title2)
                    .fontWeight(.semibold)
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(broadcaster.isAdvertising ? Color.red : Color.blue)
                    .foregroundColor(.white)
                    .cornerRadius(16)
            }
            .padding(.horizontal, 40)

            Text("Keep this screen open.\nDo not switch apps.")
                .font(.footnote)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)

            Spacer()
        }
        .padding()
        .onChange(of: scenePhase) { _, newPhase in
            if newPhase != .active && broadcaster.isAdvertising {
                sendPausedNotification()
            }
        }
        .onAppear {
            requestNotificationPermission()
        }
    }

    private func formatTime(_ seconds: Int) -> String {
        let m = seconds / 60
        let s = seconds % 60
        return String(format: "%02d:%02d", m, s)
    }

    private func requestNotificationPermission() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in }
    }

    private func sendPausedNotification() {
        let content = UNMutableNotificationContent()
        content.title = "Lantern Tag Paused"
        content.body = "Return to the app to resume advertising."
        content.sound = .default
        let req = UNNotificationRequest(identifier: "tag-paused", content: content, trigger: nil)
        UNUserNotificationCenter.current().add(req)
    }
}
