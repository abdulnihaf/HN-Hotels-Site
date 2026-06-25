import Foundation

enum NazarError: LocalizedError {
    case badURL, empty
    case server(String)

    var errorDescription: String? {
        switch self {
        case .badURL:        return "Invalid URL."
        case .empty:         return "Empty response from RTX."
        case .server(let m): return m
        }
    }
}

actor NazarClient {
    static let shared = NazarClient()
    private let session: URLSession

    init() {
        let cfg = URLSessionConfiguration.default
        cfg.timeoutIntervalForRequest = 10
        cfg.timeoutIntervalForResource = 15
        session = URLSession(configuration: cfg)
    }

    private func get(_ url: URL) async throws -> Data {
        let (data, resp) = try await session.data(from: url)
        guard let http = resp as? HTTPURLResponse else { throw NazarError.empty }
        guard (200..<300).contains(http.statusCode) else {
            let msg = String(data: data, encoding: .utf8) ?? "HTTP \(http.statusCode)"
            throw NazarError.server(msg.isEmpty ? "HTTP \(http.statusCode)" : msg)
        }
        if data.isEmpty { throw NazarError.empty }
        return data
    }

    func fetchFlags(includeHistory: Bool = true) async throws -> NazarFlags {
        guard let url = URL(string: "\(NazarURL.appBase)/nz/flags\(includeHistory ? "?include_history=1" : "")") else {
            throw NazarError.badURL
        }
        let data = try await get(url)
        let dec = JSONDecoder()
        return try dec.decode(NazarFlags.self, from: data)
    }

    func fetchFrame(cam: String) async throws -> Data {
        guard let url = NazarURL.frameURL(for: cam) else { throw NazarError.badURL }
        return try await get(url)
    }

    func confirmFlag(id: String, verdict: String) async throws {
        guard let url = URL(string: "\(NazarURL.appBase)/nz/confirm") else { throw NazarError.badURL }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let body = ["id": id, "verdict": verdict]
        req.httpBody = try JSONEncoder().encode(body)
        let (_, resp) = try await session.data(for: req)
        guard let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw NazarError.server("Confirm failed")
        }
    }
}
