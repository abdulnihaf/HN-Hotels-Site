import Foundation

// Sauda — purchasing / buy board. GET https://sauda.hnhotels.in/api/buy?action=today&pin=…
// PIN-gated (X-Ops-Pin / ?pin). Read-only here: we only ever GET. The auth handshake is a GET
// with the candidate PIN — if ok:true comes back, the PIN is valid and we mint the credential.
actor SaudaClient {
    static let shared = SaudaClient()
    private let base = "https://sauda.hnhotels.in"
    private let decoder = JSONDecoder()

    func today(pin: String) async throws -> SaudaTodayResponse {
        let data = try await request(path: "/api/buy", query: ["action": "today", "pin": pin])
        return try decoder.decode(SaudaTodayResponse.self, from: data)
    }

    private func request(path: String, query: [String: String] = [:]) async throws -> Data {
        guard var c = URLComponents(string: base) else { throw SaudaError.badURL }
        c.path = path
        if !query.isEmpty { c.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) } }
        guard let url = c.url else { throw SaudaError.badURL }
        var req = URLRequest(url: url)
        req.timeoutInterval = 12
        let (data, resp) = try await URLSession.shared.data(for: req)
        if let http = resp as? HTTPURLResponse {
            if http.statusCode == 401 || http.statusCode == 403 { throw SaudaError.unauthorized }
            if !(200..<300).contains(http.statusCode) { throw SaudaError.server("Sauda HTTP \(http.statusCode)") }
        }
        if data.isEmpty { throw SaudaError.server("Empty Sauda response") }
        return data
    }
}

enum SaudaError: LocalizedError {
    case badURL
    case unauthorized
    case server(String)

    var errorDescription: String? {
        switch self {
        case .badURL: return "Bad Sauda URL"
        case .unauthorized: return "PIN rejected"
        case .server(let m): return m
        }
    }
}
