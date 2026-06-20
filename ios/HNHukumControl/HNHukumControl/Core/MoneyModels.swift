import Foundation

// Tijori — the money/cash/bank chamber. Models are ported 1:1 from the REAL deployed responses of
// /api/bank-feed, /api/money and /api/cash (verified live on hnhotels.in, pin-gated). Decode leniently.
//
// PAISE vs RUPEES (contract §5): bank-feed + cash return INTEGER paise → ÷100 at display.
// The /api/money cockpit + cash-position return RUPEES already (Odoo amounts) → show as-is.

// A JSON id field that is sometimes Int, sometimes String, sometimes null. We keep these cross-ref
// ids (matched_*, linked_po_*) so the coordinator can wire tap-throughs to Sauda/Takht/Darbar — so
// they must survive whatever type the backend emits without breaking the decode.
struct FlexId: Codable, Equatable {
    let value: String?
    var isPresent: Bool { (value?.isEmpty == false) }
    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { value = nil }
        else if let i = try? c.decode(Int.self) { value = String(i) }
        else if let d = try? c.decode(Double.self) { value = String(Int(d)) }
        else if let s = try? c.decode(String.self) { value = s.isEmpty ? nil : s }
        else { value = nil }
    }
}

enum MoneyFmt {
    /// paise (Int) → rupees (Double)
    static func r(_ paise: Int?) -> Double { Double(paise ?? 0) / 100.0 }
}

// MARK: - BANK  (/api/bank-feed)

struct BankSummary: Codable {
    let ok: Bool?
    let user: String?
    let balances: [BankBalance]?
    let today: BankFlow?
    let week: BankFlow?
    let month: BankFlow?
    let parseHealth: ParseHealth?
    let sourceHealth: [SourceHealth]?
    let anySourceStale: Bool?
    let lastIngestAt: String?
    let lastTxnAt: String?
    enum CodingKeys: String, CodingKey {
        case ok, user, balances, today, week, month
        case parseHealth = "parse_health"
        case sourceHealth = "source_health"
        case anySourceStale = "any_source_stale"
        case lastIngestAt = "last_ingest_at"
        case lastTxnAt = "last_txn_at"
    }
}

struct BankBalance: Codable, Identifiable {
    let instrument: String?
    let balancePaise: Int?
    let balanceRupees: Double?
    let asOf: String?
    var id: String { instrument ?? UUID().uuidString }
    var rupees: Double { balanceRupees ?? MoneyFmt.r(balancePaise) }
    enum CodingKeys: String, CodingKey {
        case instrument
        case balancePaise = "balance_paise"
        case balanceRupees = "balance_rupees"
        case asOf = "as_of"
    }
}

struct BankFlow: Codable {
    let creditPaise: Int?
    let debitPaise: Int?
    let nCredit: Int?
    let nDebit: Int?
    let netPaise: Int?
    let credit: Double?
    let debit: Double?
    let net: Double?
    var creditR: Double { credit ?? MoneyFmt.r(creditPaise) }
    var debitR: Double { debit ?? MoneyFmt.r(debitPaise) }
    var netR: Double { net ?? MoneyFmt.r(netPaise) }
    enum CodingKeys: String, CodingKey {
        case creditPaise = "credit_paise", debitPaise = "debit_paise"
        case nCredit = "n_credit", nDebit = "n_debit", netPaise = "net_paise"
        case credit, debit, net
    }
}

struct ParseHealth: Codable { let parsed: Int?; let partial: Int? }

struct SourceHealth: Codable, Identifiable {
    let source: String?
    let instrument: String?
    let lastEventAt: String?
    let status: String?
    let liveStatus: String?
    let ageMinutes: Double?
    let notes: String?
    var id: String { (source ?? "") + (instrument ?? "") }
    enum CodingKeys: String, CodingKey {
        case source, instrument, status, notes
        case lastEventAt = "last_event_at"
        case liveStatus = "live_status"
        case ageMinutes = "age_minutes"
    }
}

struct BankListResponse: Codable { let ok: Bool?; let rows: [BankRow]? }

