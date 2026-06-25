import Foundation

// Takht — NCH sale-settlement witness (NCH repo, deployed at nawabichaihouse.com).
// RUPEES throughout — every amount is whole rupees. NEVER ÷100.
// Modelled from the LIVE owner-witness payloads verified 2026-06-20.

enum TakhtError: Error {
    case badURL
    case server(String)
}

// GET /api/settlement?action=verify-pin&pin=
struct TakhtVerifyResponse: Codable {
    var success: Bool?
    var user: String?
    var isCollector: Bool?
    var error: String?
}

// GET /api/settlement?action=counter-balance
struct TakhtBalanceResponse: Codable {
    var success: Bool?
    var balance: TakhtBalance?
    var error: String?
}

struct TakhtBalance: Codable {
    var total: Double?
    var totalSettled: Double?
    var pettyCash: Double?
    var runnerCash: Double?
    var counterCash: Double?
    var totalExpenses: Double?
    var settlementCount: Int?
    var since: String?

    enum CodingKeys: String, CodingKey {
        case total, totalSettled, pettyCash, runnerCash, counterCash, totalExpenses, settlementCount, since
    }
}

// GET /api/token-settlement?action=get-status
struct TakhtTokenResponse: Codable {
    var success: Bool?
    var lastSettlement: TakhtTokenSettlement?
    var error: String?
}

struct TakhtTokenSettlement: Codable {
    var settledAt: String?
    var tokenCount: Int?
    var odooTotalBeverages: Int?
    var discrepancy: Int?
    var notes: String?

    enum CodingKeys: String, CodingKey {
        case settledAt = "settled_at"
        case tokenCount = "token_count"
        case odooTotalBeverages = "odoo_total_beverages"
        case discrepancy, notes
    }
}

// GET /api/validator?action=razorpay-verify
struct TakhtUpiResponse: Codable {
    var success: Bool?
    var snapshots: [TakhtUpiSnapshot]?
    var discrepancies: [TakhtUpiDiscrepancy]?
    var error: String?
}

struct TakhtUpiSnapshot: Codable, Identifiable {
    var entity: String
    var razorpay: Double?
    var posUpi: Double?
    var excess: Double?
    var deficit: Double?
    var isRunnerQr: Bool?

    var id: String { entity }

    enum CodingKeys: String, CodingKey {
        case entity, razorpay, excess, deficit
        case posUpi = "pos_upi"
        case isRunnerQr = "is_runner_qr"
    }

    var gap: Double { (excess ?? 0) - (deficit ?? 0) }
    var isOff: Bool { abs(gap) > 1 }
}

struct TakhtUpiDiscrepancy: Codable, Identifiable {
    var entity: String
    var type: String
    var amount: Double?
    var desc: String?

    var id: String { entity + type }
}

// GET /api/settlement?action=current-shift
struct TakhtShiftResponse: Codable {
    var success: Bool?
    var current: TakhtShift?
    var reason: String?
    var error: String?
}

struct TakhtShift: Codable {
    var name: String?
    var shiftMinutes: Int?
    var stale: Bool?

    enum CodingKeys: String, CodingKey {
        case name, stale
        case shiftMinutes = "shift_minutes"
    }
}

// A plain-English flag, matching the "What was missed — read to staff" doctrine.
struct TakhtFlag: Identifiable {
    enum Level { case red, amber, green }
    let level: Level
    let title: String
    let cause: String
    var id: String { title }
}

enum TakhtFmt {
    // RUPEES — already whole rupees from the worker, never ÷100.
    static func rupee(_ v: Double?) -> String {
        let n = v ?? 0
        let f = NumberFormatter()
        f.numberStyle = .decimal
        f.maximumFractionDigits = 0
        f.locale = Locale(identifier: "en_IN")
        return "₹" + (f.string(from: NSNumber(value: n)) ?? "0")
    }
}
