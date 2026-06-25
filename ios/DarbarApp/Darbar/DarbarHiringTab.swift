import SwiftUI

// Darbar — Hiring tab (the work BEFORE hire). Phase-1 flow #1: the graded manpower-supplier
// CALL LIST. Read-glance the best agencies (graded from real research), tap to call, log the
// outcome in one tap — so "have we called them" is derived from real taps, never declared.
// Additive 5th tab; touches none of Today/Attendance/Pay/Roster. Shared HK kit + Darbar accent.

struct DarbarHiringTab: View {
    @ObservedObject var model: DarbarAppModel
    private let accent = DarbarView.accent

    private let filters: [(key: String, label: String)] = [
        ("all", "All"), ("new", "To call"), ("active", "In play"), ("done", "Sent JD"),
    ]

    var body: some View {
        DarbarScreen(title: "Hiring", subtitle: subtitle) {
            ScrollView {
                VStack(spacing: 12) {
                    filterBar
                    if model.loadingSuppliers && model.suppliers.isEmpty {
                        loadingState
                    } else if model.suppliers.isEmpty {
                        emptyState
                    } else {
                        sectionLabel("MANPOWER SUPPLIERS", trailing: "\(model.suppliersFiltered.count)")
                        ForEach(model.suppliersFiltered) { s in
                            SupplierCard(supplier: s, model: model)
                        }
                        Text("Free channel · call first. Numbers are research leads — verify on the call.")
                            .font(.system(size: 10.5, weight: .medium)).foregroundStyle(HK.textFaint)
                            .frame(maxWidth: .infinity).padding(.top, 4)
                    }
                }
                .padding(.horizontal, 16).padding(.bottom, 24)
            }
            .scrollIndicators(.hidden)
            .refreshable { await model.loadSuppliers() }
        }
        .task { if !model.suppliersLoaded { await model.loadSuppliers() } }
    }

    private var subtitle: String {
        if !model.suppliersLoaded { return "Loading suppliers…" }
        let n = model.supplierUncalled
        return n > 0 ? "\(n) supplier\(n == 1 ? "" : "s") still to call" : "All suppliers contacted"
    }

    private var filterBar: some View {
        HStack(spacing: 2) {
            ForEach(filters, id: \.key) { f in
                let on = model.supplierFilter == f.key
                Text(f.label)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(on ? .black : HK.textDim)
                    .frame(maxWidth: .infinity).padding(.vertical, 7)
                    .background(on ? accent : Color.clear, in: RoundedRectangle(cornerRadius: 9))
                    .onTapGesture { model.supplierFilter = f.key }
            }
        }
        .padding(3).background(HK.bgElev, in: RoundedRectangle(cornerRadius: 11))
    }

    private var loadingState: some View {
        VStack(spacing: 12) {
            ProgressView().tint(accent)
            Text("Opening the supplier list…").font(.system(size: 13)).foregroundStyle(HK.textDim)
        }.frame(maxWidth: .infinity).padding(.vertical, 48)
    }

    private var emptyState: some View {
        VStack(spacing: 10) {
            Image(systemName: "person.2.wave.2.fill").font(.system(size: 34)).foregroundStyle(accent)
            Text("Supplier list is being built").font(.system(size: 16, weight: .semibold)).foregroundStyle(HK.text)
            Text("Graded Bangalore staffing agencies will appear here\nas soon as the research lands. Pull to refresh.")
                .font(.system(size: 13)).foregroundStyle(HK.textDim).multilineTextAlignment(.center)
        }.frame(maxWidth: .infinity).padding(.vertical, 44)
    }
}

