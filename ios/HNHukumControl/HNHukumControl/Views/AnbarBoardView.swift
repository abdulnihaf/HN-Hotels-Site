import SwiftUI

struct AnbarBoardView: View {
    @StateObject private var model = AnbarAppModel()

    var body: some View {
        ZStack {
            HK.bg.ignoresSafeArea()
            VStack(spacing: 0) {
                ChamberHeader(title: "Anbar", subtitle: model.statusLine, accent: Color(hex: 0x4FAE6A))
                ScrollView {
                    LazyVStack(spacing: 10) {
                        ForEach(model.items) { AnbarItemRow(item: $0) }
                        ForEach(model.chicken) { AnbarChickenRow(c: $0) }
                        if model.items.isEmpty && model.chicken.isEmpty {
                            Text(model.statusLine)
                                .font(.subheadline).foregroundStyle(HK.textFaint).padding(.top, 44)
                        }
                    }
                    .padding(.horizontal, 16).padding(.bottom, 10)
                }
                .scrollIndicators(.hidden)
                .refreshable { await model.refresh() }
            }
        }
        .task { await model.bootstrap() }
        .navigationTitle("Anbar")
        .navigationBarTitleDisplayMode(.inline)
    }
}

struct AnbarItemRow: View {
    let item: AnbarItem

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            Text(item.name ?? item.code)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(HK.text)
            HStack(spacing: 8) {
                if let c = item.counter { locPill("Counter", c) }
                if let s = item.store { locPill("Store", s) }
                Spacer()
            }
        }
        .padding(14)
        .background(HK.card, in: RoundedRectangle(cornerRadius: HK.radius))
        .overlay(RoundedRectangle(cornerRadius: HK.radius).stroke(HK.line, lineWidth: 1))
    }

    private func locPill(_ label: String, _ l: AnbarLoc) -> some View {
        HStack(spacing: 6) {
            Circle().fill(anbarStateColor(l.state)).frame(width: 7, height: 7)
            Text("\(label) \(l.expected ?? 0)")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(HK.textDim)
            Text((l.state ?? "").uppercased())
                .font(.system(size: 9, weight: .heavy))
                .foregroundStyle(anbarStateColor(l.state))
        }
        .padding(.horizontal, 9).padding(.vertical, 5)
        .background(HK.bgElev, in: Capsule())
    }
}

struct AnbarChickenRow: View {
    let c: AnbarChicken

    var body: some View {
        HStack {
            Text(c.label ?? c.cut)
                .font(.system(size: 15, weight: .semibold)).foregroundStyle(HK.text)
            Spacer()
            Text(String(format: "%.1f kg", c.onHandKg ?? 0))
                .font(.system(size: 14, weight: .bold)).foregroundStyle(HK.textDim)
            Circle().fill(anbarStateColor(c.state)).frame(width: 7, height: 7)
        }
        .padding(14)
        .background(HK.card, in: RoundedRectangle(cornerRadius: HK.radius))
        .overlay(RoundedRectangle(cornerRadius: HK.radius).stroke(HK.line, lineWidth: 1))
    }
}
