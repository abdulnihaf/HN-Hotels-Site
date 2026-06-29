import Foundation
import Security

enum WealthError: LocalizedError {
    case badURL
    case unauthorized
    case server(String)
    case empty

    var errorDescription: String? {
        switch self {
        case .badURL:        return "Bad request URL."
        case .unauthorized:  return "Unauthorized (dashboard key rejected)."
        case .server(let m): return m
        case .empty:         return "Empty response from trade.hnhotels.in."
        }
    }
}

// ───────────────────────── Models (defensive: optionals where the API may omit) ─────────────────────────

struct KiteStatus: Decodable {
    let connected: Bool?
    let reason: String?
    let user_name: String?
    let expires_in_min: Int?
}

struct ReadinessGate: Decodable, Identifiable {
    let key: String
    let pass: Bool
    let label: String
    let target: String?
    var id: String { key }
}
struct Readiness: Decodable {
    let overall_ready: Bool?
    let passing: String?
    let gates: [ReadinessGate]?
}

struct AutoTraderSummary: Decodable {
    let total_positions: Int?
    let total_deployed_paise: Int?
    let total_pnl_realized_paise: Int?
}
struct AutoTraderState: Decodable {
    let today: String?
    let summary: AutoTraderSummary?
}

struct RegimeExplainer: Decodable { let tone: String?; let desc: String? }
struct RegimeEvidence: Decodable {
    let india_vix: Double?
    let nifty_20d_pct: String?   // API sends these as strings ("0.48")
    let nifty_50d_pct: String?
}
struct Regime: Decodable { let current: String?; let explainer: RegimeExplainer?; let evidence: RegimeEvidence? }
struct DimHealth: Decodable, Identifiable {
    let dim: String
    let coverage_pct: Double?
    var id: String { dim }
}
struct MTFDist: Decodable, Identifiable {
    let mtf_alignment: String?
    let n: Int?
    var id: String { mtf_alignment ?? "null" }
}
struct MTFAlignment: Decodable {
    let total_universe: Int?
    let distribution: [MTFDist]?
    let vetoed_pct: Double?
}
struct EngineState: Decodable {
    let regime: Regime?
    let dim_health: [DimHealth]?
    let mtf_alignment: MTFAlignment?
    let max_score_today: Double?
    let threshold: Double?
    let cards_today: Int?
}

// The 09:40 IST plan numbers. recommended_plan_json may arrive as a JSON object OR a
// stringified JSON (the repo's `_json` convention), and qty/prices may be num-or-string —
// so decode defensively. (Verdict is {ok:false} before 09:40, so this is unobservable now.)
struct VerdictPlan: Decodable {
    let entry: Double?
    let stop: Double?
    let target: Double?
    let qty: Int?
    let rr: Double?

    enum CodingKeys: String, CodingKey { case entry, stop, target, qty, rr }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        func dbl(_ k: CodingKeys) -> Double? {
            if let d = try? c.decode(Double.self, forKey: k) { return d }
            if let s = try? c.decode(String.self, forKey: k) { return Double(s) }
            return nil
        }
        entry = dbl(.entry); stop = dbl(.stop); target = dbl(.target); rr = dbl(.rr)
        if let i = try? c.decode(Int.self, forKey: .qty) { qty = i }
        else if let d = try? c.decode(Double.self, forKey: .qty) { qty = Int(d) }
        else if let s = try? c.decode(String.self, forKey: .qty) { qty = Int(s) }
        else { qty = nil }
    }
}

struct VerdictPick: Decodable, Identifiable {
    let symbol: String
    let sector: String?
    let qty: Int?
    let entry_window: String?
    let live_entry_estimate_paise: Int?
    let entry_estimate_paise: Int?
    let stop_paise: Int?
    let target_paise: Int?
    let stop_pct: Double?
    let target_pct: Double?
    let rr_ratio: Double?
    let hard_exit_ist: String?
    let exit_mode: String?
    let rationale: String?
    let gap_pct: Double?
    let turnover_cr: Double?
    let catalyst: Bool?
    let max_loss_paise: Int?
    let max_gain_at_target_paise: Int?
    var id: String { symbol }

