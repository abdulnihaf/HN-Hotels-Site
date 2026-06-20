import Foundation

// Darbar API client. Base URL hardcoded per chamber convention.
// Auth = a 12h HMAC token minted from a PIN, carried as the x-darbar-token header on every read.
actor DarbarClient {
    static let shared = DarbarClient()

    // Hardcoded base — Darbar lives on its own subdomain.
    static let base = "https://darbar.hnhotels.in"

    private let decoder = JSONDecoder()

    // POST ?action=auth {"pin":…} → mint a token. This is the ONLY write allowed (auth handshake).
    func auth(pin: String) async throws -> DarbarAuthResponse {
        guard var c = URLComponents(string: Self.base) else { throw DarbarError.badURL }
        c.path = "/api/darbar"
        c.queryItems = [URLQueryItem(name: "action", value: "auth")]
        guard let url = c.url else { throw DarbarError.badURL }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.timeoutInterval = 12
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["pin": pin])
        let (data, resp) = try await URLSession.shared.data(for: req)
        if let http = resp as? HTTPURLResponse, http.statusCode == 401 { throw DarbarError.badPIN }
        if let http = resp as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw DarbarError.server("Darbar auth HTTP \(http.statusCode)")
        }
        return try decoder.decode(DarbarAuthResponse.self, from: data)
    }

    // GET ?action=home with the token header.
    func home(token: String) async throws -> DarbarHome {
        let data = try await request(query: ["action": "home"], token: token)
        return try decoder.decode(DarbarHome.self, from: data)
    }

    // CAMS face image URL for a pin — consumed by AsyncImage in the view.
    nonisolated static func photoURL(pin: String, token: String) -> URL? {
        var c = URLComponents(string: base)
        c?.path = "/api/darbar"
        c?.queryItems = [
            URLQueryItem(name: "action", value: "photo-img"),
            URLQueryItem(name: "pin", value: pin),
            URLQueryItem(name: "t", value: token),
        ]
        return c?.url
    }

    private func request(query: [String: String], token: String) async throws -> Data {
        guard var c = URLComponents(string: Self.base) else { throw DarbarError.badURL }
        c.path = "/api/darbar"
        c.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) }
        guard let url = c.url else { throw DarbarError.badURL }
        var req = URLRequest(url: url)
        req.timeoutInterval = 12
        req.setValue(token, forHTTPHeaderField: "x-darbar-token")
        let (data, resp) = try await URLSession.shared.data(for: req)
        if let http = resp as? HTTPURLResponse, http.statusCode == 401 { throw DarbarError.unauthorized }
        if let http = resp as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw DarbarError.server("Darbar HTTP \(http.statusCode)")
        }
        if data.isEmpty { throw DarbarError.server("Empty Darbar response") }
        return data
    }
}
