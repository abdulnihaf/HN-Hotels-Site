import SwiftUI

struct ContentView: View {
    @ObservedObject var model: TakhtAppModel
    private let accent = TakhtTheme.accent

    var body: some View {
        ZStack {
            TakhtTheme.bg.ignoresSafeArea()
            if model.unlocked {
                board
            } else {
                GateView(model: model)
            }
        }
        .animation(.easeInOut(duration: 0.22), value: model.unlocked)
    }

    // ── BOARD ──
    private var board: some View {
        VStack(spacing: 0) {
            header
            ScrollView {
                VStack(spacing: 12) {
                    flagsCard
                    handHero
                    upiCard
                    chaiCard
                    sessionCard
                    rectifyPlaceholder
                }
                .padding(.horizontal, 16).padding(.bottom, 24)
            }
            .scrollIndicators(.hidden)
            .refreshable { await model.refresh() }
        }
    }

    private var header: some View {
        HStack {
            VStack(alignment: .leading, spacing: 3) {
                Text("Takht")
                    .font(.system(size: 28, weight: .heavy, design: .serif))
                    .foregroundStyle(TakhtTheme.text)
                Text(model.status)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(TakhtTheme.textDim)
            }
            Spacer()
            if model.isRefreshing {
                ProgressView().tint(accent).scaleEffect(0.85)
            }
            Button { model.lock() } label: {
                Image(systemName: "lock.fill")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(TakhtTheme.text)
                    .frame(width: 40, height: 40)
                    .background(TakhtTheme.card, in: Circle())
                    .overlay(Circle().stroke(TakhtTheme.line, lineWidth: 1))
            }
        }
        .padding(16)
        .background(TakhtTheme.bgElev)
    }

    // ── FLAGS — "What was missed, read to staff" ──
    private var flagsCard: some View {
        cardContainer(title: "What was missed", icon: "exclamationmark.bubble.fill", badge: "READ TO STAFF") {
            VStack(spacing: 8) {
                ForEach(model.flags) { f in flagRow(f) }
            }
        }
    }

