import Foundation

// Hisab — daily operating P&L "reckoning". GET /api/daily-pnl?action=summary&brand=&date=&pin=
// Modelled from the LIVE payload (hnhotels.in, PIN 0305 verified 2026-06-20), not the description.
//
// DOCTRINE (must never break): honest-blocked-when-stale. When status=="blocked" every pnl money
// field is null — render an em-dash "—", NEVER 0, NEVER a guess. A null is a stale/unmet gate, not
// a zero. Gate reasons name the latest available upstream day verbatim ("sales mirror latest is …").
// Money is paise INTEGER → ÷100 only at display. Margins are basis points → bp/100 with one decimal.
struct HisabSummary: Codable, Hashable {
    var success: Bool?
    var brand: String?
    var brandLabel: String?
    var businessDate: String?
    var status: String?                 // blocked | draft | final
    var missingGates: [String]?
    var gates: HisabGates?
    var pnl: HisabPnl?
    var inputs: HisabInputs?
    var sourceHash: String?
    var finalRun: HisabFinalRun?
    var finalSourceChanged: Bool?
    var user: HisabUser?

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

struct HisabUser: Codable, Hashable {
    var name: String?
    var role: String?

    // canFinalize ⊂ {Nihaf(admin), Naveen(cfo), Faheem(asstmgr)}. The server gates 403; we ALSO
    // hide the freeze/bill affordances client-side per the soul. This module is READ-ONLY though,
    // so canFinalize only drives whether we *show* a "you can freeze on web" hint — no mutation here.
    var canFinalize: Bool {
        switch (role ?? "").lowercased() {
        case "admin", "cfo", "asstmgr": return true
        default: return false
        }
    }
}

struct HisabGate: Codable, Hashable {
    var ok: Bool?
    var reason: String?     // verbatim upstream-staleness reason when !ok
}

struct HisabGates: Codable, Hashable {
    var revenue: HisabGate?
    var anbarSettlement: HisabGate?
    var labor: HisabGate?
    var majorBills: HisabGate?

    enum CodingKeys: String, CodingKey {
        case revenue, labor
        case anbarSettlement = "anbar_settlement"
        case majorBills = "major_bills"
    }

    // Ordered for the vertical gate checklist (matches the web's 4-row order).
    var ordered: [(key: String, title: String, gate: HisabGate?)] {
        [
            ("revenue", "Revenue settlement", revenue),
            ("anbar_settlement", "Anbar consumption", anbarSettlement),
            ("labor", "Darbar labor", labor),
            ("major_bills", "Major bill allocation", majorBills),
        ]
    }
}

// All money fields nullable Int (paise). null == blocked/unmet gate → render "—", never 0.
struct HisabPnl: Codable, Hashable {
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

// Witnesses / cross-checks — read-only, NOT counted in COGS (Sauda spend ≠ COGS).
struct HisabInputs: Codable, Hashable {
    var revenue: HisabRevenueSource?
    var anbar: HisabAnbarSource?
    var labor: HisabLaborSource?

    enum CodingKeys: String, CodingKey {
        case revenue, anbar, labor
    }
}

struct HisabRevenueSource: Codable, Hashable {
    var latestDay: String?
    var orderCount: Int?
    var lastRecomputedAt: String?

    enum CodingKeys: String, CodingKey {
        case latestDay = "latest_day"
        case orderCount = "order_count"
        case lastRecomputedAt = "last_recomputed_at"
    }
}

struct HisabAnbarSource: Codable, Hashable {
    var id: Int?
    var latestDay: String?
    var settledAt: String?
    var witnesses: HisabWitnesses?

    enum CodingKeys: String, CodingKey {
        case id, witnesses
        case latestDay = "latest_day"
        case settledAt = "settled_at"
    }
}

struct HisabWitnesses: Codable, Hashable {
    var receipts: HisabRowsQty?
    var saudaPurchase: HisabRowsAmount?
    var saudaBothPurchase: HisabRowsAmount?
    var chickenDailyLedger: HisabChicken?

    enum CodingKeys: String, CodingKey {
        case receipts
        case saudaPurchase = "sauda_purchase"
        case saudaBothPurchase = "sauda_both_purchase"
        case chickenDailyLedger = "chicken_daily_ledger"
    }
}

struct HisabRowsQty: Codable, Hashable {
    var rows: Int?
    var qty: Double?
}

struct HisabRowsAmount: Codable, Hashable {
    var rows: Int?
    var amountPaise: Int?

    enum CodingKeys: String, CodingKey {
        case rows
        case amountPaise = "amount_paise"
    }
}

struct HisabChicken: Codable, Hashable {
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

struct HisabLaborSource: Codable, Hashable {
    var activeStaff: Int?

    enum CodingKeys: String, CodingKey {
        case activeStaff = "active_staff"
    }
}

struct HisabFinalRun: Codable, Hashable {
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
enum HisabBrand: String, CaseIterable, Identifiable {
    case he = "HE"
    case nch = "NCH"
    var id: String { rawValue }
    var label: String { self == .he ? "Hamza Express" : "Nawabi Chai House" }
}
