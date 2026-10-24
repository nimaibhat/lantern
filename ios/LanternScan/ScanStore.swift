import ARKit
import Foundation
import RoomPlan

// One room the user has scanned and not uploaded yet.
struct ScannedRoom: Identifiable {
    let id = UUID()
    let name: String
    let captured: CapturedRoom? // kept for StructureBuilder at upload time (nil only in the debug preview)
    let json: Data // CapturedRoom encoded with JSONEncoder
    let usdz: Data? // 3D model, optional
    let photos: [Data] // JPEGs
}

@MainActor
final class ScanStore: ObservableObject {
    // Every room is scanned on this one AR session, so all rooms share a coordinate system
    // and line up on the floor plan. Scan the whole home in one go without closing the app.
    let arSession = ARSession()

    @Published var rooms: [ScannedRoom] = []
    @Published var status = ""
    @Published var isBusy = false
    @Published var progress: Double? // 0...1 while uploading
    @Published var lastResult: UploadResult?
    @Published private(set) var householdName: String? = UserDefaults.standard.string(forKey: "householdName")

    var serverURL: String = UserDefaults.standard.string(forKey: "serverURL") ?? "http://192.168.1.10:3000"
    private var code: String = UserDefaults.standard.string(forKey: "pairCode") ?? ""

    struct UploadResult { let rooms: Int; let accessibilityItems: Int }

    static var isSupported: Bool { RoomCaptureSession.isSupported }

    init() {
        #if DEBUG
        // Launch with -LanternPreview to see the home screen with sample rooms (Simulator screenshots).
        if ProcessInfo.processInfo.arguments.contains("-LanternPreview") {
            householdName = "Demo home"
            rooms = [("Bedroom", 3), ("Hallway", 2), ("Kitchen", 4)].map {
                ScannedRoom(name: $0.0, captured: nil, json: Data(), usdz: nil, photos: Array(repeating: Data(), count: $0.1))
            }
        }
        #endif
    }

    func pair(server: String, code rawCode: String) async {
        let trimmed = server.trimmingCharacters(in: .whitespacesAndNewlines).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let code = rawCode.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        guard let url = URL(string: trimmed) else { status = "That server address is not valid."; return }

        isBusy = true
        defer { isBusy = false }
        do {
            let name = try await API(baseURL: url).pair(code: code)
            serverURL = trimmed
            self.code = code
            householdName = name
            status = ""
            UserDefaults.standard.set(trimmed, forKey: "serverURL")
            UserDefaults.standard.set(code, forKey: "pairCode")
            UserDefaults.standard.set(name, forKey: "householdName")
        } catch {
            status = error.localizedDescription
        }
    }

    func unpair() {
        householdName = nil
        rooms = []
        status = ""
        lastResult = nil
        ["pairCode", "householdName"].forEach { UserDefaults.standard.removeObject(forKey: $0) }
    }

    func add(_ room: CapturedRoom, name: String, photos: [Data]) {
        do {
            let json = try JSONEncoder().encode(room)
            let usdzURL = FileManager.default.temporaryDirectory.appendingPathComponent("\(UUID().uuidString).usdz")
            try? room.export(to: usdzURL, exportOptions: .parametric)
            let usdz = try? Data(contentsOf: usdzURL)
            rooms.append(ScannedRoom(name: name, captured: room, json: json, usdz: usdz, photos: photos))
            status = "\(name) saved."
        } catch {
            status = "Could not save \(name): \(error.localizedDescription)"
        }
    }

    func remove(_ room: ScannedRoom) {
        rooms.removeAll { $0.id == room.id }
    }

    // Apple's StructureBuilder aligns the rooms into one CapturedStructure, fixing drift between rooms and
    // removing walls that were scanned twice. If it fails (one room, or rooms it cannot place), the website
    // falls back to the per-room files, which already share a frame because they came from one AR session.
    private func mergedStructure() async -> Data? {
        guard rooms.count > 1 else { return nil }
        do {
            let builder = StructureBuilder(options: [.beautifyObjects])
            let structure = try await builder.capturedStructure(from: rooms.compactMap(\.captured))
            return try JSONEncoder().encode(structure)
        } catch {
            print("StructureBuilder failed, uploading rooms separately:", error.localizedDescription)
            return nil
        }
    }

    func upload() async {
        guard let url = URL(string: serverURL), !rooms.isEmpty else { return }
        let api = API(baseURL: url)
        isBusy = true
        lastResult = nil
        defer {
            isBusy = false
            progress = nil
        }

        // Progress counts files: the merged structure, then each room's JSON, model and photos.
        let total = Double(1 + rooms.reduce(0) { $0 + 2 + $1.photos.count })
        var sent = 0.0
        let step = { sent += 1; self.progress = min(1, sent / total) }

        do {
            progress = 0
            status = "Merging rooms..."
            let structure = await mergedStructure()

            status = "Preparing upload..."
            let scan = try await api.createScan(code: code, rooms: rooms.map { .init(name: $0.name, photos: $0.photos.count) })
            if let structure, let structureURL = scan.structure {
                try await api.upload(structure, to: structureURL, contentType: "application/json")
            }
            step()

            for (index, (room, urls)) in zip(rooms, scan.rooms).enumerated() {
                status = "Uploading \(room.name) (\(index + 1) of \(rooms.count))..."
                try await api.upload(room.json, to: urls.json, contentType: "application/json")
                step()
                if let usdz = room.usdz {
                    try await api.upload(usdz, to: urls.usdz, contentType: "model/vnd.usdz+zip")
                }
                step()
                for (photo, photoURL) in zip(room.photos, urls.photos) {
                    try await api.upload(photo, to: photoURL, contentType: "image/jpeg")
                    step()
                }
            }

            status = "Building the floor plan..."
            let result = try await api.process(scanId: scan.scanId, code: code)
            rooms = []
            status = ""
            lastResult = UploadResult(rooms: result.rooms, accessibilityItems: result.accessibilityItems)
        } catch {
            status = "Upload failed: \(error.localizedDescription)"
        }
    }
}
