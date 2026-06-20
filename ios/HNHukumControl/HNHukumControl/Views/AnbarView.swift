import SwiftUI

// Anbar — the inventory chamber. Faithful port of anbar.hnhotels.in/ops/anbar (action=live, the
// conservation engine): per item per location, last_count + received + issued − sold − waste = expected.
// Brand-split NCH | HE (the PWA's two doors). Read-only — state only; no record-count wired.
struct AnbarView: View {
    @StateObject private var model = AnbarAppModel()
    private let accent = Color(hex: 0x4FAE6A)

    var body: some View {
        ZStack {
            HK.bg.ignoresSafeArea()
            VStack(spacing: 0) {
                ChamberHeader(title: "Anbar", subtitle: model.statusLine, accent: accent)
                brandBar
                content
            }
        }
        .task { await model.bootstrap() }
        .navigationTitle("Anbar").navigationBarTitleDisplayMode(.inline)
    }

    // MARK: brand scope toggle — the PWA's /nch/ + /he/ doors (capsule tabs; active = accent + black)

    private var brandBar: some View {
        HStack(spacing: 8) {
            ForEach([AnbarBrand.nch, AnbarBrand.he], id: \.self) { b in
                let on = model.brand == b
                Button { model.brand = b } label: {
                    HStack(spacing: 6) {
                        Text(b.chip).font(.system(size: 14, weight: .semibold))
                        Text("\(model.items(for: b).count)")
                            .font(.system(size: 12, weight: .bold))
                            .foregroundStyle(on ? .black.opacity(0.55) : HK.textFaint)
                    }
                    .foregroundStyle(on ? .black : HK.textDim)
                    .padding(.horizontal, 14).padding(.vertical, 8)
                    .background(on ? accent : HK.card, in: Capsule())
                    .overlay(Capsule().stroke(on ? Color.clear : HK.line, lineWidth: 1))
                }
                .buttonStyle(.plain)
            }
            Spacer()
        }
        .padding(.horizontal, 16).padding(.bottom, 10)
    }

    // MARK: content