struct BankRow: Codable, Identifiable {
    let id: Int
    let source: String?
    let sourceRef: String?
    let instrument: String?
    let txnAt: String?
    let direction: String?
    let amountPaise: Int?
    let channel: String?
    let counterparty: String?
    let counterpartyRef: String?
    let narration: String?
    let parseStatus: String?
    let reconcileStatus: String?
    let brand: String?
    let category: String?
    let settlementPlatform: String?
    let payeeName: String?
    // cross-ref provenance — keep so the coordinator can wire tap-throughs
    let matchedExpenseId: FlexId?
    let matchedVendorBillId: FlexId?
    let matchedPayoutPlatform: String?
    let matchedPayeeId: FlexId?
    var rupees: Double { MoneyFmt.r(amountPaise) }
    var isCredit: Bool { (direction ?? "") == "credit" }
    var who: String { payeeName ?? counterparty ?? counterpartyRef ?? (narration ?? "—") }
    enum CodingKeys: String, CodingKey {
        case id, source, instrument, direction, channel, counterparty, narration, brand, category
        case txnAt = "txn_at"
        case sourceRef = "source_ref"
        case amountPaise = "amount_paise"
        case counterpartyRef = "counterparty_ref"
        case parseStatus = "parse_status"
        case reconcileStatus = "reconcile_status"
        case settlementPlatform = "settlement_platform"
        case payeeName = "payee_name"
        case matchedExpenseId = "matched_expense_id"
        case matchedVendorBillId = "matched_vendor_bill_id"
        case matchedPayoutPlatform = "matched_payout_platform"
        case matchedPayeeId = "matched_payee_id"
    }
}

struct BankDailyResponse: Codable { let ok: Bool?; let days: Int?; let rows: [BankDailyRow]? }
struct BankDailyRow: Codable, Identifiable {
    let day: String?
    let creditPaise: Int?
    let debitPaise: Int?
    var id: String { day ?? UUID().uuidString }
    var creditR: Double { MoneyFmt.r(creditPaise) }
    var debitR: Double { MoneyFmt.r(debitPaise) }
    var netR: Double { creditR - debitR }
    enum CodingKeys: String, CodingKey {
        case day
        case creditPaise = "credit_paise"
        case debitPaise = "debit_paise"
    }
}

struct BankPayeesResponse: Codable { let ok: Bool?; let rows: [BankPayee]? }
struct BankPayee: Codable, Identifiable {
    let id: Int
    let name: String?
    let bank: String?
    let last4: String?
    let category: String?
    let role: String?
    let brand: String?
    let isOwnAccount: Int?
    let txnCount: Int?
    let paidPaise: Int?
    let receivedPaise: Int?
    let lastTxnAt: String?
    var paidR: Double { MoneyFmt.r(paidPaise) }
    var receivedR: Double { MoneyFmt.r(receivedPaise) }
    enum CodingKeys: String, CodingKey {
        case id, name, bank, last4, category, role, brand
        case isOwnAccount = "is_own_account"
        case txnCount = "txn_count"
        case paidPaise = "paid_paise"
        case receivedPaise = "received_paise"
        case lastTxnAt = "last_txn_at"
    }
}

struct BankAttention: Codable {
    let ok: Bool?
    let counts: AttentionCounts?
    let unmatched: [AttentionRow]?
    let unusual: [AttentionRow]?
    let unreconciled: [AttentionRow]?
}
struct AttentionCounts: Codable {
    let nUnmatched: Int?
    let nUnreconciled: Int?
    let nParseIssues: Int?
    enum CodingKeys: String, CodingKey {
        case nUnmatched = "n_unmatched"
        case nUnreconciled = "n_unreconciled"
        case nParseIssues = "n_parse_issues"
    }
}
struct AttentionRow: Codable, Identifiable {
    let id: Int
    let txnAt: String?
    let direction: String?
    let amountPaise: Int?
    let counterparty: String?
    let channel: String?
    let narration: String?
    var rupees: Double { MoneyFmt.r(amountPaise) }
    enum CodingKeys: String, CodingKey {
        case id, direction, counterparty, channel, narration
        case txnAt = "txn_at"
        case amountPaise = "amount_paise"
    }
}

