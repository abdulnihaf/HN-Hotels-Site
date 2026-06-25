import Foundation
import Combine

@MainActor
final class TakhtAppModel: ObservableObject {
    @Published var balance: TakhtBalance?
    @Published var token: TakhtTokenSettlement?
    @Published var upi: TakhtUpiResponse?
    @Published var shift: TakhtShift?
    @Published var flags: [TakhtFlag] = []
    @Published var status = "opening the court…"
    @Published var isRefreshing = false
    @Published var unlocked = TakhtAuth.isUnlocked

    private var pollTask: Task<Void, Never>?

    func unlock(pin: String) async -> String? {
        do {
            let r = try await TakhtClient.shared.verifyPin(pin)
            if r.success == true {
                TakhtAuth.set(pin)
                unlocked = true
                await bootstrap()
                return nil
            }
            return r.error ?? "Invalid PIN"
        } catch {
            return "Connection error"
        }
    }

    func lock() {
        TakhtAuth.clear()
        unlocked = false
        pollTask?.cancel()
        balance = nil; token = nil; upi = nil; shift = nil; flags = []
        status = "opening the court…"
    }

    func bootstrap() async { await refresh(); startPolling() }

    func refresh() async {
        guard unlocked else { return }
        isRefreshing = true
        defer { isRefreshing = false }

        async let bal = TakhtClient.shared.balance()
        async let tok = TakhtClient.shared.tokens()
        async let up  = TakhtClient.shared.upi()
        async let sh  = TakhtClient.shared.shift()

        balance = (try? await bal)?.balance
        token   = (try? await tok)?.lastSettlement
        upi     = try? await up
        shift   = (try? await sh)?.current

        buildFlags()

        if balance == nil {
            status = "Takht offline — counter balance unreadable"
        } else if let name = shift?.name {
            status = "Nawabi Chai House · \(name)"
        } else {
            status = "Nawabi Chai House · settlement"
        }
    }

    var handTotal: Double { balance?.total ?? 0 }

    private func buildFlags() {
        var out: [TakhtFlag] = []

        if let exp = balance?.totalExpenses, exp > 0 {
            out.append(.init(level: .amber,
                title: "Cash expenses present (\(TakhtFmt.rupee(exp)))",
                cause: "New regime is UPI-only — any cash out of the drawer needs a reason."))
        }

        for d in (upi?.discrepancies ?? []) {
            let cause = d.type == "excess"
                ? "Money on this QR that POS didn't record — a sale not scanned to the runner, or a tender mis-tag."
                : "POS shows UPI that Razorpay never received — cash marked as UPI, or paid to the wrong QR."
            out.append(.init(level: .red,
                title: "\(d.entity): UPI \(d.type) \(TakhtFmt.rupee(d.amount ?? 0))",
                cause: cause))
        }

        if let disc = token?.discrepancy, disc > 20 {
            out.append(.init(level: .amber,
                title: "Chai gap: +\(disc) tokens vs POS",
                cause: "More chai physically left than POS recorded — chai served without a bill."))
        }

        if let mins = shift?.shiftMinutes, mins / 1440 > 1 {
            let days = mins / 1440
            out.append(.init(level: .red,
                title: "POS session open \(days) days",
                cause: "Close it at this settlement so cash reconciles to a clean day."))
        }

        if out.isEmpty {
            out.append(.init(level: .green,
                title: "All clean",
                cause: "Every rupee maps to a destination. Take the cash."))
        }
        flags = out
    }

    private func startPolling() {
        pollTask?.cancel()
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 30_000_000_000)
                await self?.refresh()
            }
        }
    }
}
