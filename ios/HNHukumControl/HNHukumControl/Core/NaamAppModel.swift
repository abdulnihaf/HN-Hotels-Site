import Foundation
import Combine

@MainActor
final class NaamAppModel: ObservableObject {
    @Published var data: NaamData?
    @Published var brand = "HE"
    @Published var statusLine = "Loading marketing…"
    @Published var isRefreshing = false

    var lanes: [NaamLane] {
        (data?.lanes ?? [])
            .filter { $0.brandLane(brand) != nil }
            .sorted { ($0.priority ?? 99) < ($1.priority ?? 99) }
    }

    var staleDays: Int? {
        guard let g = data?.generatedAt, let d = ISO8601DateFormatter().date(from: g) else { return nil }
        return max(0, Int(Date().timeIntervalSince(d) / 86400))
    }

    func bootstrap() async { await refresh() }

    func refresh() async {
        isRefreshing = true
        defer { isRefreshing = false }
        do {
            data = try await NaamClient.shared.data()
            let n = lanes.count
            if let s = staleDays {
                statusLine = "\(n) lanes · snapshot \(s)d old"
            } else {
                statusLine = "\(n) lanes"
            }
        } catch {
            statusLine = "Naam offline: \(error.localizedDescription)"
        }
    }
}
