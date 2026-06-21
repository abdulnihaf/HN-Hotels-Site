import Foundation

// Sauda — the daily-buying chamber. FAITHFUL port of the deployed PWA (app-v62.js) + the real
// functions/api/sauda.js responses (mapped live 2026-06-20). Money is PAISE (Int) → ÷100 at display.
// Decode leniently (optionals) — modelled from the REAL payloads, not an interpretation.

// qty arrives as a String ("3", ".5") OR a number (20, 0.5) across lines — accept both.
struct AnyQty: Codable, Hashable {
    let text: String
    init(_ s: String) { text = s }
    init(from d: Decoder) throws {
        let c = try d.singleValueContainer()
        if let s = try? c.decode(String.self) { text = s }
        else if let i = try? c.decode(Int.self) { text = String(i) }
        else if let n = try? c.decode(Double.self) {
            text = n.truncatingRemainder(dividingBy: 1) == 0 ? String(Int(n)) : String(n)
        } else { text = "" }
    }
    func encode(to encoder: Encoder) throws { var c = encoder.singleValueContainer(); try c.encode(text) }
    var double: Double { Double(text.trimmingCharacters(in: .whitespaces)) ?? 0 }
    var isBlank: Bool { text.trimmingCharacters(in: .whitespaces).isEmpty }
}

// ── A purchase line (decoded from order.items_json, and reused in the vendor-ledger trail). ──
struct SaudaLine: Codable, Hashable, Identifiable {
    var item: String?
    var sku: String?
    var qty: AnyQty?
    var unit: String?
    var brand: String?
    var price_paise: Int?
    var order_id: Int?
    var line_idx: Int?
    // receipt / bill-basis fields (present once Anbar receives) — kept for cross-ref + display
    var yielded_kg: AnyQty?
    var delivered_kg: AnyQty?
    var daily_rate_paise: Int?
    var cost_paise: Int?
    var effective_price_paise: Int?
    var received_pieces: AnyQty?
    var received_note: String?
    var pack_label: String?
    var bill_qty: AnyQty?
    var bill_unit: String?
    var direct: Bool?
    var ref: String?

    var id: String { "\(order_id ?? 0)-\(line_idx ?? 0)-\(item ?? "")" }

    var qtyDisplay: String {
        let q = (qty?.text ?? "").trimmingCharacters(in: .whitespaces)
        let u = (unit ?? "").trimmingCharacters(in: .whitespaces)
        if q.isEmpty { return u.isEmpty ? "—" : u }
        return u.isEmpty ? q : "\(q) \(u)"
    }
    // line bill = receipt cost if present, else qty × per-unit rate
    var linePaise: Int {
        if let c = cost_paise, c > 0 { return c }
        let p = price_paise ?? 0
        return Int((qty?.double ?? 0) * Double(p))
    }
}

// ── Vendor bank details (order.bank / vendor.bank; may arrive as {}) ──
struct SaudaBank: Codable, Hashable {
    var account_name: String?
    var account_number: String?
    var ifsc: String?
    var bank: String?
    var branch: String?
    var account_last4: String?
    var qr_ref: String?
    var valid: Bool {
        (account_number?.isEmpty == false) && (ifsc?.isEmpty == false)
    }
}

// ── open / today / purchase-day: vendor-grouped orders ──
struct SaudaOpen: Codable, Hashable {
    var for_date: String?
    var orders: [SaudaOrder]?
}

struct SaudaOrder: Codable, Hashable, Identifiable {
    var ids: [Int]?
    var order_count: Int?
    var vendorKey: String?
    var vendor_name: String?
    var brand: String?              // brand_label: HE | NCH | both
    var vpa: String?
    var bank: SaudaBank?
    var bankLabel: String?
    var payRail: String?           // upi | bank | manual
    var cat: String?
    var fulfilmentLabel: String?
    var payLabel: String?
    var pay: String?               // per | khata_roll | …
    var items_json: String?
    var pay_amount_paise: Int?
    var amount_source: String?     // expected | anbar_receipt | pay_amount
    var actual_receipt_cost_paise: Int?
    var for_date: String?
    var for_dates: [String]?

    var id: String { (ids?.map(String.init).joined(separator: "-") ?? vendorKey ?? "") + (for_date ?? "") }

    var lines: [SaudaLine] {
        guard let j = items_json, let data = j.data(using: .utf8) else { return [] }
        return (try? JSONDecoder().decode([SaudaLine].self, from: data)) ?? []
    }
    var amountRupees: Double { Double(pay_amount_paise ?? 0) / 100 }
    var itemCount: Int { lines.count }
    // a line still needs its rate/bill entered (no price and no receipt cost)
    var needsBill: Bool {
        lines.contains { ($0.price_paise ?? 0) <= 0 && ($0.cost_paise ?? 0) <= 0 && !($0.qty?.isBlank ?? true) }
    }
}

// ── compare: your price vs every platform ──
struct SaudaCompare: Codable, Hashable {
    var items: [SaudaCompareItem]?
}
struct SaudaCompareItem: Codable, Hashable, Identifiable {
    var item_key: String?
    var label: String?
    var unit: String?
    var your_pack: String?
    var your_paise: Int?
    var your_unit_paise: Int?
    var sources: [SaudaCompareSource]?
    var cheapest_source: String?
    var beats_baseline: Bool?
    var save_unit_paise: Int?
    var id: String { item_key ?? label ?? UUID().uuidString }
}
struct SaudaCompareSource: Codable, Hashable {
    var source: String?
    var matched: String?
    var brand: String?
    var pack: String?
    var unit: String?
    var price_paise: Int?
    var unit_price_paise: Int?
    var image: String?
    var url: String?
}

