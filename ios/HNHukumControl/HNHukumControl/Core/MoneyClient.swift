import Foundation

// Tijori network layer — read-only. Talks to the three live money services.
//
// HOST DIVERGENCE (reported to coordinator): the brief named app.hnhotels.in, but that host serves
// the PWA SPA shell for /api/* (returns HTML). The JSON APIs actually live on hnhotels.in — verified
// live: app.hnhotels.in/api/money → text/html shell; hnhotels.in/api/money → application/json. So the
// base is hardcoded to hnhotels.in (where the deployed Pages Functions answer).
//
// AUTH (verified against the live PWA JS): these three APIs are PIN-gated, NOT token-mint
// (POST ?action=auth → 405). The live cockpits send the PIN as `?pin=` (money + cash, and bank
// summary) and as the `X-Ops-Pin` header (bank list/reads). We send the vaulted credential as BOTH,
// plus `x-darbar-token` per contract §4 so the shared Diwan token reconciles when the coordinator
// seeds it. No PIN gate of our own — we read the one-unlock credential from the vault.
actor MoneyClient {
    static let shared = MoneyClient()
    private let base = "https://hnhotels.in"
    private let decoder = JSONDecoder()

    // The one-unlock credential. "tijori" is seeded by the coordinator's DiwanSession; we fall back to
    // the owner PIN (seeded today) so the chamber works before that wiring lands.
    private func cred() -> String {
        DiwanAuth.credential("tijori")
            ?? DiwanAuth.credential("owner")
            ?? DiwanAuth.credential("darbar")
            ?? ""
    }

    // MARK: bank-feed
    func bankSummary() async throws -> BankSummary    { try await get("/api/bank-feed", ["action": "summary"]) }
    func bankList(limit: Int = 40) async throws -> BankListResponse { try await get("/api/bank-feed", ["action": "list", "limit": "\(limit)"]) }
    func bankDaily() async throws -> BankDailyResponse { try await get("/api/bank-feed", ["action": "daily_cashflow"]) }
    func bankPayees() async throws -> BankPayeesResponse { try await get("/api/bank-feed", ["action": "payees"]) }
    func bankAttention() async throws -> BankAttention { try await get("/api/bank-feed", ["action": "attention_queue"]) }

    // MARK: money cockpit
    func moneyCockpit() async throws -> MoneyCockpit  { try await get("/api/money", ["action": "cockpit"]) }
    func cashPosition() async throws -> CashPosition  { try await get("/api/money", ["action": "cash-position"]) }

    // MARK: cash trail
    func cashTrail() async throws -> CashTrailResponse { try await get("/api/cash", ["action": "trail"]) }
    func cashSyncStatus() async throws -> CashSyncResponse { try await get("/api/cash", ["action": "sync-status"]) }

    private func get<T: Decodable>(_ path: String, _ query: [String: String]) async throws -> T {
        let pin = cred()
        var q = query
        q["pin"] = pin
        guard var c = URLComponents(string: base) else { throw MoneyError.badURL }
        c.path = path
        c.queryItems = q.map { URLQueryItem(name: $0.key, value: $0.value) }
        guard let url = c.url else { throw MoneyError.badURL }
        var req = URLRequest(url: url)
        req.timeoutInterval = 12
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        req.setValue(pin, forHTTPHeaderField: "X-Ops-Pin")       // bank-feed list/reads check this header
        req.setValue(pin, forHTTPHeaderField: "x-darbar-token")  // §4 shared Diwan token (coordinator reconciles)
        let (data, resp) = try await URLSession.shared.data(for: req)
        if let http = resp as? HTTPURLResponse {
            if http.statusCode == 401 || http.statusCode == 403 { throw MoneyError.unauthorized }
            if !(200..<300).contains(http.statusCode) { throw MoneyError.server("HTTP \(http.statusCode)") }
        }
        if data.isEmpty { throw MoneyError.server("Empty response") }
        // A '<' first byte means we hit an HTML shell (wrong host / not routed) — fail honestly.
        if data.first == 0x3C { throw MoneyError.unreachable }
        return try decoder.decode(T.self, from: data)
    }
}