    enum CodingKeys: String, CodingKey {
        case symbol, sector, qty, entry_window
        case live_entry_estimate_paise, entry_estimate_paise, entry_paise, entry
        case stop_paise, stop, target_paise, target
        case stop_pct, target_pct, rr_ratio
        case hard_exit_ist, hard_exit, time_exit, exit_mode
        case rationale, why_picked, why
        case gap_pct, turnover_cr, catalyst
        case max_loss_paise, max_gain_at_target_paise
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        func int(_ keys: CodingKeys...) -> Int? {
            for k in keys {
                if let i = try? c.decode(Int.self, forKey: k) { return i }
                if let d = try? c.decode(Double.self, forKey: k) { return Int(d) }
                if let s = try? c.decode(String.self, forKey: k), let i = Int(s) { return i }
            }
            return nil
        }
        func double(_ k: CodingKeys) -> Double? {
            if let d = try? c.decode(Double.self, forKey: k) { return d }
            if let i = try? c.decode(Int.self, forKey: k) { return Double(i) }
            if let s = try? c.decode(String.self, forKey: k) { return Double(s) }
            return nil
        }
        func rupeeAliasToPaise(_ k: CodingKeys) -> Int? {
            double(k).map { Int(round($0 * 100.0)) }
        }
        func str(_ keys: CodingKeys...) -> String? {
            for k in keys {
                if let s = try? c.decode(String.self, forKey: k), !s.isEmpty { return s }
            }
            return nil
        }

        symbol = (try? c.decode(String.self, forKey: .symbol)) ?? ""
        sector = str(.sector)
        qty = int(.qty)
        entry_window = str(.entry_window)
        live_entry_estimate_paise = int(.live_entry_estimate_paise)
        entry_estimate_paise = int(.entry_estimate_paise, .entry_paise) ?? rupeeAliasToPaise(.entry)
        stop_paise = int(.stop_paise) ?? rupeeAliasToPaise(.stop)
        target_paise = int(.target_paise) ?? rupeeAliasToPaise(.target)
        stop_pct = double(.stop_pct)
        target_pct = double(.target_pct)
        rr_ratio = double(.rr_ratio)
        hard_exit_ist = str(.hard_exit_ist, .time_exit, .hard_exit)
        exit_mode = str(.exit_mode)
        rationale = str(.rationale, .why_picked, .why)
        gap_pct = double(.gap_pct)
        turnover_cr = double(.turnover_cr)
        catalyst = try? c.decode(Bool.self, forKey: .catalyst)
        max_loss_paise = int(.max_loss_paise)
        max_gain_at_target_paise = int(.max_gain_at_target_paise)
    }

    var entryRupees: Double? {
        (live_entry_estimate_paise ?? entry_estimate_paise).map { Double($0) / 100.0 }
    }
    var stopRupees: Double? { stop_paise.map { Double($0) / 100.0 } }
    var targetRupees: Double? { target_paise.map { Double($0) / 100.0 } }
    var draft: WealthVM.OrderDraft {
        WealthVM.OrderDraft(
            symbol: symbol,
            stop: stopRupees.map { String(format: "%.2f", $0) } ?? "",
            target: targetRupees.map { String(format: "%.2f", $0) } ?? "",
            qty: qty.map(String.init) ?? ""
        )
    }
}

struct MachinePlanEntry: Decodable, Identifiable {
    let step: String?
    let action: String?
    let symbol: String?
    let entry: Double?
    let stop: Double?
    let target: Double?
    let qty: Int?
    let time_exit: String?
    let why: String?
    let note: String?
    var id: String { [step, action, symbol, note].compactMap { $0 }.joined(separator: "_") }

    enum CodingKeys: String, CodingKey {
        case step, action, symbol, entry, stop, target, entry_paise, stop_paise, target_paise, qty
        case time_exit, hard_exit, why, note
    }

    init(step: String?, action: String?, symbol: String?, entry: Double?, stop: Double?, target: Double?, qty: Int?, time_exit: String?, why: String?, note: String?) {
        self.step = step
        self.action = action
        self.symbol = symbol
        self.entry = entry
        self.stop = stop
        self.target = target
        self.qty = qty
        self.time_exit = time_exit
        self.why = why
        self.note = note
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        func str(_ keys: CodingKeys...) -> String? {
            for k in keys {
                if let s = try? c.decode(String.self, forKey: k), !s.isEmpty { return s }
            }
            return nil
        }
        func double(_ keys: CodingKeys...) -> Double? {
            for k in keys {
                if let d = try? c.decode(Double.self, forKey: k) { return d }
                if let i = try? c.decode(Int.self, forKey: k) { return Double(i) }
                if let s = try? c.decode(String.self, forKey: k), let d = Double(s) { return d }
            }
            return nil
        }
        func int(_ k: CodingKeys) -> Int? {
            if let i = try? c.decode(Int.self, forKey: k) { return i }
            if let d = try? c.decode(Double.self, forKey: k) { return Int(d) }
            if let s = try? c.decode(String.self, forKey: k), let i = Int(s) { return i }
            return nil
        }
        func paiseToRupee(_ k: CodingKeys) -> Double? {
            int(k).map { Double($0) / 100.0 }
        }
        step = str(.step)
        action = str(.action)
        symbol = str(.symbol)
        entry = double(.entry) ?? paiseToRupee(.entry_paise)
        stop = double(.stop) ?? paiseToRupee(.stop_paise)
        target = double(.target) ?? paiseToRupee(.target_paise)
        qty = int(.qty)
        time_exit = str(.time_exit, .hard_exit)
        why = str(.why)
        note = str(.note)
    }
}

