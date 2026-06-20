import Foundation

// ───────────────────────────────────────────────────────────────────────────
// Hisaab — daily operating P&L ("the reckoning"). GET /api/daily-pnl?action=summary
// Modelled from the LIVE payload (hnhotels.in, X-Ops-Pin 0305, verified 2026-06-20),
// not from a description — every key here was seen on the wire.
//
// DOCTRINE (must never break): honest-blocked-when-stale. A money field is NULL when
// ITS gate is blocked — render an em-dash "—", NEVER 0, NEVER a guess. Gate reasons
// name the latest available upstream day verbatim ("sales mirror latest is …").
// Money is paise INTEGER → ÷100 only at display. Margins are basis points → bp/100.
// ───────────────────────────────────────────────────────────────────────────

struct HisaabSummary: Codable, Hashable {
    var success: Bool?
    var brand: String?
    var brandLabel: String?
    var businessDate: String?
    var status: String?                 // blocked | draft | final
    var missingGates: [String]?
    var gates: HisaabGates?
    var pnl: HisaabPnl?
    var inputs: HisaabInputs?
    var sourceHash: String?
    var finalRun: HisaabFinalRun?
    var finalSourceChanged: Bool?
    var user: HisaabUser?

    enum CodingKeys: String, CodingKey {
        case success, brand, status, gates, pnl, inputs, user
        case brandLabel = "brand_label"
        case businessDate = "business_date"
        case missingGates = "missing_gates"
        case sourceHash = "source_hash"
        case finalRun = "final_run"
        case finalSourceChanged = "final_source_changed"
    }
}

struct HisaabUser: Codable, Hashable {
    var name: String?
    var role: String?

    // canFinalize ⊂ {Nihaf(admin), Naveen(cfo), Faheem(asstmgr)}. READ-ONLY module:
    // this only drives whether we show a calm "freeze on web" hint — never a mutation.
    var canFinalize: Bool {
        switch (role ?? "").lowercased() {
        case "admin", "cfo", "asstmgr": return true
        default: return false
        }
    }
}

struct HisaabGate: Codable, Hashable {
    var ok: Bool?
    var reason: String?     // verbatim upstream-staleness reason when !ok
}

struct HisaabGates: Codable, Hashable {
    var revenue: HisaabGate?
    var anbarSettlement: HisaabGate?
    var labor: HisaabGate?
    var majorBills: HisaabGate?

    enum CodingKeys: String, CodingKey {
        case revenue, labor
        case anbarSettlement = "anbar_settlement"
        case majorBills = "major_bills"
    }

    // Ordered for the gate checklist (matches the web's 4-row order).
    var ordered: [HisaabGateRow] {
        [
            HisaabGateRow(key: "revenue", title: "Revenue settlement", gate: revenue),
            HisaabGateRow(key: "anbar_settlement", title: "Anbar consumption", gate: anbarSettlement),
            HisaabGateRow(key: "labor", title: "Darbar labor", gate: labor),
            HisaabGateRow(key: "major_bills", title: "Major bill allocation", gate: majorBills),
        ]
    }
}

struct HisaabGateRow: Identifiable, Hashable {
    let key: String
    let title: String
    let gate: HisaabGate?
    var id: String { key }
}

// All money fields nullable Int (paise). null == that gate is blocked → render "—", never 0.
struct HisaabPnl: Codable, Hashable {
    var revenuePaise: Int?
    var rawCogsPaise: Int?
    var grossFoodProfitPaise: Int?
    var grossFoodMarginBp: Int?
    var laborPaise: Int?
    var majorBillsPaise: Int?
    var operatingProfitPaise: Int?
    var operatingMarginBp: Int?

    enum CodingKeys: String, CodingKey {
        case revenuePaise = "revenue_paise"
        case rawCogsPaise = "raw_cogs_paise"
        case grossFoodProfitPaise = "gross_food_profit_paise"
        case grossFoodMarginBp = "gross_food_margin_bp"
        case laborPaise = "labor_paise"
        case majorBillsPaise = "major_bills_paise"
        case operatingProfitPaise = "operating_profit_paise"
        case operatingMarginBp = "operating_margin_bp"
    }
}

struct HisaabInputs: Codable, Hashable {
    var revenue: HisaabRevenueSource?
    var anbar: HisaabAnbarSource?
    var labor: HisaabLaborSource?

    enum CodingKeys: String, CodingKey {
        case revenue, anbar, labor
    }
}

struct HisaabRevenueSource: Codable, Hashable {
    var latestDay: String?
    var orderCount: Int?
    var lastRecomputedAt: String?

    enum CodingKeys: String, CodingKey {
        case latestDay = "latest_day"
        case orderCount = "order_count"
        case lastRecomputedAt = "last_recomputed_at"
    }
}

