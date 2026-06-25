import Foundation

// The live slot board — your command view of who is attributed at the counter.
// Backed by hnhotels.in/api/takht-resolver: runners are RUN01-05 (fixed slots);
// named staff (cashier/gm/manager/admin) resolve live to their Darbar person,
// so a departed cashier shows as a ghost instead of silently being credited.

struct TakhtResolverResponse: Codable {
    var ok: Bool?
    var brand: String?
    var runners: [TakhtRunnerSlot]?
    var slots: [TakhtSlot]?
    var flags: [TakhtResolverFlag]?
    var summary: TakhtResolverSummary?
    var error: String?
}

struct TakhtRunnerSlot: Codable, Identifiable {
    var slot_code: String
    var runner: String
    var partner_id: Int?
    var id: String { slot_code }
}

struct TakhtSlot: Codable, Identifiable {
    var slot_code: String
    var role: String
    var partner_id: Int?
    var label_was: String?
    var person: TakhtSlotPerson?
    var status: String          // slot | live | ghost | vacant
    var id: String { slot_code }
    var isStaff: Bool { role != "runner" }
}

struct TakhtSlotPerson: Codable { var id: Int?; var name: String? }

struct TakhtResolverFlag: Codable, Identifiable {
    var level: String           // red | amber | green
    var text: String
    var id: String { text }
}

struct TakhtResolverSummary: Codable {
    var slots: Int?
    var runners: Int?
    var staff_live: Int?
    var staff_ghost: Int?
}