struct RejectedSetup: Decodable, Identifiable {
    let symbol: String?
    let why_not: String?
    let reason: String?
    let gap_pct: Double?
    let turnover_cr: Double?
    var id: String { (symbol ?? UUID().uuidString) + (why_not ?? reason ?? "") }
    enum CodingKeys: String, CodingKey { case symbol, why_not, why_rejected, why, reason, gap_pct, turnover_cr }

    init(from decoder: Decoder) throws {
        if let s = try? decoder.singleValueContainer().decode(String.self) {
            symbol = nil; why_not = s; reason = nil; gap_pct = nil; turnover_cr = nil
            return
        }
        let c = try decoder.container(keyedBy: CodingKeys.self)
        func double(_ k: CodingKeys) -> Double? {
            if let d = try? c.decode(Double.self, forKey: k) { return d }
            if let i = try? c.decode(Int.self, forKey: k) { return Double(i) }
            if let s = try? c.decode(String.self, forKey: k) { return Double(s) }
            return nil
        }
        symbol = try? c.decode(String.self, forKey: .symbol)
        why_not = (try? c.decode(String.self, forKey: .why_not)) ??
            (try? c.decode(String.self, forKey: .why_rejected)) ??
            (try? c.decode(String.self, forKey: .why))
        reason = try? c.decode(String.self, forKey: .reason)
        gap_pct = double(.gap_pct)
        turnover_cr = double(.turnover_cr)
    }
}

struct VerdictAlternatives: Decodable {
    let execution_authority: String?
    let machine_execution_plan: [MachinePlanEntry]?
    let rejected_setups: [RejectedSetup]?
    let why_rejected: [RejectedSetup]?
    let alternatives: [RejectedSetup]?
    let watch: [RejectedSetup]?
    let risk_flags: [String]?
}

struct VerdictToday: Decodable {
    let id: Int?
    let ok: Bool?
    let decision: String?
    let headline: String?
    let narrative: String?
    let recommended_symbol: String?
    let reason: String?
    let plan: VerdictPlan?
    let picks: [VerdictPick]
    let alternatives: VerdictAlternatives?
    let composed_at: Double?

    var primaryPick: VerdictPick? { picks.first }
    var executionAuthority: String? { alternatives?.execution_authority }
    var brokerFacingAuthorized: Bool {
        decision?.uppercased() == "TRADE" &&
        !picks.isEmpty &&
        executionAuthority == "broker_facing_picks_authorized"
    }
    var machinePlan: [MachinePlanEntry] {
        if let plan = alternatives?.machine_execution_plan, !plan.isEmpty { return plan }
        return picks.map {
            MachinePlanEntry(step: "broker_pick", action: "stage", symbol: $0.symbol,
                             entry: $0.entryRupees, stop: $0.stopRupees, target: $0.targetRupees,
                             qty: $0.qty, time_exit: $0.hard_exit_ist, why: $0.rationale, note: $0.exit_mode)
        }
    }
    var rejected: [RejectedSetup] {
        alternatives?.rejected_setups ?? alternatives?.why_rejected ?? alternatives?.alternatives ?? alternatives?.watch ?? []
    }

    enum CodingKeys: String, CodingKey {
        case ok, reason, id, decision, headline, narrative, recommended_symbol, recommended_plan_json
        case picks, picks_json, alternatives, alternatives_json, composed_at, verdict
    }
    enum VerdictKeys: String, CodingKey {
        case id, decision, headline, narrative, recommended_symbol, recommended_plan, picks, alternatives, composed_at
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        ok = try? c.decode(Bool.self, forKey: .ok)
        reason = try? c.decode(String.self, forKey: .reason)

