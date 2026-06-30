import Foundation

// ─────────────────────────────────────────────────────────────────────────────
// Execution Lab — client layer.
// Talks to the hardened unified order door (functions/api/kite.js) deployed on
// trade.hnhotels.in. Every call is SIM (simulate=1, zero broker contact) or
// TINY-REAL (a real, Face-ID-gated, rupee-capped order). Nothing here flips
// block_real_orders or auto_real_trades_enabled.
// ─────────────────────────────────────────────────────────────────────────────

struct LabStep: Decodable, Identifiable {
    let name: String?
    let ok: Bool?
    let detail: String?
    private static var counter = 0
    let id = UUID()
    enum CodingKeys: String, CodingKey { case name, ok, detail }
}

struct LabSquared: Decodable, Identifiable {
    let tradingsymbol: String?
    let qty: Int?
    let product: String?
    let book: String?
    let ok: Bool?
    let error: String?
    let id = UUID()
    enum CodingKeys: String, CodingKey { case tradingsymbol, qty, product, book, ok, error }
}

struct LabKiteRaw: Decodable { let message: String?; let status: String? }

// One lenient result type for every order action (place_order / place_bracket /
// pipeline_test / square_off_all). Every field optional — the UI reads what's present.
struct LabResult: Decodable {
    let ok: Bool?
    let overall: String?          // pipeline_test: 'pass' | 'pass_simulated' | 'fail'
    let summary: String?
    let failed_step: String?
    let error: String?
    let message: String?
    let reason: String?
    let order_id: String?
    let deduped: Bool?
    let dedupe_reason: String?
    let simulated: Bool?
    let mode: String?
    let blocked: Bool?
    let naked_position: Bool?
    let naked_risk: Bool?
    let action_required: String?
    let gap_proof: Bool?
    let stop_type: String?
    let anchor_held: Bool?
    let fill_price: Double?
    let gtt_id: Int?
    let bracket_id: Int?
    let protective_sl_order_id: String?
    let fallback_used: Bool?
    let warning: String?
    let flat: Bool?
    let open_positions: Int?
    let open_holdings: Int?
    let http_status: Int?
    let squared: [LabSquared]?
    let remaining: [LabSquared]?
    let steps: [LabStep]?
    let kite_response: LabKiteRaw?

    // The single honest verdict the row shows.
    var didSucceed: Bool {
        if let o = overall { return o.hasPrefix("pass") }
        return ok == true
    }
    // The verbatim broker / server error — never paraphrased.
    var rawError: String? {
        if let k = kite_response?.message, !k.isEmpty { return k }
        if let e = error, !e.isEmpty { return e }
        if let r = reason, !r.isEmpty { return r }
        return nil
    }
    // If set, the row shows a one-tap fix button mapped to a real endpoint.
    var fix: LabFix? {
        if naked_position == true || naked_risk == true { return .squareOff }
        switch action_required {
        case "PLACE_STOP_OR_SQUAREOFF", "CHECK_AND_SQUAREOFF", "naked_position": return .squareOff
        case "pending_order": return .squareOff
        default: break
        }
        if didSucceed == false && deduped != true { return .retry }
        return nil
    }
}

enum LabFix { case squareOff, retry }

struct LabRun: Decodable, Identifiable {
    let id: Int
    let scenario: String?
    let kind: String?
    let mode: String?
    let symbol: String?
    let status: String?
    let created_at: String?
}
struct LabRunsResp: Decodable { let ok: Bool?; let runs: [LabRun]? }

extension WealthClient {
    /// The recent test-run trail (lab_runs table), newest first.
    func labRuns() async throws -> [LabRun] {
        let data = try await request(path: "/api/kite", query: ["action": "lab_runs"])
        return (try? JSONDecoder().decode(LabRunsResp.self, from: data))?.runs ?? []
    }

    private func labDecode(_ data: Data, _ what: String) throws -> LabResult {
        do { return try JSONDecoder().decode(LabResult.self, from: data) }
        catch { throw WealthError.server("Decode \(what): \(error.localizedDescription)") }
    }

