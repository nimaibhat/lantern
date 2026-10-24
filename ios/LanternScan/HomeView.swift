import SwiftUI

// Main screen: name a room, scan it, repeat, then upload everything at once.
struct HomeView: View {
    @EnvironmentObject private var store: ScanStore
    @State private var roomName = ""
    @State private var scanning = false

    private let suggestions = ["Bedroom", "Bathroom", "Hallway", "Kitchen", "Living room", "Front door"]
    private var trimmedName: String { roomName.trimmingCharacters(in: .whitespaces) }

    var body: some View {
        ZStack {
            Theme.bg.ignoresSafeArea()

            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    header
                    if !ScanStore.isSupported { unsupported }
                    if let result = store.lastResult { done(result) }
                    nextRoom
                    if !store.rooms.isEmpty { readyToUpload }
                    tips
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 40)
            }
        }
        .fullScreenCover(isPresented: $scanning) {
            RoomScanView(arSession: store.arSession, roomName: trimmedName) { room, photos in
                if let room { store.add(room, name: trimmedName, photos: photos) }
                roomName = ""
                scanning = false
            }
            .ignoresSafeArea()
        }
    }

    private var header: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 6) {
                Eyebrow(text: store.householdName ?? "Lantern")
                Text("Scan the home").font(Theme.heading(32)).foregroundStyle(Theme.text)
            }
            Spacer()
            Button("Unpair") { store.unpair() }.buttonStyle(GhostButtonStyle())
        }
        .padding(.top, 24)
    }

    private var unsupported: some View {
        Card {
            Label("No LiDAR on this device", systemImage: "exclamationmark.triangle")
                .font(Theme.body(16, weight: .medium))
                .foregroundStyle(Theme.alert)
            Text("RoomPlan needs an iPhone Pro (12 Pro or newer) or an iPad Pro. You can still pair and look around.")
                .font(Theme.body(14))
                .foregroundStyle(Theme.muted)
        }
    }

    private var nextRoom: some View {
        Card {
            Eyebrow(text: store.rooms.isEmpty ? "First room" : "Next room")
            ThemedField(title: "", text: $roomName, placeholder: "Room name, like Bedroom")

            // Quick picks: the names the dashboard, routine and live view understand.
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(suggestions, id: \.self) { name in
                        Chip(label: name, selected: trimmedName == name) { roomName = name }
                    }
                }
            }

            Button {
                scanning = true
            } label: {
                Label("Scan \(trimmedName.isEmpty ? "this room" : trimmedName)", systemImage: "viewfinder")
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(trimmedName.isEmpty || !ScanStore.isSupported || store.isBusy)
        }
    }

    private var readyToUpload: some View {
        Card {
            HStack {
                Eyebrow(text: "Ready to upload")
                Spacer()
                Text("\(store.rooms.count) \(store.rooms.count == 1 ? "room" : "rooms")").font(Theme.mono(12)).foregroundStyle(Theme.muted)
            }

            VStack(spacing: 0) {
                ForEach(store.rooms) { room in
                    HStack(spacing: 12) {
                        Image(systemName: "square.dashed").foregroundStyle(Theme.accent)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(room.name).font(Theme.heading(18)).foregroundStyle(Theme.text)
                            Text("\(room.photos.count) \(room.photos.count == 1 ? "photo" : "photos")").font(Theme.mono(12)).foregroundStyle(Theme.muted)
                        }
                        Spacer()
                        Button { store.remove(room) } label: {
                            Image(systemName: "xmark").font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.muted).padding(8)
                        }
                        .disabled(store.isBusy)
                        .accessibilityLabel("Remove \(room.name)")
                    }
                    .padding(.vertical, 10)
                    if room.id != store.rooms.last?.id { Divider().overlay(Theme.border) }
                }
            }

            if let progress = store.progress {
                VStack(alignment: .leading, spacing: 6) {
                    ProgressView(value: progress).tint(Theme.accent)
                    Text(store.status).font(Theme.body(13)).foregroundStyle(Theme.muted)
                }
            } else if !store.status.isEmpty {
                Text(store.status).font(Theme.body(13)).foregroundStyle(store.status.hasPrefix("Upload failed") ? Theme.alert : Theme.muted)
            }

            Button {
                Task { await store.upload() }
            } label: {
                Label(store.isBusy ? "Uploading..." : "Upload \(store.rooms.count) \(store.rooms.count == 1 ? "room" : "rooms")", systemImage: "arrow.up.circle")
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(store.isBusy)
        }
    }

    private func done(_ result: ScanStore.UploadResult) -> some View {
        Card {
            Label("Home uploaded", systemImage: "checkmark.circle.fill")
                .font(Theme.heading(20))
                .foregroundStyle(Theme.ok)
            Text("\(result.rooms) rooms and \(result.accessibilityItems) accessibility notes. Photo hazards appear on the dashboard in about a minute.")
                .font(Theme.body(15))
                .foregroundStyle(Theme.muted)
            if let url = URL(string: "\(store.serverURL)/dashboard/world") {
                Link(destination: url) { Label("Open the 3D home", systemImage: "cube") }
                    .buttonStyle(GhostButtonStyle())
            }
        }
    }

    private var tips: some View {
        VStack(alignment: .leading, spacing: 8) {
            Eyebrow(text: "Tips")
            tip("figure.walk", "Walk slowly along the walls and point at the corners.")
            tip("camera", "Tap the camera 2 to 4 times per room for the hazard check.")
            tip("link", "Scan every room in one go so they line up on the map.")
        }
        .padding(.horizontal, 4)
    }

    private func tip(_ icon: String, _ text: String) -> some View {
        Label(text, systemImage: icon).font(Theme.body(14)).foregroundStyle(Theme.muted)
    }
}
