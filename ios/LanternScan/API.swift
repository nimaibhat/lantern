import Foundation

// The three calls the app makes to the Lantern website (see app/api in the repo).
// 1. POST /api/pair                 check the pairing code
// 2. POST /api/scans                get one signed upload URL per file, then PUT each file to Supabase
// 3. POST /api/scans/{id}/process   build the floor plan and run the audits

struct API {
    let baseURL: URL

    struct RoomRequest: Encodable { let name: String; let photos: Int }
    struct RoomUploads: Decodable { let name: String; let json: URL; let usdz: URL; let photos: [URL] }
    // structure: where the merged CapturedStructure goes (StructureBuilder output), uploaded when the merge works.
    struct ScanResponse: Decodable { let scanId: String; let rooms: [RoomUploads]; let structure: URL? }
    struct ProcessResponse: Decodable { let rooms: Int; let accessibilityItems: Int }
    private struct PairResponse: Decodable { let householdName: String }
    private struct ErrorResponse: Decodable { let error: String }

    struct ServerError: LocalizedError {
        let message: String
        var errorDescription: String? { message }
    }

    func pair(code: String) async throws -> String {
        let response: PairResponse = try await post("api/pair", ["code": code])
        return response.householdName
    }

    func createScan(code: String, rooms: [RoomRequest]) async throws -> ScanResponse {
        struct Body: Encodable { let code: String; let rooms: [RoomRequest] }
        return try await post("api/scans", Body(code: code, rooms: rooms))
    }

    func process(scanId: String, code: String) async throws -> ProcessResponse {
        try await post("api/scans/\(scanId)/process", ["code": code])
    }

    // Signed URLs accept the raw file as the body of a PUT.
    func upload(_ data: Data, to url: URL, contentType: String) async throws {
        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        request.setValue(contentType, forHTTPHeaderField: "Content-Type")
        let (body, response) = try await URLSession.shared.upload(for: request, from: data)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw ServerError(message: "Upload failed: \(String(data: body, encoding: .utf8) ?? "unknown error")")
        }
    }

    private func post<Body: Encodable, Result: Decodable>(_ path: String, _ body: Body) async throws -> Result {
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)
        request.timeoutInterval = 60

        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            let message = (try? JSONDecoder().decode(ErrorResponse.self, from: data))?.error ?? "Server returned \(status)"
            throw ServerError(message: message)
        }
        return try JSONDecoder().decode(Result.self, from: data)
    }
}
