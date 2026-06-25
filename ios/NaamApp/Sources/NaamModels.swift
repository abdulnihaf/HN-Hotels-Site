import Foundation

// Naam — the marketing-pulse chamber. Models the FIVE live, open-CORS cockpit APIs directly
// (NOT the naam.hnhotels.in naam-data.json snapshot). Modelled from the REAL responses verified
// 2026-06-20. Ad spend is already in RUPEES on these sources (not paise). All numerics are
// Double?/Int? so a feed that omits a field decodes to nil → an honest empty state, never a fake 0.
//
// Type names are Naam*-prefixed to coexist with the base's NaamLive* scaffold without symbol
// collision; the coordinator retires NaamLive* once NaamView is the tile.

// ── 1. Meta paid — GET hamzaexpress.in/api/ctwa-analytics?period= ──
struct NaamCtwa: Codable {
    var success: Bool?
    var overview: NaamCtwaOverview?
    var adMetrics: NaamCtwaAd?
    var funnel: NaamCtwaFunnel?
}
struct NaamCtwaOverview: Codable {
    var conversations: Double?; var orders: Double?; var bookings: Double?
    var revenue: Double?; var aov: Double?; var totalSpend: Double?
}
struct NaamCtwaAd: Codable {
    var available: Bool?
    var impressions: Double?; var reach: Double?; var spend: Double?
    var linkClicks: Double?; var outboundClicks: Double?; var landingPageViews: Double?
    var cpc: Double?; var frequency: Double?; var conversations: Double?
}
struct NaamCtwaFunnel: Codable {
    var adTaps: Int?; var messaged: Int?; var viewedCombos: Int?; var ordered: Int?; var booked: Int?
}

// ── 2. Google paid — GET hamzaexpress.in/api/google-cockpit?period= ──
struct NaamGoogle: Codable {
    var success: Bool?
    var campaignName: String?
    var asOf: String?
    var overview: NaamGoogleOverview?
}
struct NaamGoogleOverview: Codable {
    var impressions: Double?; var clicks: Double?; var spend: Double?
    var ctr: Double?; var avgCPC: Double?; var conversions: Double?
    var status: String?; var servingStatus: String?
}

// ── 3. WhatsApp leads — GET hamzaexpress.in/api/leads?action=counts ──
struct NaamLeads: Codable {
    var success: Bool?
    var byStage: [String: Int]?
    var byStatus: [String: Int]?
    var bySource: [String: Int]?
    var byAssignee: [String: Int]?     // §6.6 cross-ref: assignee NAME → resolve to staff_pin
}

// ── 4. Google organic (GBP) — GET hnhotels.in/api/gbp-cockpit?brand=&period= (T-2 lag) ──
struct NaamGbp: Codable {
    var ok: Bool?
    var brandTitle: String?
    var asOf: String?
    var freshness: NaamGbpFreshness?
    var summary: NaamGbpSummary?
}
struct NaamGbpFreshness: Codable { var performance: String? }   // "T-2 days (GBP API lag)"
struct NaamGbpSummary: Codable {
    var impressions: NaamGbpImpr?
    var actions: NaamGbpActions?
    var actionRate: Double?
}
struct NaamGbpImpr: Codable { var total: Int?; var maps: Int?; var search: Int? }
struct NaamGbpActions: Codable { var total: Int?; var calls: Int?; var directions: Int?; var website: Int?; var menu: Int? }

// ── 5. Influencer pipeline — GET hnhotels.in/api/influencer-bio-pulse?action=stats (snake_case) ──
struct NaamInfluencer: Codable {
    var success: Bool?
    var total: Int?
    var byStatus: [NaamInfStatus]?
    var contacts: NaamInfContacts?
    var topCategories: [NaamInfCat]?
    enum CodingKeys: String, CodingKey { case success, total, contacts; case byStatus = "by_status"; case topCategories = "top_categories" }
}
struct NaamInfStatus: Codable { var status: String?; var c: Int? }
struct NaamInfCat: Codable { var categoryName: String?; var c: Int?
    enum CodingKeys: String, CodingKey { case c; case categoryName = "category_name" } }
struct NaamInfContacts: Codable {
    var withEmail: Int?; var withPhone: Int?; var withWhatsapp: Int?
    var withAnyContact: Int?; var businessAccts: Int?; var verified: Int?
    enum CodingKeys: String, CodingKey {
        case verified
        case withEmail = "with_email"; case withPhone = "with_phone"; case withWhatsapp = "with_whatsapp"
        case withAnyContact = "with_any_contact"; case businessAccts = "business_accts"
    }
}

// ── Cross-ref + presentation helpers (§6) ──
// Brand a channel's data belongs to — drives the mandatory brand chip (§10).
enum NaamBrand { case he, nch, both
    var label: String { switch self { case .he: return "HE"; case .nch: return "NCH"; case .both: return "BOTH" } }
}

// §6.5 — the SOURCE TAG behind every Naam figure, so the coordinator can wire tap-throughs
// (incl. Naam↔Takht where both read the counter-UPI feed). None of Naam's five marketing
// sources is the counter-UPI feed today (counterUpiLinked=false) — kept here so the contract holds.
struct NaamChannelRef: Identifiable {
    let id: String          // "meta" | "google" | "gbp" | "leads" | "influencer" | "swiggy" | "zomato"
    let title: String
    let source: String      // the exact live endpoint this card reads (the source tag)
    let brand: NaamBrand
    let logo: String?
    let counterUpiLinked: Bool   // §6.5: true only if the figure derives from the counter-UPI feed
}

// §6.6 — leads.byAssignee carries a person; keep the name AND a slot for their staff_pin
// (identity root) so the coordinator can wire a tap-through to Darbar. staffPin nil until resolved.
struct NaamAssignee: Identifiable {
    var id: String { name }
    let name: String
    let count: Int
    var staffPin: String?
}
