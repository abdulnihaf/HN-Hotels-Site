import SwiftUI

struct TakhtWatchView: View {
    @EnvironmentObject var store: TakhtStore

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                Text("Takht")
                    .font(.headline)
                Text(store.currentShift?.settlementDate ?? "No shift")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                Text(store.currentShift?.cashVariance.map { Self.currency($0) } ?? "—")
                    .font(.title2.bold())
                Text("Freshness \(store.freshnessLabel)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                if let blocked = store.overview?.blockedSource {
                    Text("Blocked: \(blocked)")
                        .font(.caption2)
                        .foregroundStyle(.red)
                }
            }
            .padding()
        }
    }

    private static func currency(_ value: Double) -> String {
        "₹\(Int(value.rounded()))"
    }
}

