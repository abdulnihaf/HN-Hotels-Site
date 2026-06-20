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
    var period: TakhtPeriod?         // settlement window (from/to) — cross-ref for Darbar/Nazar correlation
    var snapshots: [TakhtUpiSnapshot]?
    var discrepancies: [TakhtUpiDiscrepancy]?
    var error: String?
}

// The settlement period window — a cross-ref key so the coordinator can line Takht up with
// Darbar shifts and Nazar flags over the same window.
struct TakhtPeriod: Codable {
    var from: String?
    var to: String?
}

struct TakhtUpiSnapshot: Codable, Identifiable {
    var entity: String              // COUNTER / RUNNER_COUNTER / RUN001…RUN005 — runner-identity cross-ref
    var razorpay: Double?            // RUPEES actually received
    var posUpi: Double?             // RUPEES POS recorded
    var excess: Double?             // raw integer kept (not just the derived gap)
    var deficit: Double?            // raw integer kept
    var isRunnerQr: Bool?           // links this QR to a runner identity
    var rzpCount: Int?              // Razorpay txn count on this QR

    var id: String { entity }

    enum CodingKeys: String, CodingKey {
        case entity, razorpay, excess, deficit
        case posUpi = "pos_upi"
        case isRunnerQr = "is_runner_qr"
        case rzpCount = "rzp_count"
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
    var name: String?               // cashier display name
    var code: String?               // cashier slot code (CASH001…) — links to the Darbar staff identity
    var shiftMinutes: Int?
    var stale: Bool?

    enum CodingKeys: String, CodingKey {
        case name, code, stale
        case shiftMinutes = "shift_minutes"
    }
}

// GET /api/settlement?action=shift-preview  → drawer-preview witness. The live PWA fetches this in
// parallel but renders no section from it; kept here (decoded, not invented) for the coordinator to
// correlate the expected drawer + UPI variance with the rest of the chain.
struct TakhtPreviewResponse: Codable {
    var success: Bool?
    var periodStart: String?
    var runnerCashReceived: Double?
    var pm37WalkIn: Double?
    var expensesTotal: Double?
    var cashCollections: Double?
    var expectedDrawer: Double?
    var upiSnapshot: TakhtPreviewUpi?

    enum CodingKeys: String, CodingKey {
        case success
        case periodStart = "period_start"
        case runnerCashReceived = "runner_cash_received"
        case pm37WalkIn = "pm37_walk_in"
        case expensesTotal = "expenses_total"
        case cashCollections = "cash_collections"
        case expectedDrawer = "expected_drawer"
        case upiSnapshot = "upi_snapshot"
    }
}

struct TakhtPreviewUpi: Codable {
    var odooPm38: Double?
    var rzpCounter: Double?
    var variance: Double?
    var flag: Bool?

    enum CodingKeys: String, CodingKey {
        case odooPm38 = "odoo_pm38"
        case rzpCounter = "rzp_counter"
        case variance, flag
    }
}
