import Foundation

// READ-ONLY witness. The only non-pure-read call is verifyPin (auth handshake).
actor TakhtClient {
    static let shared = TakhtClient()
    private let base = "https://nawabichaihouse.com"
    private let decoder = JSONDecoder()

    func verifyPin(_ pin: String) async throws -> TakhtVerifyResponse {
        let data = try await request(path: "/api/settlement", query: ["action": "verify-pin", "pin": pin])
        return try decoder.decode(TakhtVerifyResponse.self, from: data)
    }

    func balance() async throws -> TakhtBalanceResponse {
        let data = try await request(path: "/api/settlement", query: ["action": "counter-balance"])
        return try decoder.decode(TakhtBalanceResponse.self, from: data)
    }

    func tokens() async throws -> TakhtTokenResponse {
        let data = try await request(path: "/api/token-settlement", query: ["action": "get-status"])
        return try decoder.decode(TakhtTokenResponse.self, from: data)
    }

    func upi() async throws -> TakhtUpiResponse {
        let data = try await request(path: "/api/validator", query: ["action": "razorpay-verify"], timeout: 45)
        return try decoder.decode(TakhtUpiResponse.self, from: data)
    }

    func shift() async throws -> TakhtShiftResponse {
        let data = try await request(path: "/api/settlement", query: ["action": "current-shift"])
        return try decoder.decode(TakhtShiftResponse.self, from: data)
    }

    private func request(path: String, query: [String: String] = [:], timeout: TimeInterval = 15) async throws -> Data {
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
