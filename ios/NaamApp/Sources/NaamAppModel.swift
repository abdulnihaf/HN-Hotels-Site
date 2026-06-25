import Foundation
import Combine

// Naam marketing-pulse — reads the five live sources concurrently, never fabricates a number.
// Honest statusLine reports how many of the five came back. Read-only.
@MainActor
final class NaamAppModel: ObservableObject {
    @Published var ctwa: NaamCtwa?
    @Published var google: NaamGoogle?
    @Published var leads: NaamLeads?
    @Published var gbp: NaamGbp?
    @Published var influencer: NaamInfluencer?

    @Published var period = "30d"                 // paid window (Meta + Google honour it)
    @Published var statusLine = "Loading live marketing…"
    @Published var isRefreshing = false

    func bootstrap() async { await refresh() }

    func refresh() async {
        isRefreshing = true
        defer { isRefreshing = false }
        statusLine = "Reading live sources…"
        async let cT = NaamClient.shared.ctwa(period: period)
        async let gT = NaamClient.shared.google(period: period)
        async let lT = NaamClient.shared.leads()
        async let bT = NaamClient.shared.gbp(brand: "he", period: "28d")  // GBP = its own monthly window
        async let iT = NaamClient.shared.influencer()
        ctwa = try? await cT
        google = try? await gT
        leads = try? await lT
        gbp = try? await bT
        influencer = try? await iT
        let ok = [ctwa != nil, google != nil, leads != nil, gbp != nil, influencer != nil].filter { $0 }.count
        statusLine = ok == 5 ? "Live · \(periodLabel) · all 5 sources" : "\(ok)/5 sources live · \(periodLabel)"
    }

    var periodLabel: String {
        switch period { case "7d": return "7 days"; case "30d": return "30 days"; case "all": return "all time"; default: return period }
    }

    // Hero — total paid spend (Meta + Google), already RUPEES on these sources.
    var totalSpend: Double {
        (ctwa?.overview?.totalSpend ?? ctwa?.adMetrics?.spend ?? 0) + (google?.overview?.spend ?? 0)
    }

    // Lead funnel in pipeline order.
    var leadStages: [(String, Int)] {
        let order = ["new", "engaged", "ordered", "booked"]
        guard let s = leads?.byStage else { return [] }
        return order.compactMap { k in s[k].map { (k.capitalized, $0) } }
    }

    // §6.6 — assignees with a staff_pin slot for the coordinator to resolve → Darbar tap-through.
    var leadAssignees: [NaamAssignee] {
        (leads?.byAssignee ?? [:]).sorted { $0.value > $1.value }
            .map { NaamAssignee(name: $0.key, count: $0.value, staffPin: nil) }
    }

    // §6.5 — the source tag behind each card (none is the counter-UPI feed today).
    let channels: [NaamChannelRef] = [
        .init(id: "meta",       title: "Meta Ads",        source: "hamzaexpress.in/api/ctwa-analytics", brand: .he,   logo: "logo-meta",      counterUpiLinked: false),
        .init(id: "google",     title: "Google Ads",      source: "hamzaexpress.in/api/google-cockpit", brand: .he,   logo: "logo-google",    counterUpiLinked: false),
        .init(id: "gbp",        title: "Google · Organic", source: "hnhotels.in/api/gbp-cockpit",        brand: .he,   logo: nil,              counterUpiLinked: false),
        .init(id: "leads",      title: "WhatsApp Leads",  source: "hamzaexpress.in/api/leads",          brand: .he,   logo: "logo-whatsapp",  counterUpiLinked: false),
        .init(id: "influencer", title: "Influencer",      source: "hnhotels.in/api/influencer-bio-pulse", brand: .both, logo: "logo-instagram", counterUpiLinked: false),
        .init(id: "swiggy",     title: "Swiggy · Organic", source: "(not wired)",                       brand: .both, logo: "logo-swiggy",    counterUpiLinked: false),
        .init(id: "zomato",     title: "Zomato · Organic", source: "(not wired)",                       brand: .both, logo: "logo-zomato",    counterUpiLinked: false),
    ]
    func channel(_ id: String) -> NaamChannelRef? { channels.first { $0.id == id } }
}
