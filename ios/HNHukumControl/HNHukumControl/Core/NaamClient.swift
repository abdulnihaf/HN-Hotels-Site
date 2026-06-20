import Foundation

// Naam marketing-pulse client. Reads the FIVE live cockpit APIs directly from source
// (open CORS, NO key — verified reachable 2026-06-20). Read-only: GET only, zero mutation.
// Bases are hardcoded per the Diwan contract §2.
actor NaamClient {
    static let shared = NaamClient()

    private let heBase = "https://hamzaexpress.in"   // Meta CTWA · Google Ads · WhatsApp leads
    private let hnBase = "https://hnhotels.in"        // GBP organic · Influencer pipeline
    private let decoder = JSONDecoder()

    private func get<T: Decodable>(_ urlString: String, as _: T.Type) async throws -> T {
        guard let url = URL(string: urlString) else { throw HukumError.badURL }
        var req = URLRequest(url: url)
        req.timeoutInterval = 12
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        let (d, resp) = try await URLSession.shared.data(for: req)
        if let http = resp as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw HukumError.server("HTTP \(http.statusCode)")
        }
        return try decoder.decode(T.self, from: d)
    }

    func ctwa(period: String) async throws -> NaamCtwa {
        try await get("\(heBase)/api/ctwa-analytics?period=\(period)", as: NaamCtwa.self)
    }
    func google(period: String) async throws -> NaamGoogle {
        try await get("\(heBase)/api/google-cockpit?period=\(period)", as: NaamGoogle.self)
    }
    func leads() async throws -> NaamLeads {
        try await get("\(heBase)/api/leads?action=counts", as: NaamLeads.self)
    }
    func gbp(brand: String, period: String) async throws -> NaamGbp {
        try await get("\(hnBase)/api/gbp-cockpit?brand=\(brand)&period=\(period)", as: NaamGbp.self)
    }
    func influencer() async throws -> NaamInfluencer {
        try await get("\(hnBase)/api/influencer-bio-pulse?action=stats", as: NaamInfluencer.self)
    }
}
