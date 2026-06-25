import SwiftUI

@MainActor
final class NazarIntelligenceModel: ObservableObject {
    @Published var flags: NazarFlags?
    @Published var status: String = "Loading…"
    @Published var isLoading = false

    private var pollTask: Task<Void, Never>?

    func startPolling() {
        guard pollTask == nil else { return }
        pollTask = Task {
            while !Task.isCancelled {
                await load()
                try? await Task.sleep(nanoseconds: 30_000_000_000)
            }
        }
    }

    func stopPolling() { pollTask?.cancel(); pollTask = nil }

    func load() async {
        isLoading = true
        do {
            flags = try await NazarClient.shared.fetchFlags(includeHistory: true)
            status = "Updated"
        } catch {
            status = error.localizedDescription
        }
        isLoading = false
    }
}

struct NazarIntelligenceView: View {
    @StateObject private var model = NazarIntelligenceModel()

    var body: some View {
        ScrollView {
            VStack(spacing: 14) {
                if let f = model.flags {
                    modeBar(f)
                    summaryRow(f)
                    whyNotCard(f)
                    channelSection(f)
                    liveCountsCard(f)
                    sourceHealthCard(f)
                } else {
                    loadingCard
                }
            }
            .padding(16)
        }
        .background(HK.bg.ignoresSafeArea())
        .onAppear { model.startPolling() }
        .onDisappear { model.stopPolling() }
        .refreshable { await model.load() }
    }