    @ViewBuilder private var content: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                if let err = model.loadError, model.items.isEmpty {
                    note("Source unreachable — \(err)", icon: "wifi.exclamationmark", warn: true)
                } else if model.items.isEmpty {
                    note("Reading the conservation board…", icon: "hourglass")
                } else {
                    if !model.odooOk {
                        note("Odoo POS feed off — sold counts may lag until it's back.",
                             icon: "exclamationmark.triangle.fill", warn: true)
                    }
                    label("\(model.brand.title.uppercased()) · COUNTER + STORE", "\(model.visibleItems.count)")
                    if model.visibleItems.isEmpty {
                        emptyForBrand
                    } else {
                        ForEach(model.visibleItems) { itemCard($0) }
                    }
                }
            }
            .padding(.horizontal, 16).padding(.bottom, 24)
        }
        .scrollIndicators(.hidden)
        .refreshable { await model.refresh() }
    }

    @ViewBuilder private var emptyForBrand: some View {
        if model.brand == .he {
            note("No Hamza items on the live conservation board yet — HE inventory (chicken) is received through Sauda, not counted here.", icon: "tray")
        } else {
            note("No items on the board for \(model.brand.title).", icon: "tray")
        }
    }

    // MARK: one item → its counter / store location rows

    private func itemCard(_ it: AnbarLiveItem) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Text(it.displayName).font(.system(size: 16, weight: .semibold)).foregroundStyle(HK.text)
                brandChip(it.brand.chip)
                if it.madeInHouse == true { tag("MADE IN-HOUSE") }
                Spacer()
                if let u = it.uom { Text(u).font(.system(size: 11, weight: .medium)).foregroundStyle(HK.textFaint) }
            }
            if let c = it.counter {
                locationRow("COUNTER", uom: it.uom, expected: c.expected, lastCount: c.lastCount,
                            meta: counterMeta(c), state: state(c.lastCount, c.expected),
                            odooOff: c.odooOk == false, note: nil)
            }
            if let s = it.store {
                locationRow("STORE", uom: it.uom, expected: s.expected, lastCount: s.lastCount,
                            meta: storeMeta(s), state: state(s.lastCount, s.expected),
                            odooOff: false, note: s.note)
            }
        }
        .padding(14)
        .background(HK.card, in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(HK.line, lineWidth: 1))
        .overlay(Rectangle().fill(it.needsRecount ? HK.running : accent).frame(width: 3)
            .clipShape(RoundedRectangle(cornerRadius: 2)), alignment: .leading)
    }

    private func locationRow(_ loc: String, uom: String?, expected: Double?, lastCount: Double?,
                             meta: String, state: String, odooOff: Bool, note: String?) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(loc).font(.system(size: 10, weight: .heavy)).foregroundStyle(HK.textFaint).tracking(0.5)
                stateChip(state)
                Spacer()
                if lastCount == nil {
                    Text("— not counted").font(.system(size: 13, weight: .semibold)).foregroundStyle(HK.textFaint)
                } else {
                    (Text(AnbarFmt.num(expected)).font(.system(size: 22, weight: .heavy, design: .rounded))
                        + Text(" \(uom ?? "")").font(.system(size: 12, weight: .medium)))
                        .foregroundStyle(((expected ?? 0) < 0) ? HK.error : HK.text)
                }
            }
            Text((lastCount == nil ? (note ?? meta) : meta))
                .font(.system(size: 12.5)).foregroundStyle(HK.textDim)
                .fixedSize(horizontal: false, vertical: true)
            if odooOff {
                Text("⚠ POS feed off — sold may lag")
                    .font(.system(size: 11.5, weight: .medium)).foregroundStyle(HK.running)
            }
        }
        .padding(.vertical, 8).padding(.horizontal, 11)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(HK.bgElev, in: RoundedRectangle(cornerRadius: 12))
    }

    // MARK: conservation meta — the real PWA's breakdown line

    private func counterMeta(_ c: AnbarCounter) -> String {
        guard c.lastCount != nil else { return "no baseline yet" }
        var p = ["counted \(AnbarFmt.num(c.lastCount)) \(AnbarFmt.ago(c.countedAt))"]
        if (c.received ?? 0) != 0 { p.append("+\(AnbarFmt.num(c.received)) recv") }
        if (c.issuedIn ?? 0) != 0 { p.append("+\(AnbarFmt.num(c.issuedIn)) in") }
        if (c.sold ?? 0) != 0 { p.append("−\(AnbarFmt.num(c.sold)) sold") }
        if (c.waste ?? 0) != 0 { p.append("−\(AnbarFmt.num(c.waste)) waste") }
        return p.joined(separator: " · ")
    }

    private func storeMeta(_ s: AnbarStore) -> String {
        guard s.lastCount != nil else { return s.note ?? "store baseline not counted yet" }
        var p = ["counted \(AnbarFmt.num(s.lastCount)) \(AnbarFmt.ago(s.countedAt))"]
        if (s.received ?? 0) != 0 { p.append("+\(AnbarFmt.num(s.received)) recv") }
        if (s.issuedOut ?? 0) != 0 { p.append("−\(AnbarFmt.num(s.issuedOut)) out") }
        return p.joined(separator: " · ")
    }

    private func state(_ lastCount: Double?, _ expected: Double?) -> String {
        if lastCount == nil { return "uncounted" }
        if (expected ?? 0) < 0 { return "recount" }
        return "ok"
    }

    // MARK: chrome — composed to match the shared kit (Sauda/engineBar) so chambers feel seamless

    private func label(_ t: String, _ trailing: String?) -> some View {
        HStack {
            Text(t).font(.system(size: 11, weight: .heavy)).foregroundStyle(HK.textFaint).tracking(0.6)
            Spacer()
            if let trailing, !trailing.isEmpty {
                Text(trailing).font(.system(size: 11, weight: .bold)).foregroundStyle(HK.textDim)
            }
        }.padding(.horizontal, 4).padding(.top, 4)
    }

    private func note(_ msg: String, icon: String, warn: Bool = false) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon).font(.system(size: 18)).foregroundStyle(warn ? HK.running : accent)
            Text(msg).font(.system(size: 13.5)).foregroundStyle(HK.textDim)
            Spacer()
        }
        .padding(15).frame(maxWidth: .infinity, alignment: .leading)
        .background(HK.card, in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(warn ? HK.running.opacity(0.4) : HK.line, lineWidth: 1))
    }

    private func brandChip(_ b: String) -> some View {
        Text(b).font(.system(size: 9, weight: .heavy)).foregroundStyle(accent)
            .padding(.horizontal, 7).padding(.vertical, 3)
            .background(accent.opacity(0.16), in: Capsule())
    }

    private func tag(_ s: String) -> some View {
        Text(s).font(.system(size: 9, weight: .heavy)).foregroundStyle(HK.textDim)
            .padding(.horizontal, 7).padding(.vertical, 3)
            .background(HK.bgElev, in: Capsule())
    }

    private func stateChip(_ s: String) -> some View {
        let txt = s == "recount" ? "RECOUNT DUE" : (s == "uncounted" ? "COUNT DUE" : "OK")
        return Text(txt).font(.system(size: 9, weight: .heavy)).foregroundStyle(anbarStateColor(s))
            .padding(.horizontal, 7).padding(.vertical, 3)
            .background(anbarStateColor(s).opacity(0.16), in: Capsule())
    }
}

// Display formatting — honest numbers + count staleness. Date() is the app runtime clock.
enum AnbarFmt {
    static func num(_ v: Double?) -> String {
        guard let v else { return "—" }
        if v == v.rounded() { return String(Int(v)) }
        return String(format: "%.1f", v)
    }
    static func ago(_ iso: String?) -> String {
        guard let iso, let d = parse(iso) else { return "" }
        let now = Date()
        let days = Calendar.current.dateComponents([.day], from: d, to: now).day ?? 0
        if days <= 0 {
            let hrs = Calendar.current.dateComponents([.hour], from: d, to: now).hour ?? 0
            return hrs <= 0 ? "just now" : "\(hrs)h ago"
        }
        return days == 1 ? "1d ago" : "\(days)d ago"
    }
    private static func parse(_ iso: String) -> Date? {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f.date(from: iso) { return d }
        f.formatOptions = [.withInternetDateTime]
        return f.date(from: iso)
    }
}
