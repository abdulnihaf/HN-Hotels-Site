import SwiftUI

struct BoardView: View {
    @StateObject private var model = BoardModel()
    private let tick = Timer.publish(every: 45, on: .main, in: .common).autoconnect()

    var body: some View {
        ZStack {
            HK.bg.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    header
                    if let b = model.board {
                        needsYou(b)
                        inFlight(b)
                        doneToday(b)
                        chain(b)
                        footer(b)
                    } else {
                        Text(model.statusLine).font(.system(size: 13)).foregroundStyle(HK.textDim)
                            .frame(maxWidth: .infinity, alignment: .center).padding(.top, 40)
                    }
                }
                .padding(.horizontal, 16).padding(.bottom, 24)
            }
            .scrollIndicators(.hidden)
            .refreshable { await model.refresh() }
        }
        .task { await model.bootstrap() }
        .onReceive(tick) { _ in Task { await model.refresh() } }
    }

    private var header: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 3) {
                Text("Mezaan").font(.system(size: 28, weight: .heavy, design: .rounded)).foregroundStyle(HK.text)
                Text(model.statusLine).font(.system(size: 12.5, weight: .medium)).foregroundStyle(HK.textDim).lineLimit(1)
            }
            Spacer()
            Circle().fill(model.reachable ? HK.ready : HK.danger).frame(width: 9, height: 9)
        }
        .padding(.top, 8)
    }

    @ViewBuilder private func needsYou(_ b: BoardState) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionHead(icon: "hand.raised.fill", title: "NEEDS YOU", count: b.needsYou.count, tint: HK.danger)
            if b.needsYou.isEmpty {
                Text("Nothing is waiting on you.").font(.system(size: 13)).foregroundStyle(HK.textFaint)
            } else {
                ForEach(Array(b.needsYou.enumerated()), id: \.offset) { _, a in
                    HStack(alignment: .top, spacing: 8) {
                        Circle().fill(HK.danger).frame(width: 6, height: 6).padding(.top, 6)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(a.action ?? a.details ?? "Decision needed").font(.system(size: 14, weight: .semibold)).foregroundStyle(HK.text)
                            if let lane = a.lane_title ?? a.target { Text(lane).font(.system(size: 11.5)).foregroundStyle(HK.textDim) }
                        }
                        Spacer()
                        if let r = a.risk { Pill(text: r.uppercased(), fg: HK.danger, bg: HK.danger.opacity(0.16)) }
                    }
                    .padding(11)
                    .background(HK.card, in: RoundedRectangle(cornerRadius: 12))
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(HK.danger.opacity(0.35), lineWidth: 1))
                }
            }
        }
    }

    @ViewBuilder private func inFlight(_ b: BoardState) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionHead(icon: "bolt.fill", title: "IN FLIGHT", count: b.inFlight.count, tint: HK.amber)
            if b.inFlight.isEmpty {
                Text("Nothing running right now.").font(.system(size: 13)).foregroundStyle(HK.textFaint)
            } else {
                ForEach(Array(b.inFlight.enumerated()), id: \.offset) { _, j in
                    HStack(spacing: 8) {
                        Text(Fmt.jobTitle(j)).font(.system(size: 13.5)).foregroundStyle(HK.text).lineLimit(1)
                        Spacer()
                        Pill(text: HK.engineLabel(j.target?.app), fg: HK.engine(j.target?.app), bg: HK.engine(j.target?.app).opacity(0.16))
                        Text((j.health_state ?? j.status ?? "").lowercased()).font(.system(size: 11, weight: .semibold)).foregroundStyle(HK.amber)
                    }
                    .padding(.vertical, 6).padding(.horizontal, 4)
                }
            }
        }
    }

    @ViewBuilder private func doneToday(_ b: BoardState) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionHead(icon: "checkmark.circle.fill", title: "DONE TODAY", count: b.doneToday.count, tint: HK.ready)
            if b.doneToday.isEmpty {
                Text("No completed runs logged today yet.").font(.system(size: 13)).foregroundStyle(HK.textFaint)
            } else {
                ForEach(Array(b.doneToday.prefix(8).enumerated()), id: \.offset) { _, j in
                    HStack(spacing: 8) {
                        Image(systemName: "checkmark").font(.system(size: 11, weight: .bold)).foregroundStyle(HK.ready)
                        Text(Fmt.jobTitle(j)).font(.system(size: 13)).foregroundStyle(HK.textDim).lineLimit(1)
                        Spacer()
                        Text(Fmt.ago(j.finished_at)).font(.system(size: 11)).foregroundStyle(HK.textFaint)
                    }
                    .padding(.vertical, 4)
                }
            }
        }
    }

    @ViewBuilder private func chain(_ b: BoardState) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHead(icon: "link", title: "CHAIN HEALTH", tint: HK.text)
            HStack(spacing: 6) {
                ForEach(b.chain) { c in
                    VStack(spacing: 5) {
                        Circle()
                            .fill(c.working ? HK.amber : (c.present ? HK.ready : HK.textFaint))
                            .frame(width: 8, height: 8)
                        Text(c.name).font(.system(size: 11, weight: .heavy)).foregroundStyle(HK.text)
                        Text(c.present ? HK.engineLabel(c.engine) : "—")
                            .font(.system(size: 9.5, weight: .semibold)).foregroundStyle(HK.engine(c.engine))
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                    .background(c.active ? HK.engine(c.engine).opacity(0.14) : HK.card, in: RoundedRectangle(cornerRadius: 12))
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(c.active ? HK.accent.opacity(0.5) : HK.line, lineWidth: 1))
                }
            }
            Text("Sauda → Anbar → Takht → Nazar → Darbar").font(.system(size: 10.5)).foregroundStyle(HK.textFaint)
        }
    }

    private func footer(_ b: BoardState) -> some View {
        HStack {
            Image(systemName: "lock.fill").font(.system(size: 9))
            Text("read-only · fed by the Hukum bridge · updated \(timeStr(b.updated))")
        }
        .font(.system(size: 10.5)).foregroundStyle(HK.textFaint)
        .padding(.top, 4)
    }

    private func timeStr(_ d: Date) -> String {
        let f = DateFormatter(); f.timeZone = TimeZone(identifier: "Asia/Kolkata"); f.dateFormat = "HH:mm"
        return f.string(from: d) + " IST"
    }
}