    // MARK: — Mode bar
    private func modeBar(_ f: NazarFlags) -> some View {
        let proven = f.canProveZeroMiss ?? false
        let label = f.confidenceLabel ?? (f.mode ?? "unknown")
        return HStack(spacing: 10) {
            Circle().fill(proven ? HK.ok : HK.warn).frame(width: 10, height: 10)
            Text(label.uppercased())
                .font(.system(size: 12, weight: .semibold, design: .monospaced))
                .foregroundColor(proven ? HK.ok : HK.warn)
            Spacer()
            if model.isLoading {
                ProgressView().tint(HK.accent).scaleEffect(0.7)
            }
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: HK.radiusSm).fill(HK.card))
        .overlay(RoundedRectangle(cornerRadius: HK.radiusSm).stroke(proven ? HK.ok.opacity(0.3) : HK.warn.opacity(0.3)))
    }

    // MARK: — Summary row
    private func summaryRow(_ f: NazarFlags) -> some View {
        let s = f.summary
        let alerts = s?.activeExceptions ?? 0
        return HStack(spacing: 10) {
            metricTile("People Now",  value: "\(s?.peopleNow ?? 0)",              color: HK.text)
            metricTile("Bills Today", value: "\(s?.billsToday ?? 0)",             color: HK.accent)
            metricTile("Sales",       value: "₹\((s?.salesRs ?? 0).formatted())", color: HK.ok)
            metricTile("Alerts",      value: "\(alerts)",                          color: alerts > 0 ? HK.error : HK.textFaint)
        }
    }

    private func metricTile(_ label: String, value: String, color: Color) -> some View {
        VStack(spacing: 4) {
            Text(value).font(.system(size: 20, weight: .bold, design: .rounded)).foregroundColor(color)
            Text(label).font(.system(size: 10, weight: .medium)).foregroundColor(HK.textFaint)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
        .background(RoundedRectangle(cornerRadius: HK.radiusSm).fill(HK.card))
    }

    // MARK: — Why-not-proof (honesty layer)
    @ViewBuilder
    private func whyNotCard(_ f: NazarFlags) -> some View {
        let reasons = f.whyNotProof ?? []
        if !reasons.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                Label("WHY NOT ZERO-MISS PROOF", systemImage: "info.circle")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundColor(HK.warn)
                ForEach(Array(reasons.enumerated()), id: \.offset) { _, r in
                    HStack(alignment: .top, spacing: 8) {
                        Text("•").foregroundColor(HK.warn)
                        Text(r).font(.system(size: 12)).foregroundColor(HK.textDim)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            .background(RoundedRectangle(cornerRadius: HK.radiusSm).fill(HK.card))
            .overlay(RoundedRectangle(cornerRadius: HK.radiusSm).stroke(HK.warn.opacity(0.2)))
        }
    }

    // MARK: — Channels
    private func channelSection(_ f: NazarFlags) -> some View {
        let order = ["first_floor_captain", "ground_floor_cash", "takeaway_kitchen_pass", "delivery_pickup"]
        let labels: [String: String] = [
            "first_floor_captain": "1F Captain",
            "ground_floor_cash": "GF Cash",
            "takeaway_kitchen_pass": "Takeaway",
            "delivery_pickup": "Delivery",
        ]
        return VStack(spacing: 8) {
            sectionHeader("CHANNELS — POS vs CAMERA")
            ForEach(order, id: \.self) { key in
                if let ch = f.channels?[key] {
                    channelCard(label: labels[key] ?? key, channel: ch)
                }
            }
        }
    }

    private func channelCard(label: String, channel: NazarChannel) -> some View {
        let state = channel.status ?? "unknown"
        let (color, icon) = stateStyle(state)
        let bills = channel.pos?.bills ?? 0
        let sales = channel.pos?.salesRs ?? 0
        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 12) {
                Image(systemName: icon).font(.system(size: 16, weight: .semibold)).foregroundColor(color).frame(width: 24)
                VStack(alignment: .leading, spacing: 2) {
                    Text(label).font(.system(size: 14, weight: .semibold)).foregroundColor(HK.text)
                    Text(state.replacingOccurrences(of: "_", with: " "))
                        .font(.system(size: 11, weight: .medium)).foregroundColor(color.opacity(0.85))
                }
                Spacer()
                if channel.engineAssertCapable == false {
                    Text("review only")
                        .font(.system(size: 10, weight: .medium)).foregroundColor(HK.textFaint)
                        .padding(.horizontal, 8).padding(.vertical, 4)
                        .background(Capsule().fill(HK.lineSoft))
                }
            }
            HStack(spacing: 16) {
                Text("\(bills) bills").font(.system(size: 11, weight: .medium)).foregroundColor(HK.textDim)
                Text("₹\(sales.formatted())").font(.system(size: 11, weight: .medium)).foregroundColor(HK.ok)
            }
            if let reason = channel.reason {
                Text(reason).font(.system(size: 11)).foregroundColor(HK.textFaint)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(RoundedRectangle(cornerRadius: HK.radiusSm).fill(HK.card))
        .overlay(RoundedRectangle(cornerRadius: HK.radiusSm).stroke(color.opacity(0.22)))
    }

    private func stateStyle(_ state: String) -> (Color, String) {
        switch state {
        case "review":    return (HK.warn,    "eye.fill")
        case "assert":    return (HK.ok,      "checkmark.shield.fill")
        case "not_wired": return (HK.faint,   "minus.circle")
        case "active":    return (HK.error,   "exclamationmark.triangle.fill")
        case "cleared":   return (HK.ok,      "checkmark.circle.fill")
        default:          return (HK.textDim, "questionmark.circle")
        }
    }

    // MARK: — Live counts (occupancy / footfall) with honest trust labels
    @ViewBuilder
    private func liveCountsCard(_ f: NazarFlags) -> some View {
        if let lc = f.liveCounts {
            VStack(alignment: .leading, spacing: 10) {
                sectionHeader("LIVE COUNTS")
                if let occ = lc.occupancy {
                    countRow("Occupancy now", metric: occ, extra: occ.peak.map { "peak \($0)" })
                }
                if let raw = lc.rawSeenToday {
                    countRow("Frigate seen today", metric: raw, extra: nil)
                }
                if let ff = lc.footfallPublished {
                    footfallRow("Footfall (published)", ff)
                }
                if let ffr = lc.footfallRaw {
                    footfallRow("Footfall (raw)", ffr)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            .background(RoundedRectangle(cornerRadius: HK.radiusSm).fill(HK.card))
        }
    }

    private func countRow(_ label: String, metric: NazarMetric, extra: String?) -> some View {
        HStack {
            Text(label).font(.system(size: 12, weight: .medium)).foregroundColor(HK.textDim)
            Spacer()
            if let e = extra { Text(e).font(.system(size: 10)).foregroundColor(HK.textFaint) }
            Text("\(metric.value ?? 0)").font(.system(size: 14, weight: .semibold)).foregroundColor(HK.text)
            trustPill(metric.trusted)
        }
    }

    private func footfallRow(_ label: String, _ ff: NazarFootfall) -> some View {
        HStack {
            Text(label).font(.system(size: 12, weight: .medium)).foregroundColor(HK.textDim)
            Spacer()
            Text(ff.he.map { "\($0)" } ?? "—").font(.system(size: 14, weight: .semibold)).foregroundColor(HK.text)
            trustPill(ff.trusted ?? false)
        }
    }

    private func trustPill(_ trusted: Bool) -> some View {
        Text(trusted ? "trusted" : "unverified")
            .font(.system(size: 9, weight: .semibold))
            .foregroundColor(trusted ? HK.ok : HK.warn)
            .padding(.horizontal, 7).padding(.vertical, 3)
            .background(Capsule().fill((trusted ? HK.ok : HK.warn).opacity(0.14)))
    }

    // MARK: — Source health (full)
    @ViewBuilder
    private func sourceHealthCard(_ f: NazarFlags) -> some View {
        if let sh = f.sourceHealth {
            VStack(alignment: .leading, spacing: 10) {
                sectionHeader("SOURCE HEALTH")
                FlowChips(chips: healthChips(sh))
                if let frozen = sh.frozenCameras, !frozen.isEmpty {
                    Label("\(frozen.count) frozen: \(frozen.joined(separator: ", "))", systemImage: "snowflake")
                        .font(.system(size: 11, weight: .medium)).foregroundColor(HK.error)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            .background(RoundedRectangle(cornerRadius: HK.radiusSm).fill(HK.card))
        }
    }

    private func healthChips(_ sh: NazarSourceHealth) -> [HealthChip] {
        func chip(_ label: String, _ value: String?) -> HealthChip? {
            guard let v = value else { return nil }
            let good = ["live", "ok", "healthy"].contains(v.lowercased())
            let bad  = ["degraded", "down", "off"].contains(v.lowercased())
            let color = good ? HK.ok : (bad ? HK.warn : HK.textDim)
            return HealthChip(label: label, value: v, color: color)
        }
        return [
            chip("Frigate", sh.frigate),
            chip("Odoo", sh.odoo),
            chip("Food", sh.foodDetection),
            chip("1F", sh.firstFloorMode),
            chip("1F primary", sh.firstFloorPrimary),
            chip("1F backup", sh.firstFloorBackup),
            chip("Ground", sh.groundFloor),
            chip("Face", sh.faceLayer),
        ].compactMap { $0 }
    }

    private func sectionHeader(_ t: String) -> some View {
        Text(t).font(.system(size: 10, weight: .semibold)).foregroundColor(HK.textFaint)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var loadingCard: some View {
        VStack(spacing: 14) {
            ProgressView().tint(HK.accent)
            Text(model.status).font(.system(size: 13)).foregroundColor(HK.textDim)
        }
        .frame(maxWidth: .infinity)
        .padding(40)
        .background(RoundedRectangle(cornerRadius: HK.radius).fill(HK.card))
    }
}

// MARK: - Health chip + simple wrapping flow

struct HealthChip: Identifiable {
    let id = UUID()
    let label: String
    let value: String
    let color: Color
}

/// Lightweight wrapping chip row (no third-party flow layout dependency).
struct FlowChips: View {
    let chips: [HealthChip]
    var body: some View {
        let cols = [GridItem(.adaptive(minimum: 96), spacing: 8)]
        return LazyVGrid(columns: cols, alignment: .leading, spacing: 8) {
            ForEach(chips) { c in
                HStack(spacing: 5) {
                    Circle().fill(c.color).frame(width: 7, height: 7)
                    Text(c.label).font(.system(size: 10, weight: .medium)).foregroundColor(HK.textDim)
                    Text(c.value).font(.system(size: 10, weight: .semibold)).foregroundColor(c.color).lineLimit(1)
                }
                .padding(.horizontal, 9).padding(.vertical, 6)
                .background(Capsule().fill(HK.lineSoft))
            }
        }
    }
}
