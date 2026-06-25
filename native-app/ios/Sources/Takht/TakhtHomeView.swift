import SwiftUI

struct TakhtHomeView: View {
    @EnvironmentObject var store: TakhtStore

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header
                boardCard
                proofCards
                sourceCards
            }
            .padding()
        }
        .background(Color(.systemGroupedBackground))
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Takht")
                .font(.largeTitle.bold())
            Text("Settlement truth, read only.")
                .foregroundStyle(.secondary)
        }
    }

    private var boardCard: some View {
        let shift = store.currentShift
        return VStack(alignment: .leading, spacing: 12) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Current settlement")
                        .font(.headline)
                    Text(shift?.settlementDate ?? "No settlement date")
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Text(store.freshnessLabel)
                    .font(.caption.bold())
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(.thinMaterial)
                    .clipShape(Capsule())
            }
            metricRow("Expected cash", shift?.cashExpected)
            metricRow("Counted cash", shift?.cashCounted)
            metricRow("Variance", shift?.cashVariance)
            metricRow("UPI", shift?.upiTotal)
            metricRow("Card", shift?.cardTotal)
            if let blocked = store.overview?.blockedSource {
                honestyPill(title: "Blocked source", value: blocked, color: .red)
            }
            if let message = store.overview?.validator?.message {
                Text(message)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .padding()
        .background(.background)
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
    }

    private var proofCards: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Proof cards")
                .font(.headline)
            ForEach(store.currentShift?.flags ?? []) { flag in
                VStack(alignment: .leading, spacing: 4) {
                    Text(flag.title ?? "Flag")
                        .font(.subheadline.bold())
                    Text(flag.detail ?? "")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                .padding()
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(flag.level == "red" ? Color.red.opacity(0.10) : Color.orange.opacity(0.10))
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            }
        }
    }

    private var sourceCards: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Source proof")
                .font(.headline)
            ForEach(store.overview?.sourceProof ?? []) { card in
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(card.title ?? "Source")
                            .font(.subheadline.bold())
                        Spacer()
                        Text(card.status ?? "unknown")
                            .font(.caption.bold())
                            .foregroundStyle(.secondary)
                    }
                    Text(card.detail ?? "")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                .padding()
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(.background)
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            }
            if let err = store.errorMessage {
                Text(err)
                    .font(.footnote)
                    .foregroundStyle(.red)
            }
        }
    }

    private func metricRow(_ title: String, _ value: Double?) -> some View {
        HStack {
            Text(title)
                .foregroundStyle(.secondary)
            Spacer()
            Text(value.map { Self.currency($0) } ?? "—")
                .fontWeight(.semibold)
        }
    }

    private func honestyPill(title: String, value: String, color: Color) -> some View {
        HStack {
            Text(title)
            Spacer()
            Text(value)
        }
        .font(.footnote)
        .padding(10)
        .background(color.opacity(0.12))
        .foregroundStyle(color)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private static func currency(_ value: Double) -> String {
        "₹\(Int(value.rounded()))"
    }
}

