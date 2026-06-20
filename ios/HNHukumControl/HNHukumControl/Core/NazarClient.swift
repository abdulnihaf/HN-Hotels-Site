import Foundation

actor NazarClient {
    static let shared = NazarClient()

    private let decoder = JSONDecoder()

    func health() async throws -> NazarHealthResponse {
        let data = try await request(path: "/health.json")
        return try decoder.decode(NazarHealthResponse.self, from: data)
    }

    func heLive() async throws -> NazarHELiveResponse {
        let data = try await request(path: "/he/live.json")
        return try decoder.decode(NazarHELiveResponse.self, from: data)
    }

    func nchLive() async throws -> NazarNCHLiveResponse {
        let data = try await request(path: "/nch/live.json")
        return try decoder.decode(NazarNCHLiveResponse.self, from: data)
    }

    func heFlags() async throws -> NazarFlagsResponse {
        let data = try await request(path: "/he/flags.json")
        return try decoder.decode(NazarFlagsResponse.self, from: data)
    }

    func frameStatus(for camera: NazarCamera) async throws -> NazarFrameStatus {
        let (_, response) = try await requestWithResponse(
            path: "/nz/latest.jpg",
            query: ["cam": camera.id, "_": String(Int(Date().timeIntervalSince1970))]
        )
        let http = response as? HTTPURLResponse
        return NazarFrameStatus(
            camera: camera,
            httpStatus: http?.statusCode ?? 0,
            frameState: http?.value(forHTTPHeaderField: "X-Nazar-Frame-State") ?? "",
            contentType: http?.value(forHTTPHeaderField: "Content-Type") ?? "",
            checkedAt: Date()
        )
    }

    // Live still-frame snapshot for a camera. VERIFIED endpoint on the RTX box:
    // GET /nz/latest.jpg?cam=<id> -> image/jpeg from a disk-backed frame cache
    // (answers in ~0.5–7ms; carries X-Nazar-Frame-Age-Ms / X-Nazar-Frame-State).
    // `bust` forces a cache-busting query so AsyncImage re-fetches a fresh frame.
    nonisolated static func snapshotURL(for camera: NazarCamera, bust: Int? = nil) -> URL? {
        var components = URLComponents(string: HukumSettings.shared.nazarURL)
        components?.path = "/nz/latest.jpg"
        var items = [URLQueryItem(name: "cam", value: camera.id)]
        if let bust { items.append(URLQueryItem(name: "_", value: String(bust))) }
        components?.queryItems = items
        return components?.url
    }

    nonisolated static func deepLinkURL(for camera: NazarCamera) -> URL? {
        var components = URLComponents(string: HukumSettings.shared.nazarURL)
        components?.path = camera.brand.routePath
        components?.queryItems = [URLQueryItem(name: "cam", value: camera.id)]
        return components?.url
    }

    nonisolated static func brandURL(_ brand: NazarBrand) -> URL? {
        var components = URLComponents(string: HukumSettings.shared.nazarURL)
        components?.path = brand.routePath
        return components?.url
    }

    private func request(path: String, query: [String: String] = [:]) async throws -> Data {
        let (data, response) = try await requestWithResponse(path: path, query: query)
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw HukumError.server("Nazar HTTP \(http.statusCode)")
        }
        if data.isEmpty { throw HukumError.server("Empty Nazar response") }
        return data
    }

    private func requestWithResponse(path: String, query: [String: String] = [:]) async throws -> (Data, URLResponse) {
        guard var components = URLComponents(string: HukumSettings.shared.nazarURL) else {
            throw HukumError.badURL
        }
        components.path = path
        if !query.isEmpty {
            components.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) }
        }
        guard let url = components.url else { throw HukumError.badURL }
        var request = URLRequest(url: url)
        request.timeoutInterval = 8
        return try await URLSession.shared.data(for: request)
    }
}
