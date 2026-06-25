import Foundation

// /nz/flags response — lenient Codable, all fields optional so partial JSON doesn't break decode.
struct NazarFlags: Codable {
    let mode: String?
    let canProveZeroMiss: Bool?
    let whyNot: String?
    let confidence: String?
    let summary: NazarSummary?
    let sourceHealth: NazarSourceHealth?
    let channels: [String: NazarChannel]?
    let history: [NazarFlag]?

    enum CodingKeys: String, CodingKey {
        case mode
        case canProveZeroMiss = "can_prove_zero_miss"
        case whyNot = "why_not"
        case confidence
        case summary
        case sourceHealth = "source_health"
        case channels
        case history
    }
}

struct NazarSummary: Codable {
    let peopleNow: Int?
    let billsToday: Int?
    let salesRs: Int?
    let activeExceptions: Int?
    let historicalReviewFlags: Int?

    enum CodingKeys: String, CodingKey {
        case peopleNow            = "people_now"
        case billsToday           = "bills_today"
        case salesRs              = "sales_rs"
        case activeExceptions     = "active_exceptions"
        case historicalReviewFlags = "historical_review_flags"
    }
}

struct NazarSourceHealth: Codable {
    let firstFloorMode: String?
    let frozenCameras: [String]?

    enum CodingKeys: String, CodingKey {
        case firstFloorMode   = "first_floor_mode"
        case frozenCameras    = "frozen_cameras"
    }
}

struct NazarChannel: Codable {
    let state: String?
    let proofSource: String?
    let engineReads: String?
    let assertCapable: Bool?

    enum CodingKeys: String, CodingKey {
        case state
        case proofSource   = "proof_source"
        case engineReads   = "engine_reads"
        case assertCapable = "assert_capable"
    }
}

struct NazarFlag: Codable, Identifiable {
    var id: String { flagId ?? UUID().uuidString }
    let flagId: String?
    let state: String?
    let area: String?
    let location: String?
    let time: String?
    let headcount: Int?
    let billId: String?
    let confidence: String?
    let snapshotUrl: String?
    let confirmed: String?

    enum CodingKeys: String, CodingKey {
        case flagId      = "id"
        case state
        case area
        case location
        case time
        case headcount
        case billId      = "bill_id"
        case confidence
        case snapshotUrl = "snapshot_url"
        case confirmed
    }
}
