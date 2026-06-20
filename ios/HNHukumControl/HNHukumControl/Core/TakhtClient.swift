import Foundation

// Takht client — talks to the live NCH settlement worker (nawabichaihouse.com).
// READ-ONLY witness: the ONLY non-read call is verifyPin (the auth handshake that mints the gate).
// All amounts are RUPEES already — never ÷100.
actor TakhtClient {
    static let shared = TakhtClient()
    private let base = "https://nawabichaihouse.com"
    private let decoder = JSONDecoder()

    // Auth handshake — the one allowed write-shaped call (verifies a Takht PIN, returns the holder).
    func verifyPin(_ pin: String) async throws -> TakhtVerifyResponse {
        let data = try await request(path: "/api/settlement", query: ["action": "verify-pin", "pin": pin])
        return try decoder.decode(TakhtVerifyResponse.self, from: data)
    }

    // The rupee total + cash/runner/expense witnesses.
    func balance() async throws -> TakhtBalanceResponse {
        let data = try await request(path: "/api/settlement", query: ["action": "counter-balance"])
        return try decoder.decode(TakhtBalanceResponse.self, from: data)
    }

    // Goods/chai witness (token box vs POS beverages).
    func tokens() async throws -> TakhtTokenResponse {
        let data = try await request(path: "/api/token-settlement", query: ["action": "get-status"])
        return try decoder.decode(TakhtTokenResponse.self, from: data)
    }

    // UPI witness (Razorpay actually-received vs POS-billed). Slower — wider timeout.
    func upi() async throws -> TakhtUpiResponse {
        let data = try await request(path: "/api/validator", query: ["action": "razorpay-verify"], timeout: 45)
        return try decoder.decode(TakhtUpiResponse.self, from: data)
    }

    // Who holds the counter now.
    func shift() async throws -> TakhtShiftResponse {
        let data = try await request(path: "/api/settlement", query: ["action": "current-shift"])
        return try decoder.decode(TakhtShiftResponse.self, from: data)
    }

    private func request(path: String, query: [String: String] = [:], timeout: TimeInterval = 15) async throws -> Data {
        guard var c = URLComponents(string: base) else { throw HukumError.badURL }
        c.path = path
        if !query.isEmpty { c.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) } }
        guard let url = c.url else { throw HukumError.badURL }
        var req = URLRequest(url: url)
        req.timeoutInterval = timeout
        let (data, resp) = try await URLSession.shared.data(for: req)
        if let http = resp as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw HukumError.server("Takht HTTP \(http.statusCode)")
        }
        if data.isEmpty { throw HukumError.server("Empty Takht response") }
        return data
    }
}