// ── vendor-ledger: per-vendor billed / paid / outstanding + trail ──
struct SaudaVendorLedger: Codable, Hashable {
    var ok: Bool?
    var days: Int?
    var vendors: [SaudaLedgerVendor]?
}
struct SaudaLedgerVendor: Codable, Hashable, Identifiable {
    var vendorKey: String?         // vendor_id
    var vendor_name: String?
    var cat: String?
    var vpa: String?
    var bank: SaudaBank?
    var bankLabel: String?
    var payRail: String?
    var fulfilmentLabel: String?
    var payLabel: String?
    var pay: String?
    var order_count: Int?
    var ledger_event_count: Int?
    var entry_count: Int?
    var billed_paise: Int?
    var paid_paise: Int?
    var outstanding_paise: Int?
    var last_paid_at: String?
    var trail: [SaudaTrailEntry]?
    var id: String { vendorKey ?? vendor_name ?? UUID().uuidString }
    var outstandingRupees: Double { Double(outstanding_paise ?? 0) / 100 }
    var billedRupees: Double { Double(billed_paise ?? 0) / 100 }
    var paidRupees: Double { Double(paid_paise ?? 0) / 100 }
    var isDue: Bool { (outstanding_paise ?? 0) > 0 }
}
struct SaudaTrailEntry: Codable, Hashable, Identifiable {
    var id: AnyQty?                 // trail id arrives as int OR string — decode leniently
    var for_date: String?
    var status: String?
    var amount_paise: Int?
    var items: Int?
    var amount_source: String?
    var actual_receipt_cost_paise: Int?
    var ordered_at: String?
    var pay_requested_at: String?
    var paid_at: String?
    var method: String?
    var reconciled: Bool?
    var bank_ref: String?
    var lines: [SaudaLine]?
    var amountRupees: Double { Double(amount_paise ?? 0) / 100 }
}

// ── hyperpure-feed: tomorrow's mandi basket vs your usual price ──
struct SaudaHyperpure: Codable, Hashable {
    var items: [SaudaHpItem]?
    var count: Int?
    var scraped_at: String?
    var stale: Bool?
    var mov_paise: Int?
    var delivery_paise: Int?
    var window: SaudaHpWindow?
}
struct SaudaHpWindow: Codable, Hashable {
    var nowIstIso: String?
    var cutoff_hour: Int?
    var open: Bool?
    var mins_to_cutoff: Int?
    var for_date: String?
}
struct SaudaHpItem: Codable, Hashable, Identifiable {
    var item_key: String?
    var name: String?
    var label: String?
    var matched: String?
    var price_paise: Int?
    var unit_price_paise: Int?
    var unit: String?
    var pack: String?
    var brand: String?
    var image: String?
    var match_count: Int?
    var scraped_at: String?
    var your_unit_paise: Int?
    var your_pack: String?
    var your_unit: String?
    var verified: Bool?
    var verdict: String?           // cheaper | same | dearer | no-compare
    var pct: Int?
    var save_unit_paise: Int?
    var no_compare_reason: String?
    var id: String { item_key ?? label ?? name ?? UUID().uuidString }
}

// ── settings: the item + vendor master ──
struct SaudaSettings: Codable, Hashable {
    var ok: Bool?
    var seeded: Bool?
    var counts: SaudaSettingsCounts?
    var items: [SaudaItem]?
    var vendors: [SaudaSettingsVendor]?
}
struct SaudaSettingsCounts: Codable, Hashable {
    var items: Int?
    var vendors: Int?
    var aliases: Int?
}
struct SaudaItem: Codable, Hashable, Identifiable {
    var item_code: String?
    var label: String?
    var unit: String?
    var pack_label: String?
    var pack_qty: Double?
    var price_paise: Int?
    var price_mode: String?        // fixed | live
    var form: String?              // loose | defined
    var brand: String?
    var default_vendor: String?
    var category: String?
    var flagged: Int?
    var note: String?
    var aliases: [String]?
    var id: String { item_code ?? label ?? UUID().uuidString }
    var isLive: Bool { (price_mode ?? "").lowercased() == "live" }
    var isFlagged: Bool { (flagged ?? 0) != 0 }
    var hasPrice: Bool { (price_paise ?? 0) > 0 }
    var hasVendor: Bool { (default_vendor ?? "").isEmpty == false }
    var priceRupees: Double { Double(price_paise ?? 0) / 100 }
}
struct SaudaSettingsVendor: Codable, Hashable, Identifiable {
    var vendor_key: String?
    var name: String?
    var brand: String?
    var fulfilment: String?
    var pay: String?
    var phone: String?
    var vpa_json: String?
    var bank_json: String?
    var odoo_partner_id: Int?      // vendor_id (Odoo)
    var aliases_json: String?
    var cat: String?
    var flagged: Int?
    var vpas: [String]?
    var aliases: [String]?
    var bank: SaudaBank?
    var bankLabel: String?
    var payRail: String?
    var id: String { vendor_key ?? name ?? UUID().uuidString }
    var primaryVpa: String? { vpas?.first ?? (vpa_json?.isEmpty == false ? vpa_json : nil) }
    var needsFill: Bool {
        let noPhone = (phone ?? "").count < 7
        let noRail = (primaryVpa ?? "").isEmpty && !(bank?.valid ?? false)
        return noPhone || noRail
    }
}

// auth handshake response
struct SaudaAuthResponse: Codable { var token: String?; var ok: Bool?; var error: String? }
