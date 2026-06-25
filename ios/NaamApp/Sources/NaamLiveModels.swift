import Foundation

// Naam LIVE — read directly from the source cockpit APIs (open CORS), NOT the web deployment's
// pre-baked naam-data.json snapshot. Native + always fresh. Money is already in RUPEES here.
// All numerics are Double? so an int (impressions) or float (spend 4392.02) both decode.

struct CtwaResponse: Codable {
    var success: Bool?
    var overview: CtwaOverview?
    var adMetrics: CtwaAdMetrics?
    var funnel: CtwaFunnel?
}
struct CtwaOverview: Codable {
    var conversations: Double?
    var orders: Double?
    var bookings: Double?
    var revenue: Double?
    var aov: Double?
    var totalSpend: Double?
    var costPerConversation: Double?
}
struct CtwaAdMetrics: Codable {
    var available: Bool?
    var impressions: Double?
    var reach: Double?
    var spend: Double?
    var linkClicks: Double?
    var outboundClicks: Double?
    var landingPageViews: Double?
}
struct CtwaFunnel: Codable {
    var adTaps: Int?
    var messaged: Int?
    var viewedCombos: Int?
    var ordered: Int?
    var booked: Int?
}

struct GoogleResponse: Codable {
    var success: Bool?
    var campaignName: String?
    var asOf: String?
    var overview: GoogleOverview?
}
struct GoogleOverview: Codable {
    var impressions: Double?
    var clicks: Double?
    var spend: Double?
    var ctr: Double?
    var avgCPC: Double?
    var conversions: Double?
    var status: String?
    var servingStatus: String?
}

struct LeadsResponse: Codable {
    var success: Bool?
    var byStage: [String: Int]?
    var byStatus: [String: Int]?
    var bySource: [String: Int]?
}

// Google Business Profile (organic) — GET /api/gbp-cockpit?brand=he&period=30d&include=summary
// Open CORS, no key. Numerics are Int (impression/action counts). Money not involved.
struct GbpResponse: Codable {
    var ok: Bool?
    var brandTitle: String?
    var asOf: String?
    var freshness: GbpFreshness?
    var summary: GbpSummary?
}
struct GbpFreshness: Codable {
    var performance: String?   // e.g. "T-2 days (GBP API lag)"
}
struct GbpSummary: Codable {
    var impressions: GbpImpressions?
    var actions: GbpActions?
    var actionRate: Double?
}
struct GbpImpressions: Codable {
    var total: Int?
    var maps: Int?
    var search: Int?
}
struct GbpActions: Codable {
    var total: Int?
    var calls: Int?
    var directions: Int?
    var website: Int?          // "websiteClicks" in the task spec; real key is "website"
    var menu: Int?
}
// snake_case CodingKeys (this API returns "by_status", "with_email" etc.; the
// shared decoder uses no key strategy, so map explicitly).
extension InfluencerResponse {
    enum CodingKeys: String, CodingKey {
        case success, total
        case byStatus = "by_status"
        case contacts
    }
}
extension InfluencerContacts {
    enum CodingKeys: String, CodingKey {
        case withEmail = "with_email"
        case withPhone = "with_phone"
        case withWhatsapp = "with_whatsapp"
        case withAnyContact = "with_any_contact"
        case businessAccts = "business_accts"
        case verified
    }
}

// Influencer bio-pulse — GET /api/influencer-bio-pulse?action=stats (open CORS, no key).
// Counts of enriched creators / contactable / business accounts.
struct InfluencerResponse: Codable {
    var success: Bool?
    var total: Int?                       // total creators enriched
    var byStatus: [InfluencerStatus]?
    var contacts: InfluencerContacts?
}
struct InfluencerStatus: Codable {
    var status: String?
    var c: Int?
}
struct InfluencerContacts: Codable {
    var withEmail: Int?
    var withPhone: Int?
    var withWhatsapp: Int?
    var withAnyContact: Int?
    var businessAccts: Int?
    var verified: Int?
}