// One supplier — grade + real evidence up top, big Call button, one-tap outcome log.
struct SupplierCard: View {
    let supplier: HiringSupplier
    @ObservedObject var model: DarbarAppModel
    @Environment(\.openURL) private var openURL
    @State private var logging = false
    private let accent = DarbarView.accent

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 11) {
                gradeBadge
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 6) {
                        Text(supplier.name).font(.system(size: 15.5, weight: .bold)).foregroundStyle(HK.text).lineLimit(2)
                        Spacer(minLength: 2)
                        statusPill
                    }
                    if let area = supplier.area, !area.isEmpty {
                        Text(area + (supplier.centralBlr == true ? " · central" : ""))
                            .font(.system(size: 12)).foregroundStyle(HK.textDim).lineLimit(1)
                    }
                    if !supplier.rolesLabel.isEmpty {
                        Text(supplier.rolesLabel).font(.system(size: 11.5)).foregroundStyle(HK.textFaint)
                            .lineLimit(2).fixedSize(horizontal: false, vertical: true)
                    }
                }
            }

            // evidence / confidence — honest about whether the number is verified
            HStack(spacing: 8) {
                badge(supplier.hospitalityFocus == true ? "hospitality" : (supplier.type ?? "supplier"),
                      supplier.hospitalityFocus == true ? HK.ready : HK.textDim)
                if let c = supplier.confidence { badge(confidenceLabel(c), confidenceColor(c)) }
                if let sc = supplier.relevanceScore { badge("score \(sc)", HK.textDim) }
                Spacer(minLength: 0)
                if supplier.callCount ?? 0 > 0 {
                    Text("called \(supplier.callCount ?? 0)×").font(.system(size: 10, weight: .semibold)).foregroundStyle(HK.textFaint)
                }
            }

            actionRow
        }
        .padding(13)
        .background(HK.card, in: RoundedRectangle(cornerRadius: HK.radius))
        .overlay(RoundedRectangle(cornerRadius: HK.radius).stroke(HK.line, lineWidth: 1))
        .confirmationDialog("Log the call to \(supplier.name)", isPresented: $logging, titleVisibility: .visible) {
            ForEach(CallOutcome.allCases) { o in
                Button(o.label) { Task { await model.logSupplierCall(id: supplier.id, outcome: o) } }
            }
            Button("Cancel", role: .cancel) {}
        }
    }

    private var actionRow: some View {
        HStack(spacing: 8) {
            if let tel = supplier.telURL {
                Button { openURL(tel) } label: {
                    Label(supplier.phone ?? "Call", systemImage: "phone.fill")
                        .font(.system(size: 13.5, weight: .bold)).foregroundStyle(.black)
                        .frame(maxWidth: .infinity).padding(.vertical, 9)
                        .background(accent, in: RoundedRectangle(cornerRadius: HK.radiusSm))
                }
            } else {
                Text("No number — search this agency").font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(HK.textFaint).frame(maxWidth: .infinity).padding(.vertical, 9)
                    .background(HK.bgElev, in: RoundedRectangle(cornerRadius: HK.radiusSm))
            }
            Button { logging = true } label: {
                Label("Log", systemImage: "checkmark.circle")
                    .font(.system(size: 13.5, weight: .bold)).foregroundStyle(accent)
                    .padding(.horizontal, 14).padding(.vertical, 9)
                    .background(accent.opacity(0.14), in: RoundedRectangle(cornerRadius: HK.radiusSm))
            }
            if let src = supplier.firstSource {
                Button { openURL(src) } label: {
                    Image(systemName: "link").font(.system(size: 13.5, weight: .bold)).foregroundStyle(HK.textDim)
                        .padding(.horizontal, 11).padding(.vertical, 9)
                        .background(HK.bgElev, in: RoundedRectangle(cornerRadius: HK.radiusSm))
                }
            }
        }
    }

    private var gradeBadge: some View {
        let g = supplier.gradeLabel
        let c: Color = g == "A" ? HK.ready : (g == "B" ? HK.running : HK.textDim)
        return Text(g).font(.system(size: 17, weight: .heavy, design: .rounded)).foregroundStyle(c)
            .frame(width: 38, height: 38)
            .background(c.opacity(0.16), in: RoundedRectangle(cornerRadius: HK.radiusSm))
    }

    private var statusPill: some View {
        let c = statusColor(supplier.status)
        return Text(supplier.statusLabel).font(.system(size: 9, weight: .heavy))
            .foregroundStyle(c).padding(.horizontal, 7).padding(.vertical, 3)
            .background(c.opacity(0.16), in: Capsule())
    }

    private func badge(_ t: String, _ c: Color) -> some View {
        Text(t.uppercased()).font(.system(size: 8.5, weight: .heavy)).tracking(0.3)
            .foregroundStyle(c).padding(.horizontal, 6).padding(.vertical, 2)
            .background(c.opacity(0.14), in: Capsule())
    }

    private func statusColor(_ s: String) -> Color {
        switch s {
        case "new": return accent
        case "responded": return HK.ready
        case "sent_jd": return HK.ready
        case "called": return HK.running
        case "not_relevant", "dead": return HK.textFaint
        default: return HK.textDim
        }
    }
    private func confidenceLabel(_ c: String) -> String {
        switch c { case "high": return "verified"; case "med": return "likely"; default: return "unconfirmed" }
    }
    private func confidenceColor(_ c: String) -> Color {
        switch c { case "high": return HK.ready; case "med": return HK.running; default: return HK.error }
    }
}