// MARK: - MONEY COCKPIT  (/api/money?action=cockpit)  — amounts in RUPEES

struct MoneyUser: Codable { let name: String?; let role: String? }

struct MoneyCockpit: Codable {
    let success: Bool?
    let from: String?
    let to: String?
    let brand: String?
    let user: MoneyUser?
    let kpis: MoneyKpis?
    let paid: [MoneyLedgerRow]?
    let posOpen: [MoneyLedgerRow]?
    let billsPending: [MoneyLedgerRow]?
    let billsPaid: [MoneyLedgerRow]?
    let orphans: [MoneyLedgerRow]?
    let dupAlerts: [DupAlert]?
    let feedStatus: MoneyFeedStatus?
    enum CodingKeys: String, CodingKey {
        case success, from, to, brand, user, kpis, paid, orphans
        case posOpen = "pos_open"
        case billsPending = "bills_pending"
        case billsPaid = "bills_paid"
        case dupAlerts = "dup_alerts"
        case feedStatus = "feed_status"
    }
}

struct MoneyKpis: Codable {
    let paidTotal: Double?
    let paidCount: Int?
    let openPoTotal: Double?
    let openPoCount: Int?
    let billsPendingTotal: Double?
    let billsPendingCount: Int?
    let billsOverdueCount: Int?
    let orphanCount: Int?
    let dupCount: Int?
    enum CodingKeys: String, CodingKey {
        case paidTotal = "paid_total"
        case paidCount = "paid_count"
        case openPoTotal = "open_po_total"
        case openPoCount = "open_po_count"
        case billsPendingTotal = "bills_pending_total"
        case billsPendingCount = "bills_pending_count"
        case billsOverdueCount = "bills_overdue_count"
        case orphanCount = "orphan_count"
        case dupCount = "dup_count"
    }
}

// One normalized ledger line (paid / open PO / bill / orphan). amount in RUPEES.
struct MoneyLedgerRow: Codable, Identifiable {
    let feed: String?
    let source: String?
    let brand: String?
    let kind: String?
    let state: String?
    let paymentMethod: String?
    let odooId: Int?
    let odooName: String?
    let recordedAt: String?
    let istDate: String?
    let amount: Double?
    let vendorId: Int?
    let vendorName: String?
    let item: String?
    let description: String?
    let recordedBy: String?       // requested_by / staff → Darbar identity (cross-ref §3)
    let attachmentCount: Int?
    var id: String { (feed ?? "") + "-" + (odooName ?? odooId.map(String.init) ?? UUID().uuidString) }
    enum CodingKeys: String, CodingKey {
        case feed, source, brand, kind, state, amount, item, description
        case paymentMethod = "payment_method"
        case odooId = "odoo_id"
        case odooName = "odoo_name"
        case recordedAt = "recorded_at"
        case istDate = "ist_date"
        case vendorId = "vendor_id"
        case vendorName = "vendor_name"
        case recordedBy = "recorded_by"
        case attachmentCount = "attachment_count"
    }
}

// Cross-kind PO↔outlet-cash double-count suspect. Shape kept loose (all optional) — currently empty.
struct DupAlert: Codable, Identifiable {
    let kind: String?
    let brand: String?
    let confidence: Double?
    let vendorMatch: Double?
    let amountDiff: Double?
    let dateGap: Int?
    let summary: String?
    var id: String { (kind ?? "dup") + (summary ?? UUID().uuidString) }
    enum CodingKeys: String, CodingKey {
        case kind, brand, confidence, summary
        case vendorMatch = "vendor_match"
        case amountDiff = "amount_diff"
        case dateGap = "date_gap"
    }
}

struct MoneyFeedStatus: Codable {
    let nchExport: String?
    let heExport: String?
    let odooPos: String?
    let odooBills: String?
    enum CodingKeys: String, CodingKey {
        case nchExport = "nch_export"
        case heExport = "he_export"
        case odooPos = "odoo_pos"
        case odooBills = "odoo_bills"
    }
}

