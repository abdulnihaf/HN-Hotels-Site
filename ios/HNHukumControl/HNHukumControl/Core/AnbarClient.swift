import Foundation

// Anbar inventory chamber — anbar.hnhotels.in. action=live is the conservation engine (public read).
// Read-only: we only ever GET. The shared Diwan token rides along as x-darbar-token (the contract's
// convention; this endpoint is public, but the chain's gated actions reuse the same header).
actor AnbarClient {
    static let shared = AnbarClient()
    private let base = "https://anbar.hnhotels.in"
    private let decoder = JSONDecoder()

    func live(token: String?) async throws -> AnbarLiveResponse {
        let data = try await request(path: "/api/anbar", query: ["action": "live"], token: token)
        return try decoder.decode(AnbarLiveResponse.self, from: data)
    }

    private func request(path: String, query: [String: String] = [:], token: String?) async throws -> Data {
        guard var c = URLComponents(string: base) else { throw AnbarError.badURL }
        c.path = path
        if !query.isEmpty { c.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) } }
        guard let url = c.url else { throw AnbarError.badURL }
        var req = URLRequest(url: url)
        req.timeoutInterval = 12
        if let token, !token.isEmpty { req.setValue(token, forHTTPHeaderField: "x-darbar-token") }
        let (data, resp) = try await URLSession.shared.data(for: req)
        if let http = resp as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw AnbarError.server("Anbar HTTP \(http.statusCode)")
        }
        if data.isEmpty { throw AnbarError.server("Empty Anbar response") }
        return data
    }
}

enum AnbarError: LocalizedError {
    case badURL
    case server(String)

    var errorDescription: String? {
        switch self {
        case .badURL: return "Bad Anbar URL"
        case .server(let m): return m
        }
    }
}
