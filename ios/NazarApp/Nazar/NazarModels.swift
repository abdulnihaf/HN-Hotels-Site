import Foundation

// Models mirror the LIVE /nz/flags payload built by ~/nazar-srv/nazar_srv.py on the RTX box.
// Every field is optional so a partial / evolving payload never breaks decode (lenient by design).
// Verified against live HE cockpit 2026-06-25 (claude/ios-nazar-app rollout).

// MARK: - Top level

struct NazarFlags: Codable {
    let ok: Bool?
    let brand: String?
    let asOf: String?
    let mode: String?
    let canProveZeroMiss: Bool?
    let confidenceLabel: String?
    let whyNotProof: [String]?
    let summary: NazarSummary?
    let liveCounts: NazarLiveCounts?
    let sourceHealth: NazarSourceHealth?
    let channels: [String: NazarChannel]?
    let flags: [NazarFlag]?        // active + active_closed exceptions
    let historical: [NazarFlag]?   // historical review flags

    enum CodingKeys: String, CodingKey {
        case ok, brand, mode, summary, channels, flags, historical
        case asOf = "as_of"
        case canProveZeroMiss = "can_prove_zero_miss"
        case confidenceLabel = "confidence_label"
        case whyNotProof = "why_not_proof"
        case liveCounts = "live_counts"
        case sourceHealth = "source_health"
    }
    // NOTE: `duplicates` (duplicate_bills) is intentionally not decoded — shape is unconfirmed
    // (currently always empty) and a wrong guess would risk the whole decode. Surface later when shape is known.
}

struct NazarSummary: Codable {
    let peopleNow: Int?
    let billsToday: Int?
    let salesRs: Int?
    let activeExceptions: Int?
    let historicalReviewFlags: Int?

    enum CodingKeys: String, CodingKey {
        case peopleNow = "people_now"
        case billsToday = "bills_today"
        case salesRs = "sales_rs"
        case activeExceptions = "active_exceptions"
        case historicalReviewFlags = "historical_review_flags"
    }
}

// MARK: - Live counts (occupancy / footfall) — most carry an honest trust flag (often false)

struct NazarLiveCounts: Codable {
    let occupancy: NazarMetric?           // instantaneous_yolo_occupancy
    let livePeople: NazarMetric?          // live_people_from_frigate_events
    let rawSeenToday: NazarMetric?        // raw_frigate_seen_today
    let footfallPublished: NazarFootfall? // footfall_published
    let footfallRaw: NazarFootfall?       // footfall_raw_suppressed

    enum CodingKeys: String, CodingKey {
        case occupancy = "instantaneous_yolo_occupancy"
        case livePeople = "live_people_from_frigate_events"
        case rawSeenToday = "raw_frigate_seen_today"
        case footfallPublished = "footfall_published"
        case footfallRaw = "footfall_raw_suppressed"
    }
}

struct NazarMetric: Codable {
    let value: Int?
    let peak: Int?
    let source: String?
    let perCamera: [String: Int]?
    let trustedForNow: Bool?
    let trustedForDisplay: Bool?
    let trustedForFootfall: Bool?

    enum CodingKeys: String, CodingKey {
        case value, peak, source
        case perCamera = "per_camera"
        case trustedForNow = "trusted_for_now_count"
        case trustedForDisplay = "trusted_for_display"
        case trustedForFootfall = "trusted_for_footfall"
    }

    // Honest trust label: true only when the payload explicitly marks this number trusted.
    var trusted: Bool { (trustedForNow ?? trustedForDisplay ?? trustedForFootfall) ?? false }
}

struct NazarFootfall: Codable {
    let he: Int?
    let source: String?
    let trusted: Bool?
}

// MARK: - Source health

struct NazarSourceHealth: Codable {
    let frigate: String?
    let frozenCameras: [String]?
    let odoo: String?
    let foodDetection: String?
    let faceLayer: String?
    let firstFloorPrimary: String?
    let firstFloorBackup: String?
    let firstFloorMode: String?
    let firstFloorEngineReads: String?
    let groundFloor: String?
    let kitchenPass: String?

