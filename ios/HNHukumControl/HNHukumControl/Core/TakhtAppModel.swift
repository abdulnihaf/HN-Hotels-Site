import Foundation
import Combine

// A plain-English flag, exactly the "What was missed — read to staff" doctrine of the owner-witness page.
struct TakhtFlag: Identifiable {
    enum Level { case red, amber, green }
    let level: Level
    let title: String
    let cause: String
    var id: String { title }
}

@MainActor
final class TakhtAppModel: ObservableObject {
    @Published var balance: TakhtBalance?
    @Published var token: TakhtTokenSettlement?
    @Published var upi: TakhtUpiResponse?
    @Published var shift: TakhtShift?
    @Published var flags: [TakhtFlag] = []
    @Published var status = "opening the court…"
    @Published var isRefreshing = false
    @Published var unlocked = DiwanAuth.isUnlocked("takht")

    private var pollTask: Task<Void, Never>?

    // ── Auth gate: the one allowed write-shaped call. Stores the PIN in the Keychain vault on success. ──
    func unlock(pin: String) async -> String? {
        do {
            let r = try await TakhtClient.shared.verifyPin(pin)
            if r.success == true {
                DiwanAuth.setCredential(pin, chamber: "takht")
                unlocked = true
                await bootstrap()
                return nil
            }
            return r.error ?? "Invalid PIN"
        } catch {
            return "Connection error"
        }
    }

    func bootstrap() async { await refresh(); startPolling() }

    func refresh() async {
        guard unlocked else { return }
        isRefreshing = true
        defer { isRefreshing = false }

        // Read all four witnesses in parallel; each one is independently optional/honest.
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

    // The rupee that should reach the owner's hand. RUPEES — never ÷100.
    var handTotal: Double { balance?.total ?? 0 }

    private func buildFlags() {
        var out: [TakhtFlag] = []

        // Cash expenses present — new regime is UPI-only.
        if let exp = balance?.totalExpenses, exp > 0 {
            out.append(.init(level: .amber,
                title: "Cash expenses present (\(TakhtFmt.rupee(exp)))",
                cause: "New regime is UPI-only — any cash out of the drawer needs a reason."))
        }

        // UPI: Razorpay vs POS gaps.
        for d in (upi?.discrepancies ?? []) {
            let cause = d.type == "excess"
                ? "Money on this QR that POS didn’t record — a sale not scanned to the runner (not a tip), or a tender mis-tag."
                : "POS shows UPI that Razorpay never received — cash marked as UPI, or paid to the wrong QR."
            out.append(.init(level: .red,
                title: "\(d.entity): UPI \(d.type) \(TakhtFmt.rupee(d.amount ?? 0))",
                cause: cause))
        }

        // Chai gap: more tokens physically left than POS recorded = chai served without a bill.
        if let disc = token?.discrepancy, disc > 20 {
            out.append(.init(level: .amber,
                title: "Chai gap: +\(disc) tokens vs POS",
                cause: "More chai physically left than POS recorded — chai served without a bill."))
        }

        // POS session never closed.
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

enum TakhtFmt {
    // RUPEES — these numbers are already whole rupees from the worker. Never ÷100.
    static func rupee(_ v: Double?) -> String {
        let n = v ?? 0
        let f = NumberFormatter(); f.numberStyle = .decimal; f.maximumFractionDigits = 0
        f.locale = Locale(identifier: "en_IN")
        return "₹" + (f.string(from: NSNumber(value: n)) ?? "0")
    }
}
