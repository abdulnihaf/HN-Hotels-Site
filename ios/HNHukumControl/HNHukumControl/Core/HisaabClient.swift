import Foundation

// Hisaab daily-P&L client. READ-ONLY: the ONLY call is the gated summary read.
// Base is the apex Worker route — hisaab.hnhotels.in is the named subdomain but its
// origin was 522 at build time, so we hit the verified-live apex (X-Ops-Pin 0305,
// 2026-06-20). AUTH = Hisaab's OWN per-user PIN via header `X-Ops-Pin` (also accepts
// ?pin=). NOT the Darbar staff_pin spine, NO token-mint handshake. On 401 we throw so
// the AppModel can surface "re-unlock" once — never a loop, never a fabricated number.
actor HisaabClient {
    static let shared = HisaabClient()
    static let base = "https://hnhotels.in/api/daily-pnl"

    private let decoder = JSONDecoder()

    func summary(brand: HisaabBrand, date: String?, pin: String) async throws -> HisaabSummary {
        var query: [String: String] = ["action": "summary", "brand": brand.rawValue, "pin": pin]
        if let date, !date.isEmpty { query["date"] = date }
        let data = try await get(query: query, pin: pin)
        return try decoder.decode(HisaabSummary.self, from: data)
    }

    private func get(query: [String: String], pin: String) async throws -> Data {
        guard var c = URLComponents(string: HisaabClient.base) else { throw HukumError.badURL }
        c.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) }
        guard let url = c.url else { throw HukumError.badURL }
        var req = URLRequest(url: url)
        req.timeoutInterval = 12
        req.setValue(pin, forHTTPHeaderField: "X-Ops-Pin")
        let (data, resp) = try await URLSession.shared.data(for: req)
        if let http = resp as? HTTPURLResponse {
            if http.statusCode == 401 { throw HukumError.server("unauthorized") }
            if !(200..<300).contains(http.statusCode) {
                throw HukumError.server("Hisaab HTTP \(http.statusCode)")
            }
        }
        if data.isEmpty { throw HukumError.server("Empty Hisaab response") }
        return data
    }
}
