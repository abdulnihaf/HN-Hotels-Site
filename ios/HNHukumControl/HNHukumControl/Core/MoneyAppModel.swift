import Foundation
import Combine

// Tijori chamber state. Loads the three live surfaces (bank ledger · money cockpit · cash trail)
// concurrently, fail-soft per source, and exposes an honest status line. READ-ONLY — no mutation,
// no money-move, no reconcile POST (owner-approve; the coordinator wires those behind a tap later).
@MainActor
final class MoneyAppModel: ObservableObject {
    // bank
    @Published var summary: BankSummary?
    @Published var ledger: [BankRow] = []
    @Published var daily: [BankDailyRow] = []
    @Published var payees: [BankPayee] = []
    @Published var attention: BankAttention?
    // money cockpit + position
    @Published var cockpit: MoneyCockpit?
    @Published var position: CashPosition?
    // cash trail
    @Published var trail: CashTrailResponse?
    @Published var sync: [CashSyncRow] = []

    @Published var loaded = false
    @Published var loading = false
    @Published var statusLine = "Loading…"

    private var started = false
    private var pollTask: Task<Void, Never>?

    func bootstrap() async {
        if started { return }
        started = true
        await refresh()
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 45_000_000_000)
                if Task.isCancelled { return }
                await self?.refresh()
            }
        }
    }

    func refresh() async {
        loading = true
        async let s   = try? MoneyClient.shared.bankSummary()
        async let l   = try? MoneyClient.shared.bankList()
        async let d   = try? MoneyClient.shared.bankDaily()
        async let p   = try? MoneyClient.shared.bankPayees()
        async let a   = try? MoneyClient.shared.bankAttention()
        async let ck  = try? MoneyClient.shared.moneyCockpit()
        async let cp  = try? MoneyClient.shared.cashPosition()
        async let tr  = try? MoneyClient.shared.cashTrail()
        async let sy  = try? MoneyClient.shared.cashSyncStatus()

        let (sv, lv, dv, pv, av, ckv, cpv, trv, syv) = await (s, l, d, p, a, ck, cp, tr, sy)
        summary   = sv ?? summary
        ledger    = lv?.rows ?? ledger
        daily     = dv?.rows ?? daily
        payees    = pv?.rows ?? payees
        attention = av ?? attention
        cockpit   = ckv ?? cockpit
        position  = cpv ?? position
        trail     = trv ?? trail
        sync      = syv?.sources ?? sync

        loaded = true
        loading = false
        statusLine = computeStatus(anyArrived: sv != nil || cpv != nil || trv != nil)
    }

    // Glance-first, honest. Bank balance + cash on hand + the freshest feed age, or a truthful failure.
    private func computeStatus(anyArrived: Bool) -> String {
        if !anyArrived && summary == nil && position == nil && trail == nil {
            return "Source unreachable"
        }
        var parts: [String] = []
        let bank = position?.bank?.total ?? summary?.balances?.reduce(0) { $0 + $1.rupees }
        if let b = bank { parts.append("\(MoneyView.short(b)) bank") }
        let cash = trail?.totalR ?? position?.cash?.total
        if let c = cash { parts.append("\(MoneyView.short(c)) cash") }
        if let age = freshestAgeMinutes() { parts.append(age) }
        return parts.isEmpty ? "Live" : parts.joined(separator: " · ")
    }

    private func freshestAgeMinutes() -> String? {
        guard let m = summary?.sourceHealth?.compactMap({ $0.ageMinutes }).min() else { return nil }
        if m < 60 { return "feed \(Int(m))m ago" }
        if m < 1440 { return "feed \(Int(m / 60))h ago" }
        return "feed \(Int(m / 1440))d ago"
    }

    deinit { pollTask?.cancel() }
}