    enum CodingKeys: String, CodingKey {
        case frigate, odoo
        case frozenCameras = "frozen_cameras"
        case foodDetection = "food_detection"
        case faceLayer = "face_layer"
        case firstFloorPrimary = "first_floor_primary"
        case firstFloorBackup = "first_floor_backup"
        case firstFloorMode = "first_floor_mode"
        case firstFloorEngineReads = "first_floor_engine_reads"
        case groundFloor = "ground_floor"
        case kitchenPass = "kitchen_pass"
    }
}

// MARK: - Channels (per-area POS vs camera reconciliation)

struct NazarChannel: Codable {
    let status: String?
    let pos: NazarChannelPos?
    let cameraCountSource: String?
    let engineReads: String?
    let engineAssertCapable: Bool?
    let cameraIds: [String]?
    let proofStates: [String]?
    let reason: String?

    enum CodingKeys: String, CodingKey {
        case status, pos, reason
        case cameraCountSource = "camera_count_source"
        case engineReads = "engine_reads"
        case engineAssertCapable = "engine_assert_capable"
        case cameraIds = "camera_ids"
        case proofStates = "proof_states"
    }
}

struct NazarChannelPos: Codable {
    let bills: Int?
    let salesRs: Int?
    enum CodingKeys: String, CodingKey {
        case bills
        case salesRs = "sales_rs"
    }
}

// MARK: - Flag / exception item (active, closed, or historical review)

struct NazarFlag: Codable, Identifiable {
    // Stable per-decode id; the server `code` is preferred when present and non-empty.
    private let localId = UUID()
    var id: String { (code?.isEmpty == false ? code! : localId.uuidString) }

    let status: String?
    let code: String?
    let camera: String?
    let openCamera: String?
    let snapshotUrl: String?
    let time: String?
    let durationMin: Double?
    let personCount: Int?
    let billMatch: String?
    let reason: String?
    let confidence: String?
    let label: String?
    let source: String?

    enum CodingKeys: String, CodingKey {
        case status, code, camera, time, reason, confidence, label, source
        case openCamera = "open_camera"
        case snapshotUrl = "snapshot_url"
        case durationMin = "duration_min"
        case personCount = "person_count"
        case billMatch = "bill_match"
    }

    var isActive: Bool { status == "active" }
    var isHistorical: Bool { (status ?? "").contains("historical") }
}

// MARK: - Confirmations (recorded verdicts: GET /nz/confirmations)

struct NazarConfirmation: Codable, Identifiable {
    private let localId = UUID()
    var id: String { (code?.isEmpty == false ? code! : (at ?? localId.uuidString)) }

    let at: String?
    let code: String?
    let verdict: String?
    let label: String?

    enum CodingKeys: String, CodingKey {
        case at, code, verdict, label
    }
}

// MARK: - Reconciled per-brand analytics (GET /nazar-metrics.json)

struct NazarMetrics: Codable {
    let updated: String?
    let brands: [String: NazarBrandMetrics]?
}

struct NazarBrandMetrics: Codable {
    let occupancyNow: Int?
    let occupancyPeakToday: Int?
    let occTrust: String?
    let customersToday: Int?
    let salesToday: Int?
    let posTrust: String?
    let avgSeatDwellMin: Double?
    let turnsPerSeat: Double?
    let dwellTrust: String?
    let occupancyTrend: [NazarTrendPoint]?
    let open: Bool?

    enum CodingKeys: String, CodingKey {
        case open
        case occupancyNow = "occupancy_now"
        case occupancyPeakToday = "occupancy_peak_today"
        case occTrust = "occ_trust"
        case customersToday = "customers_today"
        case salesToday = "sales_today"
        case posTrust = "pos_trust"
        case avgSeatDwellMin = "avg_seat_dwell_min"
        case turnsPerSeat = "turns_per_seat"
        case dwellTrust = "dwell_trust"
        case occupancyTrend = "occupancy_trend"
    }
}

struct NazarTrendPoint: Codable, Identifiable {
    private let lid = UUID()
    var id: String { lid.uuidString }
    let t: String?
    let v: Int?
}
