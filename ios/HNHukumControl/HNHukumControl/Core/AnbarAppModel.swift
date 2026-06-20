import Foundation
import Combine

@MainActor
final class AnbarAppModel: ObservableObject {
    @Published var board: AnbarBoardResponse?
    @Published var statusLine = "Loading stock…"
    @Published var isRefreshing = false
    private var pollTask: Task<Void, Never>?

    var items: [AnbarItem] { board?.nch ?? [] }
    var chicken: [AnbarChicken] { board?.heChicken ?? [] }

    var attentionCount: Int {
        items.filter { ($0.counter?.needsAttention ?? false) || ($0.store?.needsAttention ?? false) }.count
    }

    func bootstrap() async { await refresh(); startPolling() }

    func refresh() async {
        isRefreshing = true
        defer { isRefreshing = false }
        do {
            board = try await AnbarClient.shared.board()
            let n = items.count
            statusLine = attentionCount > 0
                ? "\(n) items · \(attentionCount) need attention"
                : "\(n) items · all ok"
        } catch {
            statusLine = "Anbar offline: \(error.localizedDescription)"
        }
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