        if let v = try? c.nestedContainer(keyedBy: VerdictKeys.self, forKey: .verdict) {
            id = try? v.decode(Int.self, forKey: .id)
            decision = try? v.decode(String.self, forKey: .decision)
            headline = try? v.decode(String.self, forKey: .headline)
            narrative = try? v.decode(String.self, forKey: .narrative)
            recommended_symbol = try? v.decode(String.self, forKey: .recommended_symbol)
            plan = try? v.decode(VerdictPlan.self, forKey: .recommended_plan)
            picks = (try? v.decode([VerdictPick].self, forKey: .picks)) ?? []
            alternatives = try? v.decode(VerdictAlternatives.self, forKey: .alternatives)
            composed_at = try? v.decode(Double.self, forKey: .composed_at)
        } else {
            if let i = try? c.decode(Int.self, forKey: .id) { id = i }
            else if let s = try? c.decode(String.self, forKey: .id), let i = Int(s) { id = i }
            else { id = nil }
            decision = try? c.decode(String.self, forKey: .decision)
            headline = try? c.decode(String.self, forKey: .headline)
            narrative = try? c.decode(String.self, forKey: .narrative)
            recommended_symbol = try? c.decode(String.self, forKey: .recommended_symbol)
            if let obj = try? c.decode(VerdictPlan.self, forKey: .recommended_plan_json) {
                plan = obj
            } else if let s = try? c.decode(String.self, forKey: .recommended_plan_json),
                      let d = s.data(using: .utf8),
                      let p = try? JSONDecoder().decode(VerdictPlan.self, from: d) {
                plan = p
            } else {
                plan = nil
            }
            if let arr = try? c.decode([VerdictPick].self, forKey: .picks) {
                picks = arr
            } else if let s = try? c.decode(String.self, forKey: .picks_json),
                      let d = s.data(using: .utf8),
                      let arr = try? JSONDecoder().decode([VerdictPick].self, from: d) {
                picks = arr
            } else {
                picks = []
            }
            if let obj = try? c.decode(VerdictAlternatives.self, forKey: .alternatives) {
                alternatives = obj
            } else if let s = try? c.decode(String.self, forKey: .alternatives_json),
                      let d = s.data(using: .utf8),
                      let obj = try? JSONDecoder().decode(VerdictAlternatives.self, from: d) {
                alternatives = obj
            } else {
                alternatives = nil
            }
            if let d = try? c.decode(Double.self, forKey: .composed_at) { composed_at = d }
            else if let i = try? c.decode(Int.self, forKey: .composed_at) { composed_at = Double(i) }
            else if let s = try? c.decode(String.self, forKey: .composed_at), let d = Double(s) { composed_at = d }
            else { composed_at = nil }
        }
    }
}

struct ExecutionGateReason: Decodable, Identifiable {
    let code: String
    let message: String
    var id: String { code + message }
}
struct RequiredSourceCandidate: Decodable, Identifiable {
    let source_name: String
    let status: String?
    let age_minutes: Int?
    let threshold_minutes: Int?
    let is_circuit_broken: Bool?
    let last_error: String?
    var id: String { source_name }
}
struct RequiredSourceGate: Decodable, Identifiable {
    let key: String
    let label: String
    let ok: Bool?
    let status: String?
    let message: String?
    let candidates: [RequiredSourceCandidate]?
    var id: String { key }
}
struct ExecutionGate: Decodable {
    let trade_authorized: Bool?
    let trade_date: String?
    let verdict_id: Int?
    let decision: String?
    let headline: String?
    let recommended_symbol: String?
    let picks_count: Int?
    let execution_authority: String?
    let reasons: [ExecutionGateReason]?
    let required_sources: [RequiredSourceGate]?
    let stable_ip_proxy_configured: Bool?
    let matched_pick: VerdictPick?
    let machine_execution_plan: [MachinePlanEntry]?
    let why_rejected: [RejectedSetup]?
}
struct ExecutionGateResp: Decodable { let execution_gate: ExecutionGate? }

struct ConfigResp: Decodable { let config: [String: String]? }

// ── Guided daily flow (todays_plan) ──
struct PlanStep: Decodable, Identifiable {
    let step: String
    let what: String?
    let why: String?
    let action: String?
    var id: String { step }
}
struct PlanState: Decodable {
    let phase: String?
    let time: String?
    let is_market_day: Bool?
    let kite_connected: Bool?
    let kite_expires_in_min: Int?
    let signal_max_today: Double?
    let unread_alerts: Int?
    let paper_open_count: Int?
    let watchlist_count: Int?
    let fii_yesterday_cr: Double?
    let dii_yesterday_cr: Double?
    let card_threshold: Double?
}
struct TodaysPlan: Decodable {
    let phase: String?
    let time: String?
    let current_step: PlanStep?
    let next_steps: [PlanStep]?
    let total_steps_in_phase: Int?
    let state: PlanState?
}

