import SwiftUI

@MainActor
final class NazarCockpitModel: ObservableObject {
    @Published var metrics: NazarMetrics?
    @Published var flags: NazarFlags?
    @Published var status: String = "Loading…"
    @Published var isLoading = false

    private var pollTask: Task<Void, Never>?

    func start() {
        guard pollTask == nil else { return }
        pollTask = Task {
            while !Task.isCancelled {
                await load()
                try? await Task.sleep(nanoseconds: 20_000_000_000)
            }
        }
    }
    func stop() { pollTask?.cancel(); pollTask = nil }

    func load() async {
        isLoading = true
        if let m = try? await NazarClient.shared.fetchMetrics() { metrics = m }
        if let f = try? await NazarClient.shared.fetchFlags(includeHistory: true) { flags = f }
        status = metrics == nil ? "Connecting…" : "Updated"
        isLoading = false
    }
}

struct NazarIntelligenceView: View {
    @StateObject private var model = NazarCockpitModel()
    @State private var brand = "NCH"

    private var bm: NazarBrandMetrics? { model.metrics?.brands?[brand.lowercased()] }

    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                brandToggle
                if let b = bm {
                    HStack {
                        Text("updated \(model.metrics?.updated ?? "") · live")
                            .font(.system(size: 11)).foregroundColor(HK.textFaint)
                        Spacer()
                        if model.isLoading { ProgressView().tint(HK.accent).scaleEffect(0.6) }
                    }
                    if brand == "NCH" { nch(b) } else { he(b) }
                } else {
                    loadingCard
                }
            }
            .padding(16)
        }
        .background(HK.bg.ignoresSafeArea())
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .refreshable { await model.load() }
    }

    // MARK: — Brand toggle
    private var brandToggle: some View {
        HStack(spacing: 0) {
            ForEach(["NCH", "HE"], id: \.self) { b in
                Button { brand = b } label: {
                    Text(b == "NCH" ? "Nawabi Chai" : "Hamza Express")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(brand == b ? Color(hex: 0x1A0D09) : HK.textDim)
                        .frame(maxWidth: .infinity).padding(.vertical, 9)
                        .background(brand == b ? HK.accent : Color.clear)
                        .clipShape(RoundedRectangle(cornerRadius: 9))
                }
            }
        }
        .padding(3).background(RoundedRectangle(cornerRadius: 12).fill(HK.card))
    }

    // MARK: — Nawabi (seats + dwell)
    @ViewBuilder
    private func nch(_ b: NazarBrandMetrics) -> some View {
        VStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text("\(b.occupancyNow ?? 0)").font(.system(size: 40, weight: .bold, design: .rounded)).foregroundColor(HK.text)
                    Text("seated now").font(.system(size: 13)).foregroundColor(HK.textDim)
                    Spacer()
                    trustPill(b.occTrust)
                }
                sparkline(b.occupancyTrend ?? []).padding(.top, 10)
                Text("occupancy today · peak \(b.occupancyPeakToday ?? 0)")
                    .font(.system(size: 11)).foregroundColor(HK.textFaint).padding(.top, 6)
            }
            .padding(16).background(RoundedRectangle(cornerRadius: HK.radius).fill(HK.card))

            HStack(spacing: 12) {
                metricCard(icon: "clock", label: "avg seat held",
                           value: b.avgSeatDwellMin.map { "~\(Int($0.rounded())) min" } ?? "–",
                           sub: "≈ \(b.turnsPerSeat.map { String($0) } ?? "–") turns/seat", trust: b.dwellTrust)
                metricCard(icon: "cup.and.saucer", label: "chai today",
                           value: b.customersToday.map { "\($0)" } ?? "–",
                           sub: "₹\((b.salesToday ?? 0).formatted()) · orders", trust: b.posTrust)
            }
        }
    }

    // MARK: — Hamza (flow + leak)
    @ViewBuilder
    private func he(_ b: NazarBrandMetrics) -> some View {
        let leak = model.flags?.flags?.count ?? 0
        VStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text("\(leak)").font(.system(size: 40, weight: .bold, design: .rounded)).foregroundColor(leak > 0 ? HK.error : HK.text)
                    Text("tables to review").font(.system(size: 13)).foregroundColor(HK.textDim)
                    Spacer()
                    Text("review mode").font(.system(size: 10, weight: .semibold)).foregroundColor(HK.warn)
                        .padding(.horizontal, 9).padding(.vertical, 3).background(Capsule().fill(HK.warn.opacity(0.14)))
                }
                Text("a table eats past 18 min with no matching bill → shows here to eyeball")
                    .font(.system(size: 12)).foregroundColor(HK.textFaint).fixedSize(horizontal: false, vertical: true)
            }
            .padding(16).background(RoundedRectangle(cornerRadius: HK.radius).fill(HK.card))

            HStack(spacing: 12) {
                metricCard(icon: "doc.text", label: "bills today",
                           value: (b.customersToday ?? 0) > 0 ? "\(b.customersToday!)" : "–",
                           sub: (b.salesToday ?? 0) > 0 ? "₹\(b.salesToday!.formatted())" : "no data",
                           trust: (b.customersToday ?? 0) > 0 ? "trusted" : "stale")
                metricCard(icon: "person.2", label: "seated now",
                           value: "\(b.occupancyNow ?? 0)", sub: "peak \(b.occupancyPeakToday ?? 0)", trust: b.occTrust)
            }
        }
    }

    // MARK: — Reusable bits
    private func metricCard(icon: String, label: String, value: String, sub: String, trust: String?) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Label(label, systemImage: icon).font(.system(size: 12)).foregroundColor(HK.textDim).labelStyle(.titleAndIcon)
            Text(value).font(.system(size: 22, weight: .bold, design: .rounded)).foregroundColor(HK.text)
            Text(sub).font(.system(size: 12)).foregroundColor(HK.textFaint).lineLimit(1)
            trustPill(trust).padding(.top, 4)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12).background(RoundedRectangle(cornerRadius: HK.radiusSm).fill(HK.card))
    }

    private func trustPill(_ t: String?) -> some View {
        let color: Color = t == "trusted" ? HK.ok : (t == "calibrating" ? HK.warn : HK.error)
        let label = t == "trusted" ? "trusted" : (t == "calibrating" ? "calibrating" : "stale")
        return Text(label).font(.system(size: 10, weight: .semibold)).foregroundColor(color)
            .padding(.horizontal, 9).padding(.vertical, 3).background(Capsule().fill(color.opacity(0.14)))
    }

    private func sparkline(_ trend: [NazarTrendPoint]) -> some View {
        let pts = Array(trend.suffix(40))
        let mx = max(pts.compactMap { $0.v }.max() ?? 1, 1)
        return HStack(alignment: .bottom, spacing: 2) {
            ForEach(Array(pts.enumerated()), id: \.offset) { i, p in
                RoundedRectangle(cornerRadius: 1)
                    .fill(i == pts.count - 1 ? HK.accent : HK.line)
                    .frame(maxWidth: .infinity)
                    .frame(height: max(4, CGFloat(p.v ?? 0) / CGFloat(mx) * 34))
            }
        }
        .frame(height: 34)
    }

    private var loadingCard: some View {
        VStack(spacing: 14) {
            ProgressView().tint(HK.accent)
            Text(model.status).font(.system(size: 13)).foregroundColor(HK.textDim)
        }
        .frame(maxWidth: .infinity).padding(40)
        .background(RoundedRectangle(cornerRadius: HK.radius).fill(HK.card))
    }
}
