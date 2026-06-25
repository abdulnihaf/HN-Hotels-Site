import Foundation

// Watch reads the balance endpoint directly — same source as iOS, no WCSession needed.
actor WatchTakhtClient {
    static let shared = WatchTakhtClient()
    private let base = "https://nawabichaihouse.com"
    private let decoder = JSONDecoder()

    func balance() async throws -> TakhtBalanceResponse {
        try decoder.decode(TakhtBalanceResponse.self, from:
            try await request(path: "/api/settlement", query: ["action": "counter-balance"]))
    }

    func shift() async throws -> TakhtShiftResponse {
        try decoder.decode(TakhtShiftResponse.self, from:
            try await request(path: "/api/settlement", query: ["action": "current-shift"]))
    }

    private func request(path: String, query: [String: String] = [:]) async throws -> Data {
        guard var c = URLComponents(string: base) else { throw TakhtError.badURL }
        c.path = path
        c.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) }
        guard let url = c.url else { throw TakhtError.badURL }
        var req = URLRequest(url: url)
        req.timeoutInterval = 15
        let (data, resp) = try await URLSession.shared.data(for: req)
        if let http = resp as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw TakhtError.server("HTTP \(http.statusCode)")
        }
        return data
    }
}