// ── System health / data integrity ──
struct AuditSource: Decodable, Identifiable {
    let name: String
    let severity: String?
    let used_by: String?
    let last_update_ms: Double?
    let age_minutes: Double?
    var id: String { name }
    var hasData: Bool { last_update_ms != nil }
}
struct AuditSummary: Decodable {
    let total_sources: Int?
    let fresh: Int?
    let stale: Int?
    let critical_stale: Int?
    let health_score_pct: Int?
}
struct IntelAudit: Decodable {
    let summary: AuditSummary?
    let sources: [AuditSource]?
    let in_market_hours: Bool?
}
struct CronHealth: Decodable {
    let total_workers: Int?
    let cron_fires_24h: Int?
    let success_24h: Int?
    let failed_24h: Int?
}
struct SystemHealth: Decodable {
    let cron_health: CronHealth?
    let alerts_unread: Int?
}

struct Briefing: Decodable {
    let date: String?
    let llm_narrative: String?
    let supporting_facts: [String]?
}

struct WatchlistStock: Decodable, Identifiable {
    let symbol: String
    let name: String?
    let last_close_rupees: Double?
    let prev_close_rupees: Double?
    let change_pct: Double?
    let live_ltp_rupees: Double?
    let live_change_pct: Double?
    let daily_value_cr: Double?
    let volume: Double?
    let thesis: String?
    var id: String { symbol }
}
struct StockPicker: Decodable {
    let watchlist: [WatchlistStock]?
    let top_movers: [WatchlistStock]?
    let all_liquid: [WatchlistStock]?
    let total: Int?
    let live_ltp_count: Int?
}

// ── The FULL analysed universe (~1,248 liquid stocks) + named buckets, every row priced.
//    Backs the Stocks tab bucket-grid front door (all stocks visible). ──
struct AnalysedStock: Decodable, Identifiable {
    let symbol: String
    let name: String?
    let turnover_cr: Double?
    let last_close_rupees: Double?
    let prev_close_rupees: Double?
    let change_pct: Double?
    let gap_pct: Double?
    let gap_candidate: Bool?
    let atr_pct: Double?
    let vol_band: String?
    let delivery_pct: Double?
    let vol_mult: Double?
    let big_money: Bool?
    let is_fno: Bool?
    let is_nifty50: Bool?
    var id: String { symbol }
    // → a price record the existing detail sheet understands
    var asWatchlist: WatchlistStock {
        WatchlistStock(symbol: symbol, name: name, last_close_rupees: last_close_rupees,
                       prev_close_rupees: prev_close_rupees, change_pct: change_pct,
                       live_ltp_rupees: nil, live_change_pct: nil,
                       daily_value_cr: turnover_cr, volume: nil, thesis: nil)
    }
}
struct AnalysedUniverse: Decodable {
    let count: Int?
    let gap_candidates: Int?
    let buckets: [String: Int]?
    let stocks: [AnalysedStock]?
}

// ── Daily OHLC series for the price graph (Swift Charts off action=eod, prices in paise). ──
struct EodBar: Decodable, Identifiable {
    let trade_date: String
    let open_paise: Int?
    let high_paise: Int?
    let low_paise: Int?
    let close_paise: Int?
    var id: String { trade_date }
    var close: Double? { close_paise.map { Double($0) / 100 } }
    var open: Double? { open_paise.map { Double($0) / 100 } }
    var high: Double? { high_paise.map { Double($0) / 100 } }
    var low: Double? { low_paise.map { Double($0) / 100 } }
}
struct EodSeries: Decodable { let symbol: String?; let rows: [EodBar]? }

// ── Per-stock engine scores (the 5-lights source). Doubles — most thin dimensions
//    default to EXACTLY 50, which the UI treats as "no data" (grey), never a fake amber. ──
struct SignalScore: Decodable, Identifiable {
    let symbol: String
    let trend_score: Double?
    let flow_score: Double?
    let catalyst_score: Double?
    let breadth_score: Double?
    let macro_score: Double?
    let sentiment_score: Double?
    let quality_score: Double?
    let options_score: Double?
    let retail_buzz_score: Double?
    let composite_score: Double?
    let mtf_alignment: String?
    let regime: String?
    var id: String { symbol }
}
struct SignalsResp: Decodable { let signals: [SignalScore]?; let note: String? }

