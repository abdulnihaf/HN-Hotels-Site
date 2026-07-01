import Foundation

// Quant control room models. These mirror /api/quant-control defensively: the
// control API is allowed to be missing during rollout, so every field is optional.

struct QuantControlStatus: Decodable {
    let ok: Bool?
    let trade_date: String?
    let generated_at: Double?
    let phase: String?
    let gate: ExecutionGate?
    let scout: QuantScoutPlan?
    let timer: QuantTimerTrail?
    let broker: QuantBrokerTrail?
    let lab: QuantLabTrail?
    let capabilities: [QuantCapability]?
    let next_tick: QuantNextTick?
}

struct QuantScoutPlan: Decodable {
    let has_scout: Bool?
    let mode: String?
    let decision: String?
    let edge_state: String?
    let state: String?
    let primary_symbol: String?
    let candidates: [String]?
    let entry_paise: Int?
    let stop_paise: Int?
    let target_paise: Int?
    let qty: Int?
    let rank_reason: String?
}

struct QuantTimerTrail: Decodable {
    let available: Bool?
    let runs: [QuantTimerRun]?
    let events: [QuantTimerEvent]?
    let error: String?
}

struct QuantTimerRun: Decodable, Identifiable {
    let id: Int?
    let trade_date: String?
    let mode: String?
    let strategy: String?
    let primary_symbol: String?
    let proof_state: String?
    let status: String?
}

struct QuantTimerEvent: Decodable, Identifiable {
    let localId = UUID()
    let id: Int?
    let trade_date: String?
    let ts: String?
    let symbol: String?
    let state_before: String?
    let state_after: String?
    let decision: String?
    let ltp_paise: Int?
    let entry_paise: Int?
    let stop_paise: Int?
    let target_paise: Int?
    let qty: Int?
    let pnl_pct: Double?
    let broker_order_id: String?
    let broker_status: String?
    let failure_code: String?

    var identity: String { "\(id ?? 0)-\(localId.uuidString)" }

    enum CodingKeys: String, CodingKey {
        case id, trade_date, ts, symbol, state_before, state_after, decision
        case ltp_paise, entry_paise, stop_paise, target_paise, qty, pnl_pct
        case broker_order_id, broker_status, failure_code
    }
}

struct QuantBrokerTrail: Decodable {
    let orders: [QuantBrokerOrder]?
    let trades: [QuantBrokerTrade]?
    let positions: [QuantPosition]?
    let snapshot_at: Double?
    let flat_symbols: [String]?
}

struct QuantBrokerOrder: Decodable, Identifiable {
    let order_id: String?
    let exchange: String?
    let tradingsymbol: String?
    let transaction_type: String?
    let quantity: Int?
    let filled_quantity: Int?
    let order_type: String?
    let product: String?
    let average_price_paise: Int?
    let status: String?
    let status_message: String?
    let tag: String?
    let placed_at: Double?

    var id: String { order_id ?? "\(tradingsymbol ?? "order")-\(placed_at ?? 0)" }
}

struct QuantBrokerTrade: Decodable, Identifiable {
    let trade_id: String?
    let order_id: String?
    let exchange: String?
    let tradingsymbol: String?
    let transaction_type: String?
    let quantity: Int?
    let average_price_paise: Int?
    let product: String?
    let filled_at: Double?

    var id: String { trade_id ?? "\(order_id ?? "trade")-\(filled_at ?? 0)" }
}

struct QuantPosition: Decodable, Identifiable {
    let tradingsymbol: String?
    let quantity: Int?
    let product: String?
    let pnl_paise: Int?
    let day_buy_quantity: Int?
    let day_sell_quantity: Int?

    var id: String { "\(tradingsymbol ?? "position")-\(product ?? "")" }
}

struct QuantLabTrail: Decodable {
    let runs: [LabRun]?
}

struct QuantCapability: Decodable, Identifiable {
    let id: String
    let enabled: Bool?
    let state: String?
    let detail: String?
}

struct QuantNextTick: Decodable {
    let interval_sec: Int?
    let entry_deadline_ist: String?
    let hard_exit_ist: String?
    let default_mode: String?
    let auto_enabled: Bool?
    let real_enabled: Bool?
}

struct QuantTickResult: Decodable {
    let ok: Bool?
    let persisted: Bool?
    let decision: String?
    let state_after: String?
    let event: QuantTimerEvent?
    let error: String?
}

extension WealthClient {
    func quantControlStatus() async throws -> QuantControlStatus {
        let data = try await request(path: "/api/quant-control", query: ["action": "status"])
        do { return try JSONDecoder().decode(QuantControlStatus.self, from: data) }
        catch { throw WealthError.server("Decode quant_control_status: \(error.localizedDescription)") }
    }

    func quantControlTick(mode: String, allowReal: Bool = false) async throws -> QuantTickResult {
        let body: [String: Any] = ["mode": mode, "allow_real": allowReal]
        let raw = try JSONSerialization.data(withJSONObject: body)
        let data = try await request(path: "/api/quant-control",
                                     query: ["action": "tick"],
                                     method: "POST",
                                     rawBody: raw)
        do { return try JSONDecoder().decode(QuantTickResult.self, from: data) }
        catch { throw WealthError.server("Decode quant_control_tick: \(error.localizedDescription)") }
    }
}
