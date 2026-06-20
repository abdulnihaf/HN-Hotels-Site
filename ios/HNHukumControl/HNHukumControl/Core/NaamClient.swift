import Foundation

actor NaamClient {
    static let shared = NaamClient()
    private let decoder = JSONDecoder()

    func data() async throws -> NaamData {
        guard var c = URLComponents(string: HukumSettings.shared.naamURL) else { throw HukumError.badURL }
        c.path = "/data/naam-data.json"
        guard let url = c.url else { throw HukumError.badURL }
        var req = URLRequest(url: url)
        req.timeoutInterval = 12
        let (d, resp) = try await URLSession.shared.data(for: req)
        if let http = resp as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw HukumError.server("Naam HTTP \(http.statusCode)")
        }
        return try decoder.decode(NaamData.self, from: d)
    }
}
