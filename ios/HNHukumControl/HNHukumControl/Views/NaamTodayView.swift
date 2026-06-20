import SwiftUI

struct NaamTodayView: View {
    @StateObject private var model = NaamAppModel()

    var body: some View {
        ZStack {
            HK.bg.ignoresSafeArea()
            VStack(spacing: 0) {
                ChamberHeader(title: "Naam", subtitle: model.statusLine, accent: Color(hex: 0xE0762D))
                Picker("Brand", selection: $model.brand) {
                    Text("Hamza Express").tag("HE")
                    Text("Nawabi Chai").tag("NCH")
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, 16).padding(.bottom, 8)

                if let d = model.staleDays, d > 7 {
                    HStack(spacing: 8) {
                        Image(systemName: "clock.badge.exclamationmark").font(.system(size: 13, weight: .semibold))
                        Text("Snapshot is \(d) days old — open the cockpit for live numbers.")
                            .font(.system(size: 12, weight: .medium))
                    }
                    .foregroundStyle(HK.running)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 16).padding(.bottom, 8)
                }

                ScrollView {
                    LazyVStack(spacing: 10) {
                        ForEach(model.lanes) { NaamLaneRow(lane: $0, brand: model.brand) }
                        if model.lanes.isEmpty {
                            Text(model.statusLine).font(.subheadline).foregroundStyle(HK.textFaint).padding(.top, 40)
                        }
                    }
                    .padding(.horizontal, 16).padding(.bottom, 10)
                }
                .scrollIndicators(.hidden)
                .refreshable { await model.refresh() }
            }
        }
        .task { await model.bootstrap() }
        .navigationTitle("Naam")
        .navigationBarTitleDisplayMode(.inline)
    }
}

struct NaamLaneRow: View {
    let lane: NaamLane
    let brand: String
    private var bl: NaamBrandLane? { lane.brandLane(brand) }

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack {
                Text(lane.title ?? lane.id)
                    .font(.system(size: 16, weight: .semibold)).foregroundStyle(HK.text)
                Spacer()
                if let s = bl?.status {
                    Text(s.uppercased())
                        .font(.system(size: 10, weight: .heavy)).foregroundStyle(statusColor(s))
                        .padding(.horizontal, 7).padding(.vertical, 3)
                        .background(statusColor(s).opacity(0.16), in: Capsule())
                }
            }
            if let sub = lane.subtitle, !sub.isEmpty {
                Text(sub).font(.system(size: 12)).foregroundStyle(HK.textFaint)
            }
            if let sum = bl?.summary, !sum.isEmpty {
                Text(sum).font(.system(size: 13)).foregroundStyle(HK.textDim).lineLimit(3)
            }
        }
        .padding(14)
        .background(HK.card, in: RoundedRectangle(cornerRadius: HK.radius))
        .overlay(RoundedRectangle(cornerRadius: HK.radius).stroke(HK.line, lineWidth: 1))
    }

    private func statusColor(_ s: String) -> Color {
        switch s.lowercased() {
        case "live": return HK.ready
        case "paused", "hold", "draft": return HK.running
        default: return HK.idle
        }
    }
}
