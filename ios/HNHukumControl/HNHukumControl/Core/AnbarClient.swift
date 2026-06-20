import Foundation

actor AnbarClient {
    static let shared = AnbarClient()
    private let decoder = JSONDecoder()

    func board() async throws -> AnbarBoardResponse {
        let data = try await request(path: "/api/anbar", query: ["action": "board"])
        return try decoder.decode(AnbarBoardResponse.self, from: data)
    }

    private func request(path: String, query: [String: String] = [:]) async throws -> Data {
        guard var c = URLComponents(string: HukumSettings.shared.anbarURL) else { throw HukumError.badURL }
        c.path = path
        if !query.isEmpty { c.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) } }
        guard let url = c.url else { throw HukumError.badURL }
        var req = URLRequest(url: url)
        req.timeoutInterval = 12
        let (data, resp) = try await URLSession.shared.data(for: req)
        if let http = resp as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw HukumError.server("Anbar HTTP \(http.statusCode)")
        }
        if data.isEmpty { throw HukumError.server("Empty Anbar response") }
        return data
    }
}
