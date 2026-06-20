import Foundation
import Combine

// Hisaab view-model. ONE-UNLOCK: it reads the seeded credential from the Diwan vault and
// NEVER shows its own PIN gate (DiwanSession does the single unlock). On 401 it surfaces a
// calm "Source unreachable / re-unlock" ONCE and stops — never loops, never fakes a number.
@MainActor
final class HisaabAppModel: ObservableObject {
    @Published var summary: HisaabSummary?
    @Published var brand: HisaabBrand = .he { didSet { if oldValue != brand { Task { await refresh() } } } }
    @Published var statusLine = "Loading…"
    @Published var reachable = true
    @Published var isRefreshing = false

    // Selected business date (yyyy-MM-dd, IST). nil → backend defaults to today IST.
    @Published var date: String? { didSet { Task { await refresh() } } }

    private var pollTask: Task<Void, Never>?

    // Per the Diwan one-unlock: read the seeded owner PIN. The shared DiwanSession seeds the
    // key "hisab"; the brief names "hisaab" — accept either so we resolve under either seeding.
    private var pin: String? { DiwanAuth.credential("hisaab") ?? DiwanAuth.credential("hisab") }

    func bootstrap() async {
        await refresh()
        startPolling()
    }

    func refresh() async {
        guard let pin else {
            summary = nil
            reachable = false
            statusLine = "Locked — unlock the Diwan"
            return
        }
        isRefreshing = true
        defer { isRefreshing = false }
        do {
            let s = try await HisaabClient.shared.summary(brand: brand, date: date, pin: pin)
            summary = s
            reachable = true
            statusLine = Self.line(for: s)
        } catch let e as HukumError {
            reachable = false
            if case .server(let msg) = e, msg == "unauthorized" {
                // Stale/invalid credential — surface once, do NOT loop or retry.
                statusLine = "Source unreachable / re-unlock"
            } else {
                statusLine = "Source unreachable"
            }
        } catch {
            reachable = false
            statusLine = "Source unreachable"
        }
    }

    private func startPolling() {
        pollTask?.cancel()
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 45_000_000_000)   // 45s live poll
                if Task.isCancelled { break }
                guard let self else { break }                        // model gone → stop the loop
                await self.refresh()
            }
        }
    }

    // Header status line, e.g. "Hamza Express · 2026-06-20 · 2 gates blocked".
    static func line(for s: HisaabSummary) -> String {
        let label = s.brandLabel ?? s.brand ?? ""
        let date = s.businessDate ?? ""
        let st = (s.status ?? "blocked").lowercased()
        let tail: String
        switch st {
        case "final": tail = "final · frozen"
        case "draft": tail = s.finalSourceChanged == true ? "source changed" : "ready to finalize"
        default:
            let n = s.missingGates?.count ?? 0
            tail = "\(n) gate\(n == 1 ? "" : "s") blocked"
        }
        return [label, date, tail].filter { !$0.isEmpty }.joined(separator: " · ")
    }

    // The honest hero line when the day cannot be reckoned.
    var heroBlockedNote: String {
        let n = summary?.missingGates?.count ?? 0
        return n > 0 ? "Day blocked — \(n) gate\(n == 1 ? "" : "s") pending" : "Day blocked"
    }

    var isBlocked: Bool { (summary?.status ?? "blocked").lowercased() == "blocked" }

    // ── Cross-ref accessors the coordinator wires (it reads these off the model) ──
    // #2 Hisaab COGS → Anbar consumption: the rm_settlements identity behind raw_cogs.
    var cogsConsumptionRef: (id: Int, date: String?)? {
        guard let id = summary?.inputs?.anbar?.id else { return nil }
        return (id, summary?.inputs?.anbar?.settlementDate)
    }
    // #6 staff_pin identity root: the labor roster carries each person's staff_pin.
    var laborRoster: [HisaabStaff] { summary?.inputs?.labor?.staff ?? [] }
}