struct BracketResult: Decodable {
    let ok: Bool?
    let blocked: Bool?
    let dry_run: Bool?
    let mode: String?
    let reason: String?
    let error: String?
    let message: String?
    let fill_price: Double?
    let gtt_id: Int?
    let fallback_used: Bool?
    let warning: String?
    let bracket_id: Int?
    let execution_gate: ExecutionGate?
}

struct ChainHealthCheck: Decodable, Identifiable {
    let name: String
    let status: String?
    let detail: String?
    let action: String?
    var id: String { name }
}
struct ChainHealth: Decodable {
    let ok: Bool?
    let overall: String?
    let checks: [ChainHealthCheck]?
    let checked_at: Double?
}

struct ResearchRandomNull: Decodable {
    let real_exp: Double?
    let null_exp: Double?
    let edge_vs_null: Double?
    let z_vs_null: Double?
}
struct ResearchLastRun: Decodable {
    let finished_at: Double?
    let notes: String?
}
struct ResearchDepth: Decodable {
    let headline: String?
    let method: String?
    let universe_syms: Int?
    let candidate_trades: Int?
    let bars_total: Int?
    let date_range: [String]?
    let cost_assumption_pct: Double?
    let verdict: String?
    let oos_expectancy_pct: Double?
    let oos_trades: Int?
    let oos_p: Double?
    let folds_positive: String?
    let random_null: ResearchRandomNull?
    let last_run: ResearchLastRun?
    let config_published_at: Double?
}

// ── Scout (the daily learning action) ──
struct ScoutLadderModel: Decodable {
    let rungs: [String]?
    let proof_rung: String?
    let action_rung: String?
    let token_available: Bool?
    let to_deployable: String?
}
struct ScoutPlanModel: Decodable {
    let entry_rs: Double?; let stop_rs: Double?; let target_rs: Double?
    let qty: Int?; let rr_ratio: Double?
    let expected_risk_rs: Double?; let expected_reward_rs: Double?; let notional_rs: Double?
}
struct ScoutReject: Decodable, Identifiable {
    var id: String { symbol }
    let symbol: String; let gap_pct: Double?; let turnover_cr: Double?; let reason: String?
}
struct ScoutWhyNot: Decodable {
    let scanned: Int?; let gapped_up: Int?; let liquid_scored: Int?; let picked: Int?
    let sample_rejected: [ScoutReject]?
}
struct ScoutOutcome: Decodable {
    let action_taken: String?; let exit_reason: String?
    let pnl_net_rs: Double?; let win_loss: String?; let r_multiple: Double?
    let caught_grade: String?; let oracle_top_symbol: String?; let oracle_top_pct: Double?
    let lesson: String?; let pattern: String?
}
struct ScoutToday: Decodable {
    let has_scout: Bool?; let date: String?
    let mode: String?; let decision: String?; let state: String?; let owner_action: String?
    let edge_state: String?
    let ladder: ScoutLadderModel?
    let headline: String?; let honest_expectation: String?
    let primary_symbol: String?; let candidates: [String]?
    let why_this: String?; let why_not: ScoutWhyNot?
    let plan: ScoutPlanModel?
    let invalidation: String?; let source: String?
    let config_oos_exp_pct: Double?
    let outcome: ScoutOutcome?; let note: String?
}
struct ScoutTrailStats: Decodable {
    let scout_days: Int?; let sit_out_days: Int?; let active_rate: Int?
    let observed_days: Int?; let wins: Int?; let losses: Int?; let hit_rate_pct: Int?
    let cum_paper_net_rs: Double?; let worst_day_net_rs: Double?; let avg_r_multiple: Double?
    let honest_note: String?
}
struct ScoutTrailDay: Decodable, Identifiable {
    var id: String { (date ?? "") + "_" + (symbol ?? "—") }
    let date: String?; let mode: String?; let decision: String?; let state: String?
    let symbol: String?; let edge_state: String?
    let win_loss: String?; let pnl_net_rs: Double?
    let caught_grade: String?; let exit_reason: String?
    let lesson: String?; let pattern: String?
    let oracle_top_symbol: String?; let oracle_top_pct: Double?
}
struct ScoutTrail: Decodable {
    let window_days: Int?; let stats: ScoutTrailStats?; let days: [ScoutTrailDay]?
}

