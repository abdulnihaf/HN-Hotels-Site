import Foundation

// Anbar inventory board — GET /api/anbar?action=board (no PIN, both brands, one Odoo read).
// Modelled from the live payload, not the description.
struct AnbarBoardResponse: Codable, Hashable {
    var success: Bool?
    var asOf: String?
    var today: String?
    var odooOk: Bool?
    var nch: [AnbarItem]?
    var heChicken: [AnbarChicken]?

    enum CodingKeys: String, CodingKey {
        case success, today, nch
        case asOf = "as_of"
        case odooOk = "odoo_ok"
        case heChicken = "he_chicken"
    }
}

struct AnbarItem: Codable, Identifiable, Hashable {
    var code: String
    var name: String?
    var uom: String?
    var madeInHouse: Bool?
    var counter: AnbarLoc?
    var store: AnbarLoc?

    var id: String { code }

    enum CodingKeys: String, CodingKey {
        case code, name, uom, counter, store
        case madeInHouse = "made_in_house"
    }
}

struct AnbarLoc: Codable, Hashable {
    var lastCount: Int?
    var expected: Int?
    var sold: Int?
    var received: Int?
    var waste: Int?
    var state: String?           // ok | low | out | recount | uncounted | received
    var countedToday: Bool?

    enum CodingKeys: String, CodingKey {
        case expected, sold, received, waste, state
        case lastCount = "last_count"
        case countedToday = "counted_today"
    }

    var needsAttention: Bool {
        switch (state ?? "").lowercased() {
        case "out", "low", "recount": return true
        default: return false
        }
    }
}

struct AnbarChicken: Codable, Identifiable, Hashable {
    var cut: String
    var label: String?
    var onHandKg: Double?
    var state: String?

    var id: String { cut }

    enum CodingKeys: String, CodingKey {
        case cut, label, state
        case onHandKg = "on_hand_kg"
    }
}
