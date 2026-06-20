import Foundation

actor HukumClient {
    static let shared = HukumClient()

    private let decoder = JSONDecoder()
    private let encoder = JSONEncoder()

    func state() async throws -> HukumStateResponse {
        let data = try await request(path: "/api/hukm/state")
        return try decoder.decode(HukumStateResponse.self, from: data)
    }

    func sessions() async throws -> [HukumSession] {
        let data = try await request(path: "/api/sessions")
        // /api/sessions returns a bare JSON array of session objects.
        return try decoder.decode([HukumSession].self, from: data)
    }

    func selectLane(alias: String) async throws -> HukumLaneState? {
        let data = try await request(path: "/api/lane/select", query: ["alias": alias])
        struct Response: Codable { var ok: Bool; var lane: HukumLaneState?; var error: String? }
        let response = try decoder.decode(Response.self, from: data)
        if !response.ok { throw HukumError.server(response.error ?? "Lane select failed") }
        return response.lane
    }

    func sendPrompt(_ text: String) async throws -> HukumJobEnvelope {
        let data = try await request(path: "/api/hukm", method: "POST", body: ["text": text])
        let response = try decoder.decode(HukumJobEnvelope.self, from: data)
        if !response.ok { throw HukumError.server(response.error ?? "Hukum send failed") }
        return response
    }

    func latest(for spokenLane: String) async throws -> HukumLatestResponse {
        let data = try await request(
            path: "/api/hukm/latest",
            query: ["format": "json", "text": spokenLane]
        )
        let response = try decoder.decode(HukumLatestResponse.self, from: data)
        if !response.ok { throw HukumError.server(response.note ?? "Latest answer failed") }
        return response
    }

    func latestBySession(_ session: String) async throws -> HukumLatestResponse {
        let data = try await request(path: "/api/latest", query: ["session": session])
        return try decoder.decode(HukumLatestResponse.self, from: data)
    }

    func speechData(session: String) async throws -> Data {
        try await request(path: "/api/speak", query: ["session": session], expectsJSON: false)
    }

    func speechData(text: String) async throws -> Data {
        try await request(path: "/api/speak", query: ["text": text], expectsJSON: false)
    }

    func registerNativePushToken(_ token: String) async {
        guard !token.isEmpty else { return }
        do {
            _ = try await request(path: "/api/ios/register", method: "POST", body: [
                "platform": "ios",
                "apns_token": token
            ])
        } catch {
            HukumLog.shared.add("Native push token not registered yet: \(error.localizedDescription)")
        }
    }

    private func request(
        path: String,
        query: [String: String] = [:],
        method: String = "GET",
        body: [String: String]? = nil,
        expectsJSON: Bool = true
    ) async throws -> Data {
        let settings = HukumSettings.shared
        guard var components = URLComponents(string: settings.bridgeURL) else {
            throw HukumError.badURL
        }
        components.path = path
        var items = query.map { URLQueryItem(name: $0.key, value: $0.value) }
        if !settings.authToken.isEmpty {
            items.append(URLQueryItem(name: "t", value: settings.authToken))
        }
        components.queryItems = items
        guard let url = components.url else { throw HukumError.badURL }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 18
        if let body {
            request.httpBody = try encoder.encode(body)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let (data, response) = try await URLSession.shared.data(for: request)
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            let message = String(data: data, encoding: .utf8) ?? "HTTP \(http.statusCode)"
            throw HukumError.server(message)
        }
        if expectsJSON, data.isEmpty {
            throw HukumError.server("Empty Hukum response")
        }
        return data
    }
}

enum HukumError: LocalizedError {
    case badURL
    case server(String)

    var errorDescription: String? {
        switch self {
        case .badURL: return "Bridge URL is invalid."
        case .server(let message): return message
        }
    }
}

