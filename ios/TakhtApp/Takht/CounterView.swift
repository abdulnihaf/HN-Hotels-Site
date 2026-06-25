import SwiftUI

// The live slot board — who is attributed at the counter, resolved from Darbar.
// Runners are RUN01-05 (fixed slots). Named staff resolve to their live Darbar
// person; a departed cashier shows as a ghost instead of being silently credited.
struct CounterView: View {
    @ObservedObject var model: TakhtAppModel
    let accent: Color
    @Environment(\.dismiss) private var dismiss

    private var r: TakhtResolverResponse? { model.resolver }

    var body: some View {
        VStack(spacing: 0) {
            header
            ScrollView {
                VStack(spacing: 12) {
                    if model.resolverLoading && r == nil {
                        loading
                    } else if let r {
                        flagsCard(r.flags ?? [])
                        runnersCard(r.runners ?? [])
                        staffCard((r.slots ?? []).filter { $0.isStaff })
                    } else {
                        Text("Counter board unreachable").font(.system(size: 13)).foregroundStyle(TakhtTheme.textFaint).padding(.vertical, 40)
                    }
                }
                .padding(.horizontal, 16).padding(.vertical, 16)
            }
            .scrollIndicators(.hidden)
            .refreshable { await model.loadResolver() }
        }
        .background(TakhtTheme.bg.ignoresSafeArea())
        .navigationBarHidden(true)
        .task { await model.loadResolver() }
    }

    private var header: some View {
        HStack(spacing: 12) {
            Button { dismiss() } label: {
                Image(systemName: "chevron.left").font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(TakhtTheme.text).frame(width: 38, height: 38)
                    .background(TakhtTheme.card, in: Circle())
                    .overlay(Circle().stroke(TakhtTheme.line, lineWidth: 1))
            }
            VStack(alignment: .leading, spacing: 2) {
                Text("On the counter").font(.system(size: 20, weight: .heavy, design: .serif)).foregroundStyle(TakhtTheme.text)
                if let s = r?.summary {
                    Text("\(s.runners ?? 0) runners · \(s.staff_live ?? 0) staff live · \(s.staff_ghost ?? 0) ghost")
                        .font(.system(size: 12, weight: .medium)).foregroundStyle(TakhtTheme.textDim)
                }
            }
            Spacer()
            if model.resolverLoading { ProgressView().tint(accent).scaleEffect(0.8) }
        }
        .padding(16).background(TakhtTheme.bgElev)
    }

    private var loading: some View {
        VStack(spacing: 10) { ProgressView().tint(accent); Text("reading the counter…").font(.system(size: 13)).foregroundStyle(TakhtTheme.textFaint) }
            .frame(maxWidth: .infinity).padding(.vertical, 50)
    }

    // Runners: the five fixed slots — clean, no names.
    private func runnersCard(_ runners: [TakhtRunnerSlot]) -> some View {
        card(title: "Runners", icon: "figure.run", badge: "RUN01–05") {
            FlowChips(runners.map { $0.runner }, accent: accent)
        }
    }

    // Named staff: live person or a flagged ghost.
    private func staffCard(_ slots: [TakhtSlot]) -> some View {
        card(title: "Counter staff", icon: "person.text.rectangle.fill", badge: nil) {
            VStack(spacing: 7) {
                ForEach(slots) { s in
                    HStack(spacing: 8) {
                        Text(roleLabel(s.role)).font(.system(size: 11, weight: .heavy))
                            .foregroundStyle(TakhtTheme.textFaint).frame(width: 64, alignment: .leading)
                        if s.status == "live", let name = s.person?.name {
                            Text(name).font(.system(size: 13.5, weight: .semibold)).foregroundStyle(TakhtTheme.text)
                            Spacer()
                            statusPill("live", TakhtTheme.green)
                        } else {
                            Text(s.label_was ?? "—").font(.system(size: 13.5)).foregroundStyle(TakhtTheme.textFaint).strikethrough()
                            Spacer()
                            statusPill("gone", TakhtTheme.red)
                        }
                    }
                }
            }
        }
    }

    private func flagsCard(_ flags: [TakhtResolverFlag]) -> some View {
        VStack(spacing: 8) {
            ForEach(flags) { f in
                let c: Color = f.level == "red" ? TakhtTheme.red : (f.level == "amber" ? TakhtTheme.amber : TakhtTheme.green)
                HStack(alignment: .top, spacing: 10) {
                    Circle().fill(c).frame(width: 9, height: 9).padding(.top, 5)
                    Text(f.text.capForDisplay(160)).font(.system(size: 12.5)).foregroundStyle(TakhtTheme.textDim)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 0)
                }
                .padding(11).background(c.opacity(0.10), in: RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(c.opacity(0.25), lineWidth: 0.5))
            }
        }
    }

    private func statusPill(_ t: String, _ c: Color) -> some View {
        Text(t).font(.system(size: 9, weight: .heavy)).foregroundStyle(c)
            .padding(.horizontal, 7).padding(.vertical, 2).background(c.opacity(0.16), in: Capsule())
    }
    private func roleLabel(_ r: String) -> String {
        switch r { case "cashier": return "CASHIER"; case "gm": return "GM"; case "manager": return "MANAGER"
        case "admin": return "ADMIN"; case "supervisor": return "SUPVR"; default: return r.uppercased() }
    }

    private func card<C: View>(title: String, icon: String, badge: String?, @ViewBuilder content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                Image(systemName: icon).font(.system(size: 13)).foregroundStyle(accent)
                Text(title).font(.system(size: 13, weight: .bold)).foregroundStyle(TakhtTheme.textDim).textCase(.uppercase)
                Spacer()
                if let b = badge {
                    Text(b).font(.system(size: 9, weight: .heavy)).foregroundStyle(accent)
                        .padding(.horizontal, 6).padding(.vertical, 2).background(accent.opacity(0.16), in: Capsule())
                }
            }
            content()
        }
        .padding(14).frame(maxWidth: .infinity, alignment: .leading)
        .background(TakhtTheme.card, in: RoundedRectangle(cornerRadius: TakhtTheme.radius))
        .overlay(RoundedRectangle(cornerRadius: TakhtTheme.radius).stroke(TakhtTheme.line, lineWidth: 1))
    }
}

// Simple chip row that wraps.
private struct FlowChips: View {
    let items: [String]; let accent: Color
    init(_ items: [String], accent: Color) { self.items = items; self.accent = accent }
    var body: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 5), spacing: 8) {
            ForEach(items, id: \.self) { t in
                Text(t).font(.system(size: 12, weight: .heavy, design: .rounded)).foregroundStyle(accent)
                    .frame(maxWidth: .infinity).padding(.vertical, 9)
                    .background(accent.opacity(0.12), in: RoundedRectangle(cornerRadius: 10))
                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(accent.opacity(0.3), lineWidth: 1))
            }
        }
    }
}
