import Foundation

// Naam marketing snapshot — GET naam-data.json (public). Modelled from the live file.
struct NaamData: Codable {
    var generatedAt: String?
    var today: String?
    var standingDirection: String?
    var laneOrder: [String]?
    var lanes: [NaamLane]?

    enum CodingKeys: String, CodingKey {
        case today, lanes
        case generatedAt = "generated_at"
        case standingDirection = "standing_direction"
        case laneOrder = "lane_order"
    }
}

struct NaamLane: Codable, Identifiable, Hashable {
    var id: String
    var title: String?
    var subtitle: String?
    var group: String?
    var risk: String?
    var priority: Int?
    var brands: [String: NaamBrandLane?]?   // a brand can be null when absent for that outlet

    enum CodingKeys: String, CodingKey {
        case id, title, subtitle, group, risk, priority, brands
    }

    func brandLane(_ b: String) -> NaamBrandLane? { (brands?[b]) ?? nil }
}

struct NaamBrandLane: Codable, Hashable {
    var status: String?
    var lastRun: String?
    var freshnessDays: Int?
    var summary: String?

    enum CodingKeys: String, CodingKey {
        case status, summary
        case lastRun = "last_run"
        case freshnessDays = "freshness_days"
    }
}
