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

    @discardableResult
    private func post(_ url: URL, body: [String: Any]) async throws -> Data {
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, resp) = try await session.data(for: req)
        guard let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            let code = (resp as? HTTPURLResponse)?.statusCode ?? -1
            throw NazarError.server("HTTP \(code)")
        }
        return data
    }

    // MARK: - Cockpit

    func fetchFlags(includeHistory: Bool = true) async throws -> NazarFlags {
        guard let url = URL(string: "\(NazarURL.appBase)/nz/flags\(includeHistory ? "?include_history=1" : "")") else {
            throw NazarError.badURL
        }
        let data = try await get(url)
        return try JSONDecoder().decode(NazarFlags.self, from: data)
    }

    func fetchFrame(cam: String) async throws -> Data {
        guard let url = NazarURL.frameURL(for: cam) else { throw NazarError.badURL }
        return try await get(url)
    }

    // MARK: - Flag verdicts

    func confirmFlag(code: String, verdict: String, label: String?) async throws {
        guard let url = URL(string: "\(NazarURL.appBase)/nz/confirm") else { throw NazarError.badURL }
        var body: [String: Any] = ["id": code, "code": code, "verdict": verdict]
        if let label { body["label"] = label }
        _ = try await post(url, body: body)
    }

    func fetchConfirmations() async throws -> [NazarConfirmation] {
        guard let url = URL(string: "\(NazarURL.appBase)/nz/confirmations") else { throw NazarError.badURL }
        let data = try await get(url)
        return (try? JSONDecoder().decode([NazarConfirmation].self, from: data)) ?? []
    }

    // MARK: - DVR rewind (NVR playback via go2rtc rw_live)

    /// Start an on-demand NVR playback stream from `mins` ago. Returns the "from" label.
    @discardableResult
    func rewindStart(cam: String, mins: Int) async throws -> String {
        guard let url = URL(string: "\(NazarURL.appBase)/nz/rewind") else { throw NazarError.badURL }
        let data = try await post(url, body: ["cam": cam, "mins": mins])
        struct R: Codable { let ok: Bool?; let from: String?; let err: String? }
        let r = try? JSONDecoder().decode(R.self, from: data)
        if r?.ok == false { throw NazarError.server(r?.err ?? "Rewind failed (camera has no NVR channel).") }
        return r?.from ?? "earlier"
    }

    func rewindStop() async {
        guard let url = URL(string: "\(NazarURL.appBase)/nz/rewind/stop") else { return }
        _ = try? await post(url, body: [:])
    }
}
