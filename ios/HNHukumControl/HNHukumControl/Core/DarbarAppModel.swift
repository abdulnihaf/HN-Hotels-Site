import Foundation
import Combine

@MainActor
final class DarbarAppModel: ObservableObject {
    @Published var home: DarbarHome?
    @Published var statusLine = "Loading the day…"
    @Published var isRefreshing = false
    @Published var needsAuth = false        // flips true on 401 → view drops back to the gate
    private var pollTask: Task<Void, Never>?

    var token: String? { DiwanAuth.credential("darbar") }
    var stats: DarbarStats? { home?.stats }
    var exceptions: [DarbarException] { home?.exceptions ?? [] }
    var exceptionCount: Int { home?.exceptionCount ?? exceptions.count }

    // Group the heterogeneous inbox by type, in a fixed glance-priority order.
    var ghosts: [DarbarException]        { exceptions.filter { $0.type == "ghost" } }
    var chronicMissed: [DarbarException] { exceptions.filter { $0.type == "chronic_missed" } }
    var payMissing: [DarbarException]    { exceptions.filter { $0.type == "pay_missing" } }

    func bootstrap() async {
        guard token != nil else { needsAuth = true; return }
        await refresh()
        startPolling()
    }

    func refresh() async {
        guard let token else { needsAuth = true; return }
        isRefreshing = true
        defer { isRefreshing = false }
        do {
            let h = try await DarbarClient.shared.home(token: token)
            home = h
            statusLine = summary(h)
        } catch DarbarError.unauthorized {
            // Token expired — clear it and bounce to the gate. (Re-auth path stubbed: user re-enters PIN.)
            DiwanAuth.clear("darbar")
            stopPolling()
            needsAuth = true
            statusLine = "Session expired — re-enter PIN."
        } catch {
            statusLine = "Darbar offline: \(error.localizedDescription)"
        }
    }

    // Called by the gate once a fresh token is stored.
    func onAuthenticated() async {
        needsAuth = false
        await refresh()
        startPolling()
    }

    private func summary(_ h: DarbarHome) -> String {
        let day = h.businessDay ?? "today"
        let ex = h.exceptionCount ?? (h.exceptions?.count ?? 0)
        if ex > 0 { return "\(day) · \(ex) to look at" }
        return "\(day) · inbox clear"
    }

    private func startPolling() {
        pollTask?.cancel()
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 60_000_000_000)   // 60s — HR moves slowly
                await self?.refresh()
            }
        }
    }

    private func stopPolling() { pollTask?.cancel(); pollTask = nil }
}
