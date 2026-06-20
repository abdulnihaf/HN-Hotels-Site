import Foundation
import Combine

@MainActor
final class HisabAppModel: ObservableObject {
    @Published var summary: HisabSummary?
    @Published var brand: HisabBrand = .he { didSet { Task { await refresh() } } }
    @Published var statusLine = "Loading reckoning…"
    @Published var isRefreshing = false
    @Published var needsAuth = false          // true → show the PIN gate
    @Published var authError: String?

    // Selected business date (yyyy-MM-dd, IST). nil → backend defaults to today IST.
    @Published var date: String? { didSet { Task { await refresh() } } }

    private var pin: String? { DiwanAuth.credential("hisab") }

    var isUnlocked: Bool { pin != nil }

    func bootstrap() async {
        guard pin != nil else { needsAuth = true; statusLine = "Locked — enter Hisaab PIN"; return }
        await refresh()
    }

    // Called by the gate after a successful unlock.
    func unlock(with newPin: String) async {
        DiwanAuth.setCredential(newPin, chamber: "hisab")
        needsAuth = false
        authError = nil
        await refresh()
    }

    func refresh() async {
        guard let pin else { needsAuth = true; return }
        isRefreshing = true
        defer { isRefreshing = false }
        do {
            let s = try await HisabClient.shared.summary(brand: brand, date: date, pin: pin)
            summary = s
            statusLine = Self.statusNote(for: s)
        } catch let e as HukumError {
            if case .server(let msg) = e, msg == "unauthorized" {
                // Stale/invalid PIN — wipe it and bounce to the gate (mirrors the web behaviour).
                DiwanAuth.clear("hisab")
                summary = nil
                needsAuth = true
                authError = "PIN rejected"
                statusLine = "Locked — enter Hisaab PIN"
            } else {
                statusLine = "Hisab offline: \(e.localizedDescription)"
            }
        } catch {
            statusLine = "Hisab offline: \(error.localizedDescription)"
        }
    }

    // A plain-spoken one-line note for the header subtitle.
    static func statusNote(for s: HisabSummary) -> String {
        let who = s.user?.name ?? "—"
        let label = s.brandLabel ?? s.brand ?? ""
        let date = s.businessDate ?? ""
        return "\(who) · \(label) · \(date)"
    }

    // The hero capsule note: spoken-plain, honest when blocked.
    var heroNote: String {
        guard let s = summary else { return statusLine }
        switch (s.status ?? "").lowercased() {
        case "final":
            if let id = s.finalRun?.id { return "Final run #\(id) · frozen" }
            return "Frozen"
        case "draft":
            return s.finalSourceChanged == true ? "Source changed — review before freezing" : "Ready to finalize"
        default: // blocked
            let waiting = waitingFeeds(s)
            return waiting.isEmpty ? "Blocked" : "Can't reckon yet — waiting on \(waiting.joined(separator: ", "))"
        }
    }

    // Human names of the stale/missing gates, in display order.
    func waitingFeeds(_ s: HisabSummary) -> [String] {
        let map: [String: String] = [
            "revenue": "Sales", "anbar_settlement": "Anbar", "labor": "Labor", "major_bills": "Bills",
        ]
        return (s.missingGates ?? []).compactMap { map[$0] }
    }
}

// Money + margin display helpers — paise ÷100, null → em-dash (NEVER 0). Mirrors web Intl en-IN.
enum HisabFmt {
    private static let rupeeFmt: NumberFormatter = {
        let f = NumberFormatter()
        f.numberStyle = .decimal
        f.maximumFractionDigits = 0
        f.locale = Locale(identifier: "en_IN")
        return f
    }()

    // null paise → "—" (the honest-blocked render). Never returns ₹0 for a null.
    static func rupees(_ paise: Int?) -> String {
        guard let paise else { return "—" }
        let rupees = Double(paise) / 100.0
        return "₹" + (rupeeFmt.string(from: NSNumber(value: rupees)) ?? "0")
    }

    // basis points → "42.5%"; null → "—".
    static func marginPct(_ bp: Int?) -> String {
        guard let bp else { return "—" }
        return String(format: "%.1f%%", Double(bp) / 100.0)
    }

    static func kg(_ v: Double?) -> String {
        String(format: "%.1f kg", v ?? 0)
    }
}
