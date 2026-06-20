import Foundation

enum NazarBrand: String, Codable, Hashable {
    case he = "HE"
    case nch = "NCH"

    var routePath: String {
        switch self {
        case .he: return "/he/"
        case .nch: return "/nch/"
        }
    }
}

struct NazarCamera: Identifiable, Hashable {
    var id: String
    var label: String
    var brand: NazarBrand
    var priority: Bool

    var displayLabel: String { "\(brand.rawValue) \(label)" }

    static let catalog: [NazarCamera] = [
        NazarCamera(id: "he_cash_counter", label: "Cash Counter", brand: .he, priority: true),
        NazarCamera(id: "he_ground_floor_dinein", label: "Ground Floor", brand: .he, priority: true),
        NazarCamera(id: "he_first_floor_dinein", label: "First Floor", brand: .he, priority: false),
        NazarCamera(id: "he_first_floor_dinein_2", label: "First Floor 2", brand: .he, priority: true),
        NazarCamera(id: "he_kitchen_pass", label: "Kitchen Pass", brand: .he, priority: false),
        NazarCamera(id: "he_main_kitchen_door", label: "Main Kitchen", brand: .he, priority: false),
        NazarCamera(id: "he_main_kitchen_2", label: "Main Kitchen 2", brand: .he, priority: false),
        NazarCamera(id: "he_fried_chicken_kitchen", label: "Fried Chicken", brand: .he, priority: false),
        NazarCamera(id: "he_outdoor", label: "Frontage", brand: .he, priority: false),
        NazarCamera(id: "nch_cash_counter", label: "Cash Counter", brand: .nch, priority: true),
        NazarCamera(id: "nch_chai_counter", label: "Chai Counter", brand: .nch, priority: true),
        NazarCamera(id: "nch_full_outlet", label: "Full Outlet", brand: .nch, priority: true),
        NazarCamera(id: "nch_full_outlet_entrance", label: "Entrance", brand: .nch, priority: false),
        NazarCamera(id: "nch_kitchen", label: "Kitchen", brand: .nch, priority: true),
        NazarCamera(id: "nch_outdoor_2", label: "Outdoor 2", brand: .nch, priority: false),
        NazarCamera(id: "nch_outdoor_chai", label: "Outdoor Chai", brand: .nch, priority: false)
    ]
}

struct NazarHealthResponse: Codable, Hashable {
    var checked: String?
    var ts: Int?
    var camsOk: Bool?
    var camsUp: Int?
    var camsTotal: Int?
    var frozen: [String]?

    enum CodingKeys: String, CodingKey {
        case checked, ts, frozen
        case camsOk = "cams_ok"
        case camsUp = "cams_up"
        case camsTotal = "cams_total"
    }
}

struct NazarLiveCamera: Codable, Hashable, Identifiable {
    var id: String
    var label: String?
    var live: Int?
    var seenToday: Int?

    enum CodingKeys: String, CodingKey {
        case id, label, live
        case seenToday = "seen_today"
    }
}

struct NazarHELiveResponse: Codable, Hashable {
    var updated: String?
    var open: Bool?
    var cameras: [NazarLiveCamera]?
    var billsTotal: Int?
    var amtTotal: Int?
    var livePeople: Int?

    enum CodingKeys: String, CodingKey {
        case updated, open, cameras
        case billsTotal = "bills_total"
        case amtTotal = "amt_total"
        case livePeople = "live_people"
    }
}

struct NazarNCHLiveResponse: Codable, Hashable {
    var updated: String?
    var open: Bool?
    var orders: Int?
    var sales: Int?
}

struct NazarFlagsResponse: Codable, Hashable {
    var generatedAt: String?
    var updated: String?
    var open: Bool?
    var nActive: Int?
    var engine: NazarEngineInfo?

    enum CodingKeys: String, CodingKey {
        case updated, open, engine
        case generatedAt = "generated_at"
        case nActive = "n_active"
    }
}

struct NazarEngineInfo: Codable, Hashable {
    var mode: String?
    var lastError: String?

    enum CodingKeys: String, CodingKey {
        case mode
        case lastError = "last_error"
    }
}

struct NazarFrameStatus: Hashable, Identifiable {
    var id: String { camera.id }
    var camera: NazarCamera
    var httpStatus: Int
    var frameState: String
    var contentType: String
    var checkedAt: Date

    var isDegraded: Bool {
        httpStatus != 200 || !frameState.isEmpty || !contentType.lowercased().contains("image/jpeg")
    }

    var displayState: String {
        if !frameState.isEmpty { return frameState }
        if httpStatus != 200 { return "http \(httpStatus)" }
        if !contentType.lowercased().contains("image/jpeg") { return "not jpeg" }
        return "live poster ok"
    }
}