    /// Full equity round-trip (BUY → poll fill → exit) with a per-step log.
    func labPipelineTest(symbol: String, qty: Int, sim: Bool) async throws -> LabResult {
        var q = ["action": "pipeline_test"]
        if sim { q["simulate"] = "1" }
        let body: [String: Any] = ["tradingsymbol": symbol, "exchange": "NSE", "quantity": qty, "product": "MIS",
                                   "bypass_market_hours": sim, "lab_tiny_real": !sim, "surface": "lab"]
        let raw = try JSONSerialization.data(withJSONObject: body)
        let data = try await request(path: "/api/kite", query: q, method: "POST", rawBody: raw)
        return try labDecode(data, "pipeline_test")
    }

    /// A single market order through the unified hardened door.
    func labPlaceOrder(exchange: String = "NSE", symbol: String, side: String, qty: Int,
                       product: String, orderType: String = "MARKET", refPricePaise: Int,
                       tag: String, sim: Bool, bypassMarketHours: Bool = false) async throws -> LabResult {
        var q = ["action": "place_order"]
        if sim { q["simulate"] = "1" }
        let body: [String: Any] = [
            "exchange": exchange, "tradingsymbol": symbol, "transaction_type": side,
            "quantity": qty, "product": product, "order_type": orderType,
            "ref_price": Double(refPricePaise) / 100.0, "tag": tag,
            "enforce_notional_cap": true, "bypass_funds_check": false,
            "bypass_market_hours": bypassMarketHours,
            "lab_tiny_real": !sim, "surface": "lab",
        ]
        let raw = try JSONSerialization.data(withJSONObject: body)
        let data = try await request(path: "/api/kite", query: q, method: "POST", rawBody: raw)
        return try labDecode(data, "place_order")
    }

    /// Emulated bracket: market BUY → true SL-M protective stop + GTT target.
    func labPlaceBracket(symbol: String, qty: Int, stop: Double, target: Double, tag: String, sim: Bool) async throws -> LabResult {
        var q = ["action": "place_bracket"]
        if sim { q["simulate"] = "1" }
        let body: [String: Any] = [
            "exchange": "NSE", "tradingsymbol": symbol, "quantity": qty,
            "stop_price": stop, "target_price": target,
            "product": "MIS", "order_type": "MARKET", "tag": tag,
            "bypass_market_hours": sim, "lab_tiny_real": !sim, "surface": "lab",
        ]
        let raw = try JSONSerialization.data(withJSONObject: body)
        let data = try await request(path: "/api/kite", query: q, method: "POST", rawBody: raw)
        return try labDecode(data, "place_bracket")
    }

    /// Panic button — flatten EVERY open position and holding (both products).
    func labSquareOffAll(sim: Bool) async throws -> LabResult {
        var q = ["action": "square_off_all"]
        if sim { q["simulate"] = "1" }
        let body: [String: Any] = ["bypass_market_hours": sim, "lab_tiny_real": !sim, "surface": "lab"]
        let raw = try JSONSerialization.data(withJSONObject: body)
        let data = try await request(path: "/api/kite", query: q, method: "POST", rawBody: raw)
        return try labDecode(data, "square_off_all")
    }

    /// Exit one symbol (full or partial). Used as the per-row one-tap fix.
    func labSquareOff(symbol: String, qty: Int? = nil, sim: Bool) async throws -> LabResult {
        var q = ["action": "square_off"]
        if sim { q["simulate"] = "1" }
        var body: [String: Any] = ["tradingsymbol": symbol, "bypass_market_hours": sim, "lab_tiny_real": !sim, "surface": "lab"]
        if let qty { body["quantity"] = qty }
        let raw = try JSONSerialization.data(withJSONObject: body)
        let data = try await request(path: "/api/kite", query: q, method: "POST", rawBody: raw)
        return try labDecode(data, "square_off")
    }
}
