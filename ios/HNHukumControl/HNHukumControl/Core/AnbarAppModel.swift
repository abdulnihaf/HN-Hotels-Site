import Foundation
import Combine

@MainActor
final class AnbarAppModel: ObservableObject {
    @Published var items: [AnbarLiveItem] = []
    @Published var odooOk = true
    @Published var statusLine = "Loading stock…"
    @Published var isRefreshing = false
    @Published var loadError: String?
    @Published var brand: AnbarBrand = AnbarAppModel.initialBrand   // NCH is the populated board today

    // verification hook: HUKUM_ANBAR_BRAND=he picks the starting scope on the sim (mirrors SaudaTab)
    static var initialBrand: AnbarBrand {
        ProcessInfo.processInfo.environment["HUKUM_ANBAR_BRAND"]?.lowercased() == "he" ? .he : .nch
    }

    private var pollTask: Task<Void, Never>?
    private var loaded = false

    // Brand-scoped views. Shared raw materials (HN-RM-*) live on the NCH board — where the real PWA
    // shows them; HE-* would appear under HE (none in the live board yet → honest empty state).
    func items(for b: AnbarBrand) -> [AnbarLiveItem] {
        switch b {
        case .he:  return items.filter { $0.brand == .he }
        default:   return items.filter { $0.brand == .nch || $0.brand == .shared }
        }
    }
    var visibleItems: [AnbarLiveItem] { items(for: brand) }
    var recountCount: Int { items.reduce(0) { $0 + ($1.needsRecount ? 1 : 0) } }

    func bootstrap() async { await refresh(); startPolling() }

    func refresh() async {
        isRefreshing = true
        defer { isRefreshing = false }
        let token = DiwanAuth.credential("darbar")   // shared Diwan token; action=live is public, so nil is fine
        do {
            let r = try await AnbarClient.shared.live(token: token)
            items = r.items ?? []
            odooOk = r.odooOk ?? true
            loaded = true
            loadError = nil
            updateStatus()
        } catch {
            loadError = error.localizedDescription
            statusLine = "Anbar unreachable — \(error.localizedDescription)"
        }
    }

    private func updateStatus() {
        let n = items.count
        if n == 0 {
            statusLine = loaded ? "No items on the board" : "Loading stock…"
            return
        }
        var s = "\(n) item\(n == 1 ? "" : "s")"
        if recountCount > 0 { s += " · \(recountCount) need recount" }
        if !odooOk { s += " · POS feed off" }
        statusLine = s
    }

    private func startPolling() {
        pollTask?.cancel()
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 45_000_000_000)
                await self?.refresh()
            }
        }
    }
}
