import Foundation

// Takht — NCH sale-settlement witness (NCH repo, deployed at nawabichaihouse.com).
// RUPEES, not paise — every amount here is already whole rupees, NEVER ÷100.
// Modelled from the LIVE owner-witness payloads (settlement / token-settlement / validator),
// curled + verified 2026-06-20.

// GET /api/settlement?action=verify-pin&pin=  → the auth handshake (only allowed POST-equivalent).
struct TakhtVerifyResponse: Codable {
    var success: Bool?
    var user: String?
    var isCollector: Bool?
    var error: String?
}

// GET /api/settlement?action=counter-balance  → the rupee total + cash/runner/expense witnesses.
struct TakhtBalanceResponse: Codable {
    var success: Bool?
    var balance: TakhtBalance?
    var error: String?
}

struct TakhtBalance: Codable {
    var total: Double?               // "cash that should reach your hand" — RUPEES
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

// GET /api/token-settlement?action=get-status  → goods/chai witness (token-box vs POS beverages).
struct TakhtTokenResponse: Codable {
    var success: Bool?
    var lastSettlement: TakhtTokenSettlement?
    var error: String?
}

struct TakhtTokenSettlement: Codable {
    var settledAt: String?
    var tokenCount: Int?              // weighed physical tokens
    var odooTotalBeverages: Int?     // POS beverages billed
    var discrepancy: Int?            // tokens − POS  (+ = chai served without a bill)
    var notes: String?

    enum CodingKeys: String, CodingKey {
        case settledAt = "settled_at"
        case tokenCount = "token_count"
        case odooTotalBeverages = "odoo_total_beverages"
        case discrepancy
        case notes
    }
}

// GET /api/validator?action=razorpay-verify  → UPI witness (Razorpay actually-received vs POS-billed).
struct TakhtUpiResponse: Codable {
    var success: Bool?
    var snapshots: [TakhtUpiSnapshot]?
    var discrepancies: [TakhtUpiDiscrepancy]?
    var error: String?
}

struct TakhtUpiSnapshot: Codable, Identifiable {
    var entity: String
    var razorpay: Double?            // RUPEES actually received
    var posUpi: Double?             // RUPEES POS recorded
    var excess: Double?
    var deficit: Double?
    var isRunnerQr: Bool?

    var id: String { entity }

    enum CodingKeys: String, CodingKey {
        case entity, razorpay, excess, deficit
        case posUpi = "pos_upi"
        case isRunnerQr = "is_runner_qr"
    }

    // Signed gap (Razorpay − POS), matching the owner-witness page maths.
    var gap: Double { (excess ?? 0) - (deficit ?? 0) }
    var isOff: Bool { abs(gap) > 1 }
}

struct TakhtUpiDiscrepancy: Codable, Identifiable {
    var entity: String
    var type: String                // "excess" | "deficit"
    var amount: Double?
    var desc: String?

    var id: String { entity + type }
}

// GET /api/settlement?action=current-shift  → who holds the counter now.
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