// CROSS-WIRE #2 (Hisaab COGS → Anbar consumption): keep the rm_settlements identity
// behind raw_cogs so the coordinator can tap-through COGS → the Anbar settlement that
// produced it. id + settlement_date + period span ARE that consumption key.
struct HisaabAnbarSource: Codable, Hashable {
    var id: Int?                     // rm_settlements row id  ← consumption key
    var settlementDate: String?      // the consumed day        ← consumption key
    var settledAt: String?
    var settledBy: String?
    var periodStart: String?
    var periodEnd: String?
    var latestDay: String?
    var witnesses: HisaabWitnesses?

    enum CodingKeys: String, CodingKey {
        case id, witnesses
        case settlementDate = "settlement_date"
        case settledAt = "settled_at"
        case settledBy = "settled_by"
        case periodStart = "period_start"
        case periodEnd = "period_end"
        case latestDay = "latest_day"
    }
}

struct HisaabWitnesses: Codable, Hashable {
    var receipts: HisaabRowsQty?
    var saudaPurchase: HisaabRowsAmount?
    var saudaBothPurchase: HisaabRowsAmount?
    var chickenDailyLedger: HisaabChicken?

    enum CodingKeys: String, CodingKey {
        case receipts
        case saudaPurchase = "sauda_purchase"
        case saudaBothPurchase = "sauda_both_purchase"
        case chickenDailyLedger = "chicken_daily_ledger"
    }
}

struct HisaabRowsQty: Codable, Hashable {
    var rows: Int?
    var qty: Double?
}

struct HisaabRowsAmount: Codable, Hashable {
    var rows: Int?
    var amountPaise: Int?

    enum CodingKeys: String, CodingKey {
        case rows
        case amountPaise = "amount_paise"
    }
}

struct HisaabChicken: Codable, Hashable {
    var rows: Int?
    var costPaise: Int?
    var usableKg: Double?
    var deliveredKg: Double?

    enum CodingKeys: String, CodingKey {
        case rows
        case costPaise = "cost_paise"
        case usableKg = "usable_kg"
        case deliveredKg = "delivered_kg"
    }
}

// CROSS-WIRE #6 (Darbar staff_pin = identity root): keep the labor roster rows incl.
// each staff `pin` (= staff_pin) + id + name, so the coordinator can tap a labor line
// through to that person in Darbar. We never display the PIN — we carry it for routing.
struct HisaabLaborSource: Codable, Hashable {
    var table: String?
    var method: String?
    var activeStaff: Int?
    var staff: [HisaabStaff]?

    enum CodingKeys: String, CodingKey {
        case table, method, staff
        case activeStaff = "active_staff"
    }
}

struct HisaabStaff: Codable, Hashable, Identifiable {
    var id: Int?
    var pin: String?                 // staff_pin — identity root (carry, never show)
    var name: String?
    var dailyCostPaise: Int?
    var attendanceStatus: String?

    enum CodingKeys: String, CodingKey {
        case id, pin, name
        case dailyCostPaise = "daily_cost_paise"
        case attendanceStatus = "attendance_status"
    }
}

struct HisaabFinalRun: Codable, Hashable {
    var id: Int?
    var businessDate: String?
    var sourceHash: String?
    var createdBy: String?
    var finalizedAt: String?

    enum CodingKeys: String, CodingKey {
        case id
        case businessDate = "business_date"
        case sourceHash = "source_hash"
        case createdBy = "created_by"
        case finalizedAt = "finalized_at"
    }
}

// Brand toggle.
enum HisaabBrand: String, CaseIterable, Identifiable {
    case he = "HE"
    case nch = "NCH"
    var id: String { rawValue }
    var label: String { self == .he ? "Hamza Express" : "Nawabi Chai House" }
    var chip: String { rawValue }
}

// Money + margin display — paise ÷100, null → em-dash (NEVER 0). Mirrors web Intl en-IN.
enum HisaabFmt {
    private static let rupeeFmt: NumberFormatter = {
        let f = NumberFormatter()
        f.numberStyle = .decimal
        f.maximumFractionDigits = 0
        f.locale = Locale(identifier: "en_IN")
        return f
    }()

    // null paise → "—" (the honest-blocked render). Never returns ₹0 for a null.
    static func rupees(_ paise: Int?) -> String {
        guard let paise else { return "—" }
        let rupees = Double(paise) / 100.0
        return "₹" + (rupeeFmt.string(from: NSNumber(value: rupees)) ?? "0")
    }

    // basis points → "42.5%"; null → "—".
    static func marginPct(_ bp: Int?) -> String {
        guard let bp else { return "—" }
        return String(format: "%.1f%%", Double(bp) / 100.0)
    }

    static func kg(_ v: Double?) -> String { String(format: "%.1f kg", v ?? 0) }
}