    private func flagRow(_ f: TakhtFlag) -> some View {
        let c: Color = f.level == .red ? TakhtTheme.red : (f.level == .amber ? TakhtTheme.amber : TakhtTheme.green)
        return HStack(alignment: .top, spacing: 10) {
            Circle().fill(c).frame(width: 9, height: 9).padding(.top, 5)
            VStack(alignment: .leading, spacing: 2) {
                Text(f.title.capForDisplay())
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(TakhtTheme.text)
                Text(f.cause.capForDisplay(120))
                    .font(.system(size: 12.5))
                    .foregroundStyle(TakhtTheme.textDim)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(11)
        .background(c.opacity(0.12), in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(c.opacity(0.3), lineWidth: 0.5))
    }

    // ── THE RUPEE THAT REACHES YOUR HAND ──
    private var handHero: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 0) {
                chainNode("Runners", TakhtFmt.rupee(model.balance?.runnerCash), TakhtTheme.textDim)
                Text("→").foregroundStyle(accent).font(.system(size: 16, weight: .bold)).padding(.horizontal, 4)
                chainNode("Cashier", TakhtFmt.rupee(model.balance?.counterCash), TakhtTheme.textDim)
                Text("→").foregroundStyle(accent).font(.system(size: 16, weight: .bold)).padding(.horizontal, 4)
                chainNode("You", TakhtFmt.rupee(model.handTotal), accent)
            }
            .padding(.bottom, 4)
            if model.balance != nil {
                Text(TakhtFmt.rupee(model.handTotal))
                    .font(.system(size: 42, weight: .heavy, design: .rounded))
                    .foregroundStyle(TakhtTheme.text)
                Text("cash that should reach your hand")
                    .font(.system(size: 12))
                    .foregroundStyle(TakhtTheme.textDim)
            } else {
                Text("Counter balance unreadable")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(TakhtTheme.textFaint)
                    .padding(.vertical, 8)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(
            LinearGradient(colors: [accent.opacity(0.18), TakhtTheme.card], startPoint: .topLeading, endPoint: .bottomTrailing),
            in: RoundedRectangle(cornerRadius: TakhtTheme.radius)
        )
        .overlay(RoundedRectangle(cornerRadius: TakhtTheme.radius).stroke(accent.opacity(0.35), lineWidth: 1))
    }

    private func chainNode(_ label: String, _ value: String, _ color: Color) -> some View {
        VStack(spacing: 2) {
            Text(label)
                .font(.system(size: 11, weight: .heavy))
                .foregroundStyle(color == accent ? accent : TakhtTheme.textDim)
            Text(value)
                .font(.system(size: 13, weight: .bold, design: .rounded))
                .foregroundStyle(color == accent ? accent : TakhtTheme.text)
        }
        .frame(maxWidth: .infinity)
    }

    // ── UPI · Razorpay vs POS ──
    private var upiCard: some View {
        cardContainer(title: "UPI · Razorpay vs POS", icon: "indianrupeesign.circle.fill",
                      badge: model.upi == nil ? nil : "LIVE") {
            if let snaps = model.upi?.snapshots, !snaps.isEmpty {
                VStack(spacing: 7) {
                    ForEach(snaps) { s in
                        HStack(spacing: 6) {
                            Text((s.entity + (s.isRunnerQr == true ? " (runner)" : "")).capForDisplay())
                                .font(.system(size: 12.5, weight: .medium))
                                .foregroundStyle(TakhtTheme.textDim)
                                .lineLimit(1)
                            Spacer()
                            Text(TakhtFmt.rupee(s.razorpay))
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(TakhtTheme.text)
                            Text("/r").font(.system(size: 10)).foregroundStyle(TakhtTheme.textFaint)
                            Text(TakhtFmt.rupee(s.posUpi))
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(TakhtTheme.text)
                            Text("/p").font(.system(size: 10)).foregroundStyle(TakhtTheme.textFaint)
                            gapPill(s)
                        }
                    }
                }
            } else {
                Text("Source unreachable").font(.system(size: 13)).foregroundStyle(TakhtTheme.textFaint)
            }
        }
    }

    private func gapPill(_ s: TakhtUpiSnapshot) -> some View {
        let c: Color = s.isOff ? TakhtTheme.red : TakhtTheme.green
        let txt = s.isOff ? (s.gap > 0 ? "+" : "") + TakhtFmt.rupee(s.gap) : "✓"
        return Text(txt)
            .font(.system(size: 10, weight: .heavy))
            .foregroundStyle(c)
            .padding(.horizontal, 7).padding(.vertical, 3)
            .background(c.opacity(0.16), in: Capsule())
    }

    // ── Chai · token box vs POS ──
    private var chaiCard: some View {
        cardContainer(title: "Inventory · chai", icon: "cup.and.saucer.fill", badge: nil) {
            if let t = model.token {
                metricGrid([
                    ("Weighed tokens", "\(t.tokenCount ?? 0)"),
                    ("POS beverages",  "\(t.odooTotalBeverages ?? 0)"),
                    ("Gap",            "\((t.discrepancy ?? 0) > 0 ? "+" : "")\(t.discrepancy ?? 0)"),
                ])
            } else {
                Text("Source unreachable").font(.system(size: 13)).foregroundStyle(TakhtTheme.textFaint)
            }
        }
    }

    // ── POS session ──
    private var sessionCard: some View {
        cardContainer(title: "POS session", icon: "clock.badge.checkmark.fill", badge: nil) {
            if let sh = model.shift {
                let days = (sh.shiftMinutes ?? 0) / 1440
                metricGrid([
                    ("Cashier",  sh.name?.capForDisplay(24) ?? "—"),
                    ("Open for", "\(days)d"),
                    ("State",    days > 1 ? "never closed" : "ok"),
                ])
            } else {
                Text("No shift on record").font(.system(size: 13)).foregroundStyle(TakhtTheme.textFaint)
            }
        }
    }

    // ── Correction placeholder (execution is in the staff app) ──
    private var rectifyPlaceholder: some View {
        HStack(spacing: 10) {
            Image(systemName: "wrench.and.screwdriver.fill")
                .font(.system(size: 14))
                .foregroundStyle(TakhtTheme.textFaint)
            VStack(alignment: .leading, spacing: 2) {
                Text("One-tap correct")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(TakhtTheme.textFaint)
                Text("Fixes happen in the staff settlement app — this is the witness view.")
                    .font(.system(size: 12))
                    .foregroundStyle(TakhtTheme.textFaint)
            }
            Spacer(minLength: 0)
        }
        .padding(13)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(TakhtTheme.bgElev, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(TakhtTheme.line, lineWidth: 1))
        .opacity(0.7)
    }

    // ── Reusable card container ──
    private func cardContainer<Content: View>(title: String, icon: String, badge: String?, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                Image(systemName: icon).font(.system(size: 13)).foregroundStyle(accent)
                Text(title)
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(TakhtTheme.textDim)
                    .textCase(.uppercase)
                Spacer()
                if let b = badge {
                    Text(b)
                        .font(.system(size: 9, weight: .heavy))
                        .foregroundStyle(TakhtTheme.green)
                        .padding(.horizontal, 6).padding(.vertical, 2)
                        .background(TakhtTheme.green.opacity(0.16), in: Capsule())
                }
            }
            content()
        }
        .padding(14)
        .background(TakhtTheme.card, in: RoundedRectangle(cornerRadius: TakhtTheme.radius))
        .overlay(RoundedRectangle(cornerRadius: TakhtTheme.radius).stroke(TakhtTheme.line, lineWidth: 1))
    }

    private func metricGrid(_ items: [(String, String)]) -> some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 3), spacing: 10) {
            ForEach(items, id: \.0) { label, value in
                VStack(alignment: .leading, spacing: 3) {
                    Text(label)
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(TakhtTheme.textFaint)
                        .textCase(.uppercase)
                    Text(value)
                        .font(.system(size: 15, weight: .heavy, design: .rounded))
                        .foregroundStyle(TakhtTheme.text)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }
}

// ── GATE VIEW ──
struct GateView: View {
    @ObservedObject var model: TakhtAppModel
    private let accent = TakhtTheme.accent
    @State private var buf = ""
    @State private var err = ""
    @State private var checking = false

    var body: some View {
        VStack(spacing: 0) {
            Spacer()
            // Crest
            ZStack {
                RoundedRectangle(cornerRadius: 18)
                    .fill(TakhtTheme.bgElev)
                    .overlay(RoundedRectangle(cornerRadius: 18).stroke(accent.opacity(0.5), lineWidth: 1))
                    .frame(width: 76, height: 76)
                Text("त")
                    .font(.system(size: 38, weight: .heavy, design: .serif))
                    .foregroundStyle(accent)
            }
            Text("Takht")
                .font(.system(size: 46, weight: .heavy, design: .serif))
                .foregroundStyle(TakhtTheme.text)
                .padding(.top, 16)
            Text("the seat where revenue lands")
                .font(.system(size: 14, weight: .medium, design: .serif))
                .italic()
                .foregroundStyle(accent)
                .padding(.top, 2)

            // PIN dots
            HStack(spacing: 16) {
                ForEach(0..<4, id: \.self) { i in
                    Circle()
                        .strokeBorder(accent.opacity(0.6), lineWidth: 1.5)
                        .background(Circle().fill(i < buf.count ? accent : .clear))
                        .frame(width: 12, height: 12)
                }
            }
            .padding(.top, 30).padding(.bottom, 28)

            Text(err.isEmpty ? " " : err)
                .font(.system(size: 13))
                .foregroundStyle(TakhtTheme.red)
                .frame(height: 16)

            keypad.padding(.top, 8)
            Spacer()
            Text("HN Hotels · since 1918")
                .font(.system(size: 11, weight: .medium, design: .serif))
                .italic()
                .foregroundStyle(accent.opacity(0.5))
                .padding(.bottom, 8)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(TakhtTheme.bg.ignoresSafeArea())
    }

    private var keypad: some View {
        let keys = ["1","2","3","4","5","6","7","8","9","","0","⌫"]
        return LazyVGrid(columns: Array(repeating: GridItem(.fixed(68), spacing: 22), count: 3), spacing: 22) {
            ForEach(keys, id: \.self) { k in
                if k.isEmpty {
                    Color.clear.frame(width: 68, height: 68)
                } else {
                    Button { tap(k) } label: {
                        Text(k)
                            .font(.system(size: k == "⌫" ? 22 : 26, weight: .regular))
                            .foregroundStyle(k == "⌫" ? TakhtTheme.textDim : TakhtTheme.text)
                            .frame(width: 68, height: 68)
                            .background(k == "⌫" ? Color.clear : TakhtTheme.cardHi, in: Circle())
                    }
                    .disabled(checking)
                }
            }
        }
    }

    private func tap(_ k: String) {
        err = ""
        if k == "⌫" { if !buf.isEmpty { buf.removeLast() }; return }
        guard buf.count < 4 else { return }
        buf += k
        if buf.count == 4 { submit() }
    }

    private func submit() {
        let pin = buf
        checking = true
        Task {
            if let e = await model.unlock(pin: pin) {
                err = e; buf = ""; checking = false
            }
        }
    }
}
