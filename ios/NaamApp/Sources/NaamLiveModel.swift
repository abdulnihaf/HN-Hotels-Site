import Foundation
import Combine

@MainActor
final class NaamLiveModel: ObservableObject {
    @Published var ctwa: CtwaResponse?
    @Published var google: GoogleResponse?
    @Published var leads: LeadsResponse?
    @Published var gbp: GbpResponse?
    @Published var influencer: InfluencerResponse?
    @Published var period = "30d"
    @Published var status = "Loading live marketing…"
    @Published var isRefreshing = false

    func bootstrap() async { await refresh() }

    func refresh() async {
        isRefreshing = true
        defer { isRefreshing = false }
        status = "Reading live sources…"
        // all five sources concurrently
        async let cT = NaamLiveClient.shared.ctwa(period: period)
        async let gT = NaamLiveClient.shared.google(period: period)
        async let lT = NaamLiveClient.shared.leads()
        async let bT = NaamLiveClient.shared.gbp(period: period)
        async let iT = NaamLiveClient.shared.influencer()
        ctwa = try? await cT
        google = try? await gT
        leads = try? await lT
        gbp = try? await bT
        influencer = try? await iT
        let flags = [ctwa != nil, google != nil, leads != nil, gbp != nil, influencer != nil]
        let ok = flags.filter { $0 }.count
        status = ok == flags.count ? "Live · \(periodLabel) · just now" : "\(ok)/\(flags.count) sources live · \(periodLabel)"
    }

    var periodLabel: String {
        switch period { case "7d": return "7 days"; case "30d": return "30 days"; case "all": return "all time"; default: return period }
    }

    // total paid spend across Meta + Google (rupees)
    var totalSpend: Double {
        (ctwa?.overview?.totalSpend ?? ctwa?.adMetrics?.spend ?? 0) + (google?.overview?.spend ?? 0)
    }

    var leadStages: [(String, Int)] {
        let order = ["new", "engaged", "ordered", "booked"]
        guard let s = leads?.byStage else { return [] }
        return order.compactMap { k in s[k].map { (k.capitalized, $0) } }
    }
}
