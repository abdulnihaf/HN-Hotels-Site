import Foundation

// Reads the live HE marketing cockpit APIs directly (open CORS, no key). Native, always fresh.
// Meta + Google paid live on hamzaexpress.in; GBP organic + influencer live on hnhotels.in.
actor NaamLiveClient {
    static let shared = NaamLiveClient()
    private let dec = JSONDecoder()
    private let base = "https://hamzaexpress.in"
    private let appBase = "https://hnhotels.in"

    func ctwa(period: String) async throws -> CtwaResponse { try await get(base + "/api/ctwa-analytics?period=\(period)") }
    func google(period: String) async throws -> GoogleResponse { try await get(base + "/api/google-cockpit?period=\(period)") }
    func leads() async throws -> LeadsResponse { try await get(base + "/api/leads?action=counts") }
    func gbp(period: String) async throws -> GbpResponse {
        // gbp-cockpit accepts 7d|28d|90d — map the Naam picker (7d|30d|all) onto it.
        let p = period == "30d" ? "28d" : (period == "all" ? "90d" : period)
        return try await get(appBase + "/api/gbp-cockpit?brand=he&period=\(p)&include=summary")
    }
    func influencer() async throws -> InfluencerResponse { try await get(appBase + "/api/influencer-bio-pulse?action=stats") }

    private func get<T: Decodable>(_ urlString: String) async throws -> T {
        guard let url = URL(string: urlString) else { throw HukumError.badURL }
        var req = URLRequest(url: url)
        req.timeoutInterval = 12
        req.cachePolicy = .reloadIgnoringLocalCacheData
        let (d, resp) = try await URLSession.shared.data(for: req)
        if let h = resp as? HTTPURLResponse, !(200..<300).contains(h.statusCode) {
            throw HukumError.server("HTTP \(h.statusCode)")
        }
        return try dec.decode(T.self, from: d)
    }
}
