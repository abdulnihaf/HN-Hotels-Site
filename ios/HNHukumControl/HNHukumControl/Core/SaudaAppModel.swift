import Foundation
import Combine

// Sauda chamber model. ONE shared Diwan token (minted from the seeded PIN — NO per-chamber gate).
// Read-only: loads each tab's live data on demand, honest loading/empty/error states, never a fake
// number. Mutations (place/pay/decode) are inert — the coordinator wires them behind the owner's tap.
@MainActor
final class SaudaAppModel: ObservableObject {

    enum Tab: String, CaseIterable, Identifiable {
        case buy, place, purchaseDay, pay, vendors, hyperpure, compare, settings
        var id: String { rawValue }
        var title: String {
            switch self {
            case .buy: return "Buy list"
            case .place: return "Place"
            case .purchaseDay: return "Purchase day"
            case .pay: return "To pay"
            case .vendors: return "Vendor diary"
            case .hyperpure: return "Hyperpure"
            case .compare: return "Compare"
            case .settings: return "Settings"
            }
        }
    }

    @Published var tab: Tab = .buy
    @Published var statusLine = "Loading…"
    @Published var isRefreshing = false
    @Published var locked = false

    // per-tab data
    @Published var compare: SaudaCompare?            // Buy list + Compare
    @Published var settings: SaudaSettings?          // Place + Settings master
    @Published var payQueue: SaudaOpen?              // To pay (today's open orders)
    @Published var purchaseDay: SaudaOpen?           // Purchase day (picked date)
    @Published var ledger: SaudaVendorLedger?        // Vendor diary
    @Published var hyperpure: SaudaHyperpure?        // Hyperpure feed

    @Published var purchaseDate: Date = Date()       // Purchase-day date picker (drives open&for_date)
    @Published var settingsSeg: Int = 0              // 0 = Items, 1 = Vendors

    private var token: String?
    private var loaded: Set<Tab> = []
    private var pollTask: Task<Void, Never>?
    private let cal = Calendar(identifier: .gregorian)

    static let ymd: DateFormatter = {
        let f = DateFormatter(); f.calendar = Calendar(identifier: .gregorian)
        f.timeZone = TimeZone(identifier: "Asia/Kolkata"); f.locale = Locale(identifier: "en_IN_POSIX")
        f.dateFormat = "yyyy-MM-dd"; return f
    }()
    var purchaseYMD: String { Self.ymd.string(from: purchaseDate) }

    // MARK: token — shared Diwan token, minted from the seeded PIN (cred "sauda" = 0305)
    private func ensureToken() async throws -> String {
        if let t = token { return t }
        if let cached = DiwanAuth.credential("sauda-token") { token = cached; return cached }
        guard let pin = DiwanAuth.credential("sauda") else { throw SaudaError.locked }
        let t = try await SaudaClient.shared.auth(pin: pin)
        DiwanAuth.setCredential(t, chamber: "sauda-token")
        token = t
        return t
    }
    private func remint() async throws -> String {
        token = nil
        DiwanAuth.clear("sauda-token")
        return try await ensureToken()
    }

    // MARK: lifecycle
    func bootstrap() async {
        guard DiwanAuth.credential("sauda") != nil else {
            locked = true; statusLine = "Unlock from the Diwan home"; return
        }
        // sim/test routing hook (same idea as HUKUM_SEED_PIN) — no effect in production
        let env = ProcessInfo.processInfo.environment
        if let t = env["HUKUM_SAUDA_TAB"], let tt = Tab(rawValue: t) { tab = tt }
        if let d = env["HUKUM_SAUDA_DATE"], let dd = Self.ymd.date(from: d) { purchaseDate = dd }
        await load(tab, force: true)
        startPolling()
    }

    func refresh() async { await load(tab, force: true) }

    func switchTo(_ t: Tab) {
        tab = t
        if !loaded.contains(t) { Task { await load(t, force: false) } }
        else { updateStatus() }
    }

    // MARK: per-tab loaders (with one auto-remint on 401)
    func load(_ t: Tab, force: Bool) async {
        if !force && loaded.contains(t) { return }
        isRefreshing = true
        defer { isRefreshing = false }
        do {
            try await fetch(t, token: try await ensureToken())
            loaded.insert(t)
            locked = false
            updateStatus()
        } catch SaudaError.unauthorized {
            do { try await fetch(t, token: try await remint()); loaded.insert(t); updateStatus() }
            catch { statusLine = "Sauda: \(error.localizedDescription)" }
        } catch SaudaError.locked {
            locked = true; statusLine = "Unlock from the Diwan home"
        } catch {
            statusLine = "Sauda unreachable: \(error.localizedDescription)"
        }
    }

    private func fetch(_ t: Tab, token: String) async throws {
        switch t {
        case .buy, .compare:
            compare = try await SaudaClient.shared.compare(token: token)
        case .place, .settings:
            settings = try await SaudaClient.shared.settings(token: token)
        case .pay:
            payQueue = try await SaudaClient.shared.open(forDate: nil, token: token)
        case .purchaseDay:
            purchaseDay = try await SaudaClient.shared.open(forDate: purchaseYMD, token: token)
        case .vendors:
            ledger = try await SaudaClient.shared.vendorLedger(token: token)
        case .hyperpure:
            hyperpure = try await SaudaClient.shared.hyperpure(token: token)
        }
    }

    func reloadPurchaseDay() { loaded.remove(.purchaseDay); Task { await load(.purchaseDay, force: true) } }

    // MARK: honest status line per active tab
    private func updateStatus() {
        switch tab {
        case .buy:
            let n = compare?.items?.count ?? 0
            statusLine = n == 0 ? "No items yet" : "\(n) items · need-first buy list"
        case .compare:
            let n = compare?.items?.count ?? 0
            let cheaper = compare?.items?.filter { $0.beats_baseline == true }.count ?? 0
            statusLine = n == 0 ? "No comparison yet" : "\(n) items · \(cheaper) cheaper online"
        case .place:
            let v = settings?.vendors?.count ?? 0
            statusLine = v == 0 ? "No vendors yet" : "\(v) vendors · blank every morning"
        case .settings:
            let c = settings?.counts
            statusLine = "\(c?.items ?? 0) items · \(c?.vendors ?? 0) vendors"
        case .pay:
            let o = payQueue?.orders ?? []
            let total = o.reduce(0) { $0 + ($1.pay_amount_paise ?? 0) }
            statusLine = o.isEmpty ? "Nothing waiting for payment" : "\(o.count) payable · \(NaamFmt.rupee(Double(total)/100))"
        case .purchaseDay:
            let o = purchaseDay?.orders ?? []
            let total = o.reduce(0) { $0 + ($1.pay_amount_paise ?? 0) }
            statusLine = o.isEmpty ? "No orders for this day" : "\(o.count) vendor purchases · \(NaamFmt.rupee(Double(total)/100))"
        case .vendors:
            let v = ledger?.vendors ?? []
            let due = v.reduce(0) { $0 + ($1.outstanding_paise ?? 0) }
            statusLine = v.isEmpty ? "No vendor diary yet" : "\(v.count) vendors · \(NaamFmt.rupee(Double(due)/100)) due"
        case .hyperpure:
            let n = hyperpure?.items?.count ?? 0
            if hyperpure?.stale == true { statusLine = "\(n) items · prices may be old" }
            else { statusLine = n == 0 ? "No mandi prices yet" : "\(n) mandi items · tomorrow's basket" }
        }
    }

    private func startPolling() {
        pollTask?.cancel()
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 60_000_000_000)
                await self?.refresh()
            }
        }
    }
    deinit { pollTask?.cancel() }
}
