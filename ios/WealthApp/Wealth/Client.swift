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

// The 8:30 IST plan numbers. recommended_plan_json may arrive as a JSON object OR a
// stringified JSON (the repo's `_json` convention), and qty/prices may be num-or-string —
// so decode defensively. (Verdict is {ok:false} before 08:30, so this is unobservable now.)
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
struct VerdictToday: Decodable {
    let ok: Bool?
    let decision: String?
    let recommended_symbol: String?
    let reason: String?
    let plan: VerdictPlan?

    enum CodingKeys: String, CodingKey { case ok, decision, recommended_symbol, reason, recommended_plan_json }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        ok = try? c.decode(Bool.self, forKey: .ok)
        decision = try? c.decode(String.self, forKey: .decision)
        recommended_symbol = try? c.decode(String.self, forKey: .recommended_symbol)
        reason = try? c.decode(String.self, forKey: .reason)
        if let obj = try? c.decode(VerdictPlan.self, forKey: .recommended_plan_json) {
            plan = obj
        } else if let s = try? c.decode(String.self, forKey: .recommended_plan_json),
                  let d = s.data(using: .utf8),
                  let p = try? JSONDecoder().decode(VerdictPlan.self, from: d) {
            plan = p
        } else {
            plan = nil
        }
    }
}

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
    let reason: String?
    let error: String?
    let fill_price: Double?
    let gtt_id: Int?
    let fallback_used: Bool?
    let warning: String?
    let bracket_id: Int?
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
            let body = String(data: data, encoding: .utf8) ?? "HTTP \(http.statusCode)"
            throw WealthError.server(body.isEmpty ? "HTTP \(http.statusCode)" : body)
        }
        if expectsJSON && data.isEmpty { throw WealthError.empty }
        return data
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
    func config() async throws -> [String: String] {
        (try await get(ConfigResp.self, action: "config")).config ?? [:]
    }
    func todaysPlan() async throws -> TodaysPlan { try await get(TodaysPlan.self, action: "todays_plan") }
    func intelAudit() async throws -> IntelAudit { try await get(IntelAudit.self, action: "intelligence_audit") }
    func systemHealth() async throws -> SystemHealth { try await get(SystemHealth.self, action: "system_health") }
    func stockPicker() async throws -> StockPicker { try await get(StockPicker.self, action: "stock_picker", extra: ["ltp": "1"]) }
    func signals() async throws -> [SignalScore] { (try await get(SignalsResp.self, action: "signals")).signals ?? [] }
    func briefing() async throws -> Briefing { try await get(Briefing.self, action: "briefing_v2") }

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
    func placeBracket(symbol: String, qty: Int, stop: Double, target: Double, tag: String) async throws -> BracketResult {
        let body: [String: Any] = [
            "exchange": "NSE", "tradingsymbol": symbol, "quantity": qty,
            "stop_price": stop, "target_price": target,
            "product": "MIS", "order_type": "MARKET", "tag": tag,
        ]
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
