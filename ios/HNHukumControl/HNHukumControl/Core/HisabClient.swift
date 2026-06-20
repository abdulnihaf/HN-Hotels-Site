import Foundation

// Hisab daily-P&L client. READ-ONLY: the only call is the gated summary read.
// Base URL hardcoded — hisaab.hnhotels.in is the named subdomain but its origin was 522 at build
// time; hnhotels.in/api/daily-pnl is the verified-live route (PIN 0305, 2026-06-20). We hit it via
// the apex host so the chamber works today. Auth = Hisaab's OWN PIN (X-Ops-Pin / ?pin=), NOT the
// Darbar staff_pin spine. PIN stored in the DiwanAuth keychain vault under chamber:"hisab".
actor HisabClient {
    static let shared = HisabClient()
    static let baseURL = "https://hnhotels.in"

    private let decoder = JSONDecoder()

    // Returns the parsed summary. Throws HukumError.server("unauthorized") on 401 (bad/missing PIN)
    // so the gate view can prompt for credentials.
    func summary(brand: HisabBrand, date: String?, pin: String) async throws -> HisabSummary {
        var query: [String: String] = ["action": "summary", "brand": brand.rawValue, "pin": pin]
        if let date, !date.isEmpty { query["date"] = date }
        let data = try await request(path: "/api/daily-pnl", query: query, pin: pin)
        return try decoder.decode(HisabSummary.self, from: data)
    }

    private func request(path: String, query: [String: String], pin: String) async throws -> Data {
        guard var c = URLComponents(string: HisabClient.baseURL) else { throw HukumError.badURL }
        c.path = path
        if !query.isEmpty { c.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) } }
        guard let url = c.url else { throw HukumError.badURL }
        var req = URLRequest(url: url)
        req.timeoutInterval = 15
        req.setValue(pin, forHTTPHeaderField: "X-Ops-Pin")
        let (data, resp) = try await URLSession.shared.data(for: req)
        if let http = resp as? HTTPURLResponse {
            if http.statusCode == 401 { throw HukumError.server("unauthorized") }
            if !(200..<300).contains(http.statusCode) {
                throw HukumError.server("Hisab HTTP \(http.statusCode)")
            }
        }
        if data.isEmpty { throw HukumError.server("Empty Hisab response") }
        return data
    }
}
