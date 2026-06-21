import Foundation

// Sauda API client — https://sauda.hnhotels.in/api/sauda. Shared Diwan token via header
// x-darbar-token (minted once with the seeded PIN; the coordinator owns the unlock). READ-ONLY:
// the ONLY POST is the auth handshake — every other call is a GET. Mutations (place/pay/decode)
// are owner-approve and wired by the coordinator, never here.
actor SaudaClient {
    static let shared = SaudaClient()
    private let base = "https://sauda.hnhotels.in/api/sauda"
    private let decoder = JSONDecoder()

    // POST ?action=auth {pin} → { token }
    func auth(pin: String) async throws -> String {
        guard let url = URL(string: "\(base)?action=auth") else { throw SaudaError.badURL }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.timeoutInterval = 12
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["pin": pin])
        let (data, resp) = try await URLSession.shared.data(for: req)
        if let h = resp as? HTTPURLResponse, !(200..<300).contains(h.statusCode) {
            throw SaudaError.unauthorized
        }
        let a = try decoder.decode(SaudaAuthResponse.self, from: data)
        guard let t = a.token, !t.isEmpty else { throw SaudaError.unauthorized }
        return t
    }

    func settings(token: String) async throws -> SaudaSettings {
        try await get("settings", token: token)
    }
    func open(forDate: String?, token: String) async throws -> SaudaOpen {
        var q: [String: String] = [:]
        if let d = forDate, !d.isEmpty { q["for_date"] = d }
        return try await get("open", query: q, token: token)
    }
    func compare(token: String) async throws -> SaudaCompare {
        try await get("compare", token: token)
    }
    func vendorLedger(token: String) async throws -> SaudaVendorLedger {
        try await get("vendor-ledger", token: token)
    }
    func hyperpure(token: String) async throws -> SaudaHyperpure {
        try await get("hyperpure-feed", token: token)
    }

    private func get<T: Decodable>(_ action: String, query: [String: String] = [:], token: String) async throws -> T {
        guard var c = URLComponents(string: base) else { throw SaudaError.badURL }
        var items = [URLQueryItem(name: "action", value: action)]
        items += query.map { URLQueryItem(name: $0.key, value: $0.value) }
        c.queryItems = items
        guard let url = c.url else { throw SaudaError.badURL }
        var req = URLRequest(url: url)
        req.timeoutInterval = 12
        req.setValue(token, forHTTPHeaderField: "x-darbar-token")
        req.setValue("Mozilla/5.0", forHTTPHeaderField: "User-Agent")
        let (data, resp) = try await URLSession.shared.data(for: req)
        if let h = resp as? HTTPURLResponse {
            if h.statusCode == 401 || h.statusCode == 403 { throw SaudaError.unauthorized }
            if !(200..<300).contains(h.statusCode) { throw SaudaError.server("Sauda HTTP \(h.statusCode)") }
        }
        if data.isEmpty { throw SaudaError.server("Empty Sauda response") }
        return try decoder.decode(T.self, from: data)
    }
}

enum SaudaError: LocalizedError {
    case badURL, unauthorized, locked, server(String)
    var errorDescription: String? {
        switch self {
        case .badURL: return "Bad Sauda URL"
        case .unauthorized: return "Sauda token rejected"
        case .locked: return "Unlock from the Diwan home"
        case .server(let m): return m
        }
    }
}
