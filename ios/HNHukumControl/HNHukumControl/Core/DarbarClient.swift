import Foundation

// Darbar token-mint client. The native side does exactly ONE thing: mint the shared 12h HMAC token
// from the one-unlock PIN, so the embedded PWA (DarbarView's WKWebView) can be handed an already
// authenticated session and skip its own gate. The PWA itself makes every other call.
//
// Per DIWAN-IOS-CONTRACT §7 the auth handshake is the only POST allowed — and that is all this does.
actor DarbarClient {
    static let shared = DarbarClient()

    // Hardcoded base — Darbar lives on its own subdomain.
    static let base = "https://darbar.hnhotels.in"
    static let appURL = "https://darbar.hnhotels.in/ops/darbar/"

    private let decoder = JSONDecoder()

    // POST ?action=auth {"pin":…} → mint a token (+ user / role / fin for the PWA's darbar_user).
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
}
