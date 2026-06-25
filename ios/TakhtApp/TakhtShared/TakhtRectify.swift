import Foundation

// ─────────────────────────────────────────────────────────────────────────────
// THE SOLVE FLOW — not "what was missed", but "fix it, one tap, never block".
//
// Reads the live leak map (open validation_errors) and applies the one-tap
// correction through the rectify engine, which writes the fix at the source
// (Odoo POS) and pre-validates every change against the 15 valid (M,W,R) tuples.
// The app PROPOSES; the engine GUARANTEES. Auth = the person's Darbar PIN.
// ─────────────────────────────────────────────────────────────────────────────

// One open error from /api/rectify?action=get-all-errors  (a validation_errors row)
struct TakhtOpenError: Codable, Identifiable {
    var id: Int
    var orderRef: String?
    var orderId: Int?
    var errorCode: String?
    var paymentMethodId: Int?
    var posConfigId: Int?
    var runnerSlot: String?
    var runnerPartnerId: Int?
    var odooPaymentId: Int?
    var detectedAt: String?
    var amount: Double?

    enum CodingKeys: String, CodingKey {
        case id
        case orderRef = "order_ref"
        case orderId = "order_id"
        case errorCode = "error_code"
        case paymentMethodId = "payment_method_id"
        case posConfigId = "pos_config_id"
        case runnerSlot = "runner_slot"
        case runnerPartnerId = "runner_partner_id"
        case odooPaymentId = "odoo_payment_id"
        case detectedAt = "detected_at"
        case amount
    }

    // Plain-English "what's wrong" — the worker reads this, not a code.
    var plainTitle: String {
        switch errorCode {
        case "missing_runner", "orphan_token":
            return "A runner's token order isn't tagged to anyone"
        case "wrong_method", "method_mismatch":
            return "Wrong payment method recorded"
        case "cross_runner", "cross_qr":
            return "Paid to the wrong runner's QR"
        default:
            return errorCode?.replacingOccurrences(of: "_", with: " ").capitalized ?? "Needs a correction"
        }
    }

    var currentState: String {
        let pm = TakhtPM.name(paymentMethodId)
        let who = runnerSlot ?? (runnerPartnerId != nil ? "partner \(runnerPartnerId!)" : "no runner")
        return "\(pm) · \(who)"
    }
}

// GET /api/rectify?action=get-all-errors&pin=
struct TakhtErrorsResponse: Codable {
    var success: Bool?
    var grouped: [String: [TakhtOpenError]]?
    var total: Int?
    var error: String?

    // Flattened, stable order: unassigned first, then runner slots.
    var allErrors: [TakhtOpenError] {
        guard let g = grouped else { return [] }
        let keys = g.keys.sorted { a, b in
            if a == "unassigned" { return true }
            if b == "unassigned" { return false }
            return a < b
        }
        return keys.flatMap { g[$0] ?? [] }
    }
}

// POST /api/rectify?action=fix-error  → tolerant decode (error is a row on success, a string on failure)
struct TakhtFixResponse: Decodable {
    let success: Bool
    let fixed: Bool?
    let message: String?
    enum CodingKeys: String, CodingKey { case success, fixed, error }
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: CodingKeys.self)
        success = (try? c.decode(Bool.self, forKey: .success)) ?? false
        fixed = try? c.decode(Bool.self, forKey: .fixed)
        message = try? c.decode(String.self, forKey: .error)   // only the failure-string survives
    }
}

// The fix actions the engine supports.
enum TakhtFix {
    case assignRunner(slot: String)
    case removeRunner
    case changeMethod(id: Int)

    var action: String {
        switch self {
        case .assignRunner: return "assign_runner"
        case .removeRunner: return "remove_runner"
        case .changeMethod: return "change_method"
        }
    }
    var runnerSlot: String? { if case let .assignRunner(s) = self { return s }; return nil }
    var paymentMethodId: Int? { if case let .changeMethod(id) = self { return id }; return nil }
}

// Picker option sets, mirrored from the rectify engine (it still validates).
enum TakhtPM {
    // The methods a cashier would re-tag to. Runner-tied methods (Ledger/Token) are set via assign.
    static let choices: [(id: Int, name: String)] = [(37, "Cash"), (38, "UPI"), (39, "Card"), (49, "Comp")]
    static func name(_ id: Int?) -> String {
        switch id { case 37: return "Cash"; case 38: return "UPI"; case 39: return "Card"
        case 40: return "Runner Ledger"; case 48: return "Token Issue"; case 49: return "Comp"
        default: return id.map { "PM \($0)" } ?? "—" }
    }
}
enum TakhtRunner {
    static let slots = ["RUN001", "RUN002", "RUN003", "RUN004", "RUN005"]
}
