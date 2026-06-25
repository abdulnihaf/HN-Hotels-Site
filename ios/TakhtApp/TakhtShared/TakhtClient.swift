import Foundation

// READ-ONLY witness + identity handshake.
//
// Two kinds of call:
//   • IDENTITY  → hnhotels.in/api/takht-auth  (Darbar bridge, brand-agnostic)
//   • DATA      → the working brand's host     (NCH: nawabichaihouse.com,
//                                               HE:  hamzaexpress.in)
// The only non-pure-read call is verifyPin (the auth handshake). No settlement
// or correction WRITE happens from this app yet — that crosses the money gate.
actor TakhtClient {
    static let shared = TakhtClient()
    private let authBase = "https://hnhotels.in"
    private let decoder = JSONDecoder()

    // ── IDENTITY ──
    func verifyPin(_ pin: String) async throws -> TakhtAuthResponse {
        let data = try await request(base: authBase, path: "/api/takht-auth",
                                     query: ["action": "verify-pin", "pin": pin])
        return try decoder.decode(TakhtAuthResponse.self, from: data)
    }

    // ── DATA (per brand host) ──
    func balance(host: String) async throws -> TakhtBalanceResponse {
        let data = try await request(base: host, path: "/api/settlement",
                                     query: ["action": "counter-balance"])
        return try decoder.decode(TakhtBalanceResponse.self, from: data)
    }

    func tokens(host: String) async throws -> TakhtTokenResponse {
        let data = try await request(base: host, path: "/api/token-settlement",
                                     query: ["action": "get-status"])
        return try decoder.decode(TakhtTokenResponse.self, from: data)
    }

    func upi(host: String) async throws -> TakhtUpiResponse {
        let data = try await request(base: host, path: "/api/validator",
                                     query: ["action": "razorpay-verify"], timeout: 45)
        return try decoder.decode(TakhtUpiResponse.self, from: data)
    }

    func shift(host: String) async throws -> TakhtShiftResponse {
        let data = try await request(base: host, path: "/api/settlement",
                                     query: ["action": "current-shift"])
        return try decoder.decode(TakhtShiftResponse.self, from: data)
    }

    private func request(base: String, path: String, query: [String: String] = [:],
                         timeout: TimeInterval = 15) async throws -> Data {
        guard var c = URLComponents(string: base) else { throw TakhtError.badURL }
        c.path = path
        if !query.isEmpty { c.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) } }
        guard let url = c.url else { throw TakhtError.badURL }
        var req = URLRequest(url: url)
        req.timeoutInterval = timeout
        let (data, resp) = try await URLSession.shared.data(for: req)
        if let http = resp as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw TakhtError.server("HTTP \(http.statusCode)")
        }
        if data.isEmpty { throw TakhtError.server("Empty response") }
        return data
    }
}
