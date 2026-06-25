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
                    channelCards(f)
                    sourceHealthRow(f)
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
        let modeText = f.mode ?? "unknown"
        return HStack(spacing: 10) {
            Circle()
                .fill(proven ? HK.ok : HK.warn)
                .frame(width: 10, height: 10)
            Text(modeText.uppercased())
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
        return HStack(spacing: 10) {
            metricTile("People Now",  value: "\(s?.peopleNow ?? 0)",                color: HK.text)
            metricTile("Bills Today", value: "\(s?.billsToday ?? 0)",               color: HK.accent)
            metricTile("Sales",       value: "₹\((s?.salesRs ?? 0).formatted())",   color: HK.ok)
            metricTile("Alerts",      value: "\(s?.activeExceptions ?? 0)",          color: s?.activeExceptions ?? 0 > 0 ? HK.error : HK.textFaint)
        }
    }

    private func metricTile(_ label: String, value: String, color: Color) -> some View {
        VStack(spacing: 4) {
            Text(value)
                .font(.system(size: 20, weight: .bold, design: .rounded))
                .foregroundColor(color)
            Text(label)
                .font(.system(size: 10, weight: .medium))
                .foregroundColor(HK.textFaint)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
        .background(RoundedRectangle(cornerRadius: HK.radiusSm).fill(HK.card))
    }

    // MARK: — Channel cards
    private func channelCards(_ f: NazarFlags) -> some View {
        let order = ["first_floor_captain", "ground_floor_cash", "takeaway_kitchen_pass", "delivery_pickup"]
        let labels: [String: String] = [
            "first_floor_captain": "1F Captain",
            "ground_floor_cash": "GF Cash",
            "takeaway_kitchen_pass": "Takeaway",
            "delivery_pickup": "Delivery",
        ]
        return VStack(spacing: 8) {
            ForEach(order, id: \.self) { key in
                if let ch = f.channels?[key] {
                    channelCard(label: labels[key] ?? key, channel: ch)
                } else {
                    channelCard(label: labels[key] ?? key, channel: NazarChannel(state: "unknown", proofSource: nil, engineReads: nil, assertCapable: nil))
                }
            }
        }
    }

    private func channelCard(label: String, channel: NazarChannel) -> some View {
        let state = channel.state ?? "unknown"
        let (color, icon) = stateStyle(state)
        return HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 16, weight: .semibold))
                .foregroundColor(color)
                .frame(width: 28)
            VStack(alignment: .leading, spacing: 2) {
                Text(label)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(HK.text)
                Text(state.replacingOccurrences(of: "_", with: " "))
                    .font(.system(size: 11, weight: .medium))
                    .foregroundColor(color.opacity(0.8))
            }
            Spacer()
            if channel.assertCapable == false {
                Text("review only")
                    .font(.system(size: 10, weight: .medium))
                    .foregroundColor(HK.textFaint)
                    .padding(.horizontal, 8).padding(.vertical, 4)
                    .background(Capsule().fill(HK.lineSoft))
            }
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: HK.radiusSm).fill(HK.card))
        .overlay(RoundedRectangle(cornerRadius: HK.radiusSm).stroke(color.opacity(0.25)))
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

    // MARK: — Source health row
    private func sourceHealthRow(_ f: NazarFlags) -> some View {
        let sh = f.sourceHealth
        let mode = sh?.firstFloorMode ?? "unknown"
        let frozen = sh?.frozenCameras ?? []
        return VStack(alignment: .leading, spacing: 6) {
            Text("SOURCE HEALTH")
                .font(.system(size: 10, weight: .semibold))
                .foregroundColor(HK.textFaint)
            HStack(spacing: 16) {
                Label("1F: \(mode)", systemImage: mode == "backup" ? "arrow.triangle.2.circlepath" : "camera.fill")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(mode == "backup" ? HK.warn : HK.ok)
                if !frozen.isEmpty {
                    Label("\(frozen.count) frozen", systemImage: "snowflake")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundColor(HK.error)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(RoundedRectangle(cornerRadius: HK.radiusSm).fill(HK.card))
    }

    private var loadingCard: some View {
        VStack(spacing: 14) {
            ProgressView().tint(HK.accent)
            Text(model.status)
                .font(.system(size: 13))
                .foregroundColor(HK.textDim)
        }
        .frame(maxWidth: .infinity)
        .padding(40)
        .background(RoundedRectangle(cornerRadius: HK.radius).fill(HK.card))
    }
}
