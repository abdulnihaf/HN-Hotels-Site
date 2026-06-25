import Foundation
import SwiftUI
import Combine

@MainActor
final class TakhtAppModel: ObservableObject {
    // ── Identity (the spine) ──
    @Published var identity: TakhtIdentity?
    @Published var workingBrand: TakhtBrand?     // resolved brand for data (HQ picks one)

    // ── Witness data (only loaded for settlement-facing views) ──
    @Published var balance: TakhtBalance?
    @Published var token: TakhtTokenSettlement?
    @Published var upi: TakhtUpiResponse?
    @Published var shift: TakhtShift?
    @Published var flags: [TakhtFlag] = []

    @Published var status = "opening the court…"
    @Published var isRefreshing = false
    @Published var resuming = false

    private var pollTask: Task<Void, Never>?

    var unlocked: Bool { identity != nil }
    var accent: Color { (workingBrand ?? identity?.brand)?.accent ?? TakhtTheme.accent }

    // HQ manager landed but hasn't chosen a counter yet.
    var needsBrandPick: Bool {
        guard let id = identity else { return false }
        return id.brand == .hq && workingBrand == nil
    }

    // Does this person's view pull live counter data?
    private var viewNeedsCounterData: Bool {
        switch identity?.scope.role {
        case .cashier, .manager, .counter: return true
        default: return false                 // runner/captain liability isn't wired yet
        }
    }

    private var dataHost: String? { workingBrand?.dataHost }

    // ── Auth ──
    func unlock(pin: String) async -> String? {
        do {
            let r = try await TakhtClient.shared.verifyPin(pin)
            guard let me = TakhtIdentity(r) else {
                return r.error ?? "PIN not recognised"
            }
            TakhtAuth.set(pin)
            identity = me
            workingBrand = (me.brand == .hq) ? nil : me.brand
            if workingBrand != nil { await bootstrap() }
            return nil
        } catch {
            return "Connection error"
        }
    }

    // Silent re-resolve on launch when a PIN is already in the keychain.
    func resume() async {
        guard let pin = TakhtAuth.get() else { return }
        resuming = true
        defer { resuming = false }
        if let r = try? await TakhtClient.shared.verifyPin(pin),
           let me = TakhtIdentity(r) {
            identity = me
            workingBrand = (me.brand == .hq) ? nil : me.brand
            if workingBrand != nil { await bootstrap() }
        } else {
            TakhtAuth.clear()   // stale/disabled PIN — fall back to keypad
        }
    }

    func pickBrand(_ b: TakhtBrand) async {
        workingBrand = b
        await bootstrap()
    }

    func lock() {
        TakhtAuth.clear()
        pollTask?.cancel()
        identity = nil; workingBrand = nil
        balance = nil; token = nil; upi = nil; shift = nil; flags = []
        status = "opening the court…"
    }

    func bootstrap() async { await refresh(); startPolling() }

    // ── Witness refresh ──
    func refresh() async {
        guard unlocked, let host = dataHost else { return }
        guard viewNeedsCounterData else {
            // runner/captain — nothing live to pull yet; keep a clean status.
            status = "\(workingBrand?.fullName ?? "") · \(identity?.role ?? "")"
            return
        }
        isRefreshing = true
        defer { isRefreshing = false }

        async let bal = TakhtClient.shared.balance(host: host)
        async let tok = TakhtClient.shared.tokens(host: host)
        async let up  = TakhtClient.shared.upi(host: host)
        async let sh  = TakhtClient.shared.shift(host: host)

        balance = (try? await bal)?.balance
        token   = (try? await tok)?.lastSettlement
        upi     = try? await up
        shift   = (try? await sh)?.current

        buildFlags()

        let brand = workingBrand?.fullName ?? ""
        if balance == nil {
            status = "Takht offline — counter balance unreadable"
        } else if let name = shift?.name {
            status = "\(brand) · \(name)"
        } else {
            status = "\(brand) · settlement"
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
        guard viewNeedsCounterData else { return }
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 30_000_000_000)
                await self?.refresh()
            }
        }
    }
}