actor WealthClient {
    static let shared = WealthClient()
    private let base = "https://trade.hnhotels.in"
    private let key = Secrets.dashboardKey

    /// Shared request helper. Auth via x-api-key header. Never blocks the main thread.
    @discardableResult
    func request(path: String,
                 query: [String: String] = [:],
                 method: String = "GET",
                 rawBody: Data? = nil,
                 expectsJSON: Bool = true) async throws -> Data {
        guard var comps = URLComponents(string: base + path) else { throw WealthError.badURL }
        var items = comps.queryItems ?? []
        for (k, v) in query { items.append(URLQueryItem(name: k, value: v)) }
        if !items.isEmpty { comps.queryItems = items }
        guard let url = comps.url else { throw WealthError.badURL }

        var req = URLRequest(url: url, timeoutInterval: 18)
        req.httpMethod = method
        req.setValue(key, forHTTPHeaderField: "x-api-key")
        if let rawBody {
            req.httpBody = rawBody
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }

        let (data, resp) = try await URLSession.shared.data(for: req)
        guard let http = resp as? HTTPURLResponse else { throw WealthError.empty }
        if http.statusCode == 401 || http.statusCode == 403 { throw WealthError.unauthorized }
        guard (200..<300).contains(http.statusCode) else {
            throw WealthError.server(serverErrorMessage(from: data, statusCode: http.statusCode))
        }
        if expectsJSON && data.isEmpty { throw WealthError.empty }
        return data
    }

    private func serverErrorMessage(from data: Data, statusCode: Int) -> String {
        if let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            if let message = obj["message"] as? String, !message.isEmpty { return message }
            if let error = obj["error"] as? String, !error.isEmpty {
                if error == "market_closed_preflight" {
                    return "NSE regular market is closed. Orders can be placed only Mon-Fri, 09:15-15:30 IST."
                }
                return error
            }
            if let reason = obj["reason"] as? String, !reason.isEmpty { return reason }
        }
        let body = String(data: data, encoding: .utf8) ?? ""
        return body.isEmpty ? "HTTP \(statusCode)" : body
    }

    private func get<T: Decodable>(_ type: T.Type, action: String, api: String = "/api/trading",
                                   extra: [String: String] = [:]) async throws -> T {
        var q = ["action": action]
        for (k, v) in extra { q[k] = v }
        let data = try await request(path: api, query: q)
        do { return try JSONDecoder().decode(T.self, from: data) }
        catch { throw WealthError.server("Decode \(action): \(error.localizedDescription)") }
    }

    // ── Reads ──
    func kiteStatus() async throws -> KiteStatus { try await get(KiteStatus.self, action: "status", api: "/api/kite") }
    func readiness() async throws -> Readiness { try await get(Readiness.self, action: "readiness") }
    func autoTrader() async throws -> AutoTraderState { try await get(AutoTraderState.self, action: "auto_trader_state") }
    func engineState() async throws -> EngineState { try await get(EngineState.self, action: "engine_state") }
    func verdictToday() async throws -> VerdictToday { try await get(VerdictToday.self, action: "verdict_today") }
    func executionGate(symbol: String? = nil) async throws -> ExecutionGate {
        var q = ["action": "execution_gate"]
        if let symbol, !symbol.isEmpty { q["symbol"] = symbol }
        let data = try await request(path: "/api/kite", query: q)
        return (try JSONDecoder().decode(ExecutionGateResp.self, from: data)).execution_gate ?? ExecutionGate(
            trade_authorized: false, trade_date: nil, verdict_id: nil, decision: nil, headline: nil,
            recommended_symbol: nil, picks_count: nil, execution_authority: nil,
            reasons: [ExecutionGateReason(code: "gate_missing", message: "Server returned no execution gate.")],
            required_sources: nil, stable_ip_proxy_configured: nil, matched_pick: nil,
            machine_execution_plan: nil, why_rejected: nil
        )
    }
    func config() async throws -> [String: String] {
        (try await get(ConfigResp.self, action: "config")).config ?? [:]
    }
    func todaysPlan() async throws -> TodaysPlan { try await get(TodaysPlan.self, action: "todays_plan") }
    func intelAudit() async throws -> IntelAudit { try await get(IntelAudit.self, action: "intelligence_audit") }
    func systemHealth() async throws -> SystemHealth { try await get(SystemHealth.self, action: "system_health") }
    func stockPicker() async throws -> StockPicker { try await get(StockPicker.self, action: "stock_picker", extra: ["ltp": "1"]) }
    func signals() async throws -> [SignalScore] { (try await get(SignalsResp.self, action: "signals")).signals ?? [] }
    func briefing() async throws -> Briefing { try await get(Briefing.self, action: "briefing_v2") }
    func chainHealth() async throws -> ChainHealth { try await get(ChainHealth.self, action: "chain_health") }
    func researchDepth() async throws -> ResearchDepth { try await get(ResearchDepth.self, action: "research_depth") }
    func scoutToday() async throws -> ScoutToday { try await get(ScoutToday.self, action: "scout_today") }
    func scoutTrail() async throws -> ScoutTrail { try await get(ScoutTrail.self, action: "scout_trail") }
    func analysedUniverse() async throws -> AnalysedUniverse { try await get(AnalysedUniverse.self, action: "analysed_universe") }
    func eod(symbol: String) async throws -> EodSeries { try await get(EodSeries.self, action: "eod", extra: ["symbol": symbol]) }

    /// Guarded config write (used for today's deployable capital). GET-with-side-effects per the API contract.
    @discardableResult
    func setConfig(key: String, value: String) async throws -> Bool {
        _ = try await request(path: "/api/trading",
                              query: ["action": "set_config", "config_key": key, "config_value": value])
        return true
    }

    /// Direct bracket order (BUY market + GTT OCO stop/target) via the server broker proxy.
    /// product is forced to MIS (intraday auto-square) — never CNC. `tag` carries an idempotency stamp.
    /// Throws .unauthorized when Kite is expired/not connected (no order fires).
    /// Returns blocked:true (simulated) when block_real_orders=1.
    func placeBracket(symbol: String, qty: Int, stop: Double, target: Double, tag: String,
                      verdictId: Int?, dryRun: Bool) async throws -> BracketResult {
        var body: [String: Any] = [
            "exchange": "NSE", "tradingsymbol": symbol, "quantity": qty,
            "stop_price": stop, "target_price": target,
            "product": "MIS", "order_type": "MARKET", "tag": tag,
            "dry_run": dryRun,
            "mode": dryRun ? "paper" : "real",
        ]
        if let verdictId { body["verdict_id"] = verdictId }
        let raw = try JSONSerialization.data(withJSONObject: body)
        let data = try await request(path: "/api/kite",
                                     query: ["action": "place_bracket"],
                                     method: "POST", rawBody: raw)
        do { return try JSONDecoder().decode(BracketResult.self, from: data) }
        catch { throw WealthError.server("Decode order result: \(error.localizedDescription)") }
    }

    /// Resolve Zerodha's real OAuth login URL (kite.zerodha.com/connect/login?api_key=…) by reading the
    /// 302 Location from /wealth/auth/login WITHOUT following it — so the app can open that URL directly
    /// and let iOS hand off to the Kite app (universal link) instead of loading our domain in a browser.
    func kiteLoginURL() async -> URL? {
        guard let url = URL(string: base + "/wealth/auth/login") else { return nil }
        let session = URLSession(configuration: .ephemeral, delegate: RedirectCatcher(), delegateQueue: nil)
        defer { session.finishTasksAndInvalidate() }
        var req = URLRequest(url: url, timeoutInterval: 12)
        req.httpMethod = "GET"
        do {
            let (_, resp) = try await session.data(for: req)
            if let http = resp as? HTTPURLResponse,
               let loc = http.value(forHTTPHeaderField: "Location"),
               let locURL = URL(string: loc) {
                return locURL
            }
        } catch { }
        return nil
    }
}

// Captures a 302 without following it (so we can read the Location header).
final class RedirectCatcher: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

// Keychain primary, UserDefaults fallback on simulator (SecItemAdd -34018) — for the local unlock PIN.
enum KeychainStore {
    private static let service = "HN-Wealth"

    static func set(_ value: String, for account: String) {
        let data = Data(value.utf8)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
        var add = query
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(add as CFDictionary, nil)
        if status == errSecMissingEntitlement || status == -34018 {
            UserDefaults.standard.set(value, forKey: "\(service).\(account)")
        } else if status == errSecSuccess {
            UserDefaults.standard.removeObject(forKey: "\(service).\(account)")
        }
    }

    static func get(_ account: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var out: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &out)
        if status == errSecSuccess, let d = out as? Data, let s = String(data: d, encoding: .utf8) {
            return s
        }
        return UserDefaults.standard.string(forKey: "\(service).\(account)")
    }

    static func clear(_ account: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
        UserDefaults.standard.removeObject(forKey: "\(service).\(account)")
    }
}