// MARK: - CASH POSITION  (/api/money?action=cash-position)  — amounts in RUPEES

struct CashPosition: Codable {
    let success: Bool?
    let asOf: String?
    let bank: CPBank?
    let cash: CPCash?
    let todayOutflow: CPOutflow?
    let grandTotal: Double?
    let feedStatus: CPFeed?
    enum CodingKeys: String, CodingKey {
        case success, bank, cash
        case asOf = "as_of"
        case todayOutflow = "today_outflow"
        case grandTotal = "grand_total"
        case feedStatus = "feed_status"
    }
}
struct CPBank: Codable {
    let total: Double?
    let accounts: [CPAccount]?
    let weekNet: Double?
    let monthNet: Double?
    let lastIngestAt: String?
    let anyStale: Bool?
    enum CodingKeys: String, CodingKey {
        case total, accounts
        case weekNet = "week_net"
        case monthNet = "month_net"
        case lastIngestAt = "last_ingest_at"
        case anyStale = "any_stale"
    }
}
struct CPAccount: Codable, Identifiable {
    let instrument: String?
    let label: String?
    let amount: Double?
    let asOf: String?
    let stale: Bool?
    var id: String { instrument ?? UUID().uuidString }
    enum CodingKeys: String, CodingKey { case instrument, label, amount, stale; case asOf = "as_of" }
}
struct CPCash: Codable {
    let total: Double?
    let pettyNch: Double?
    let inTransitTotal: Double?
    let inTransitBreakdown: String?
    let inTransitCount: Int?
    enum CodingKeys: String, CodingKey {
        case total
        case pettyNch = "petty_nch"
        case inTransitTotal = "in_transit_total"
        case inTransitBreakdown = "in_transit_breakdown"
        case inTransitCount = "in_transit_count"
    }
}
struct CPOutflow: Codable {
    let nchCounter: Double?
    let heCounter: Double?
    let total: Double?
    enum CodingKeys: String, CodingKey {
        case total
        case nchCounter = "nch_counter"
        case heCounter = "he_counter"
    }
}
struct CPFeed: Codable { let bank: String?; let nch: String?; let he: String? }

// MARK: - CASH TRAIL  (/api/cash)  — paise

struct CashTrailResponse: Codable {
    let success: Bool?
    let asOf: String?
    let balances: [CashPile]?
    let totalPaise: Int?
    let totalRupees: Double?
    let pending: CashPending?
    let ledger: [CashRow]?
    let user: String?
    var totalR: Double { totalRupees ?? MoneyFmt.r(totalPaise) }
    enum CodingKeys: String, CodingKey {
        case success, balances, pending, ledger, user
        case asOf = "as_of"
        case totalPaise = "total_paise"
        case totalRupees = "total_rupees"
    }
}

struct CashPile: Codable, Identifiable {
    let instrument: String?
    let balancePaise: Int?
    let balanceRupees: Double?
    let anchorAt: String?
    let anchorPaise: Int?
    let eventCount: Int?
    let lastEventAt: String?
    let label: String?
    var id: String { instrument ?? UUID().uuidString }
    var rupees: Double { balanceRupees ?? MoneyFmt.r(balancePaise) }
    enum CodingKeys: String, CodingKey {
        case instrument, label
        case balancePaise = "balance_paise"
        case balanceRupees = "balance_rupees"
        case anchorAt = "anchor_at"
        case anchorPaise = "anchor_paise"
        case eventCount = "event_count"
        case lastEventAt = "last_event_at"
    }
}

struct CashPending: Codable {
    let nchRunnersPaise: Int?
    let heCaptainsPaise: Int?
    let totalPaise: Int?
    let totalRupees: Double?
    let breakdown: [CashPendingItem]?
    var totalR: Double { totalRupees ?? MoneyFmt.r(totalPaise) }
    enum CodingKeys: String, CodingKey {
        case breakdown
        case nchRunnersPaise = "nch_runners_paise"
        case heCaptainsPaise = "he_captains_paise"
        case totalPaise = "total_paise"
        case totalRupees = "total_rupees"
    }
}
struct CashPendingItem: Codable, Identifiable {
    let pile: String?
    let who: String?
    let paise: Int?
    var id: String { (pile ?? "") + "-" + (who ?? UUID().uuidString) }
    var rupees: Double { MoneyFmt.r(paise) }
}

struct CashRow: Codable, Identifiable {
    let id: Int
    let instrument: String?
    let direction: String?
    let amountPaise: Int?
    let source: String?
    let sourceRef: String?
    let brand: String?
    let txnAt: String?
    let recordedAt: String?
    let recordedByPin: String?     // Darbar staff_pin = the identity root (cross-ref §6)
    let recordedByName: String?
    let vendorName: String?
    let category: String?
    let notes: String?
    // cross-ref provenance — keep for tap-throughs to Sauda PO / Takht settlement / Darbar staff
    let linkedPoId: FlexId?
    let linkedPoName: String?
    let matchedExpenseId: FlexId?
    let matchedSettlementId: FlexId?
    let matchedCollectionId: FlexId?
    let matchedPosOrderId: FlexId?
    let matchedShiftId: FlexId?
    let transferGroupId: FlexId?
    var rupees: Double { MoneyFmt.r(amountPaise) }
    var isCredit: Bool { (direction ?? "") == "credit" }
    enum CodingKeys: String, CodingKey {
        case id, instrument, direction, source, brand, category, notes
        case amountPaise = "amount_paise"
        case sourceRef = "source_ref"
        case txnAt = "txn_at"
        case recordedAt = "recorded_at"
        case recordedByPin = "recorded_by_pin"
        case recordedByName = "recorded_by_name"
        case vendorName = "vendor_name"
        case linkedPoId = "linked_po_id"
        case linkedPoName = "linked_po_name"
        case matchedExpenseId = "matched_expense_id"
        case matchedSettlementId = "matched_settlement_id"
        case matchedCollectionId = "matched_collection_id"
        case matchedPosOrderId = "matched_pos_order_id"
        case matchedShiftId = "matched_shift_id"
        case transferGroupId = "transfer_group_id"
    }
    /// the short linked-ref pills the PWA shows in its "Linked" column (stl#/col#/PO/shift#)
    var linkedRefs: [String] {
        var out: [String] = []
        if let v = linkedPoName, !v.isEmpty { out.append(v) }
        else if let v = linkedPoId?.value { out.append("PO#\(v)") }
        if let v = matchedSettlementId?.value { out.append("stl#\(v)") }
        if let v = matchedCollectionId?.value { out.append("col#\(v)") }
        if let v = matchedShiftId?.value { out.append("shift#\(v)") }
        if let v = matchedExpenseId?.value { out.append("be#\(v)") }
        if let v = matchedPosOrderId?.value { out.append("ord#\(v)") }
        if let v = transferGroupId?.value, !v.isEmpty { out.append("xfer") }
        return out
    }
}

struct CashSyncResponse: Codable { let success: Bool?; let sources: [CashSyncRow]? }
struct CashSyncRow: Codable, Identifiable {
    let syncSource: String?
    let lastSyncedAt: String?
    let lastRunAt: String?
    let lastRunStatus: String?
    let lastError: String?
    let rowsAddedTotal: Int?
    let notes: String?
    var id: String { syncSource ?? UUID().uuidString }
    enum CodingKeys: String, CodingKey {
        case notes
        case syncSource = "sync_source"
        case lastSyncedAt = "last_synced_at"
        case lastRunAt = "last_run_at"
        case lastRunStatus = "last_run_status"
        case lastError = "last_error"
        case rowsAddedTotal = "rows_added_total"
    }
}

enum MoneyError: LocalizedError {
    case badURL, unauthorized, unreachable, server(String)
    var errorDescription: String? {
        switch self {
        case .badURL: return "Bad Tijori URL"
        case .unauthorized: return "PIN rejected"
        case .unreachable: return "Source unreachable"
        case .server(let m): return m
        }
    }
}
