import SwiftUI

// Sauda — the day's buying. Faithful to the real PWA (sauda.hnhotels.in): dark-luxe pure-black
// "court", gold + terracotta, the real tab structure. The read tabs (Order · Vendors · To pay)
// render the live board; the action tabs (Place · Buy/Paste · Compare) are shown honestly as the
// flows still to wire (writes are owner-approve; the decode + place + compare engines come next).
struct SaudaBoardView: View {
    @StateObject private var model = SaudaAppModel()
    @State private var tab: SaudaTab = SaudaTab.initial

    static let gold = Color(hex: 0xD4A24C)
    static let terra = Color(hex: 0xB9772E)
    static let green = Color(hex: 0x37D399)
    static let amber = Color(hex: 0xE0A13C)
    static let card = Color(hex: 0x13131A)
    static let card2 = Color(hex: 0x1B1B24)
    static let line = Color.white.opacity(0.07)
    static let dim = Color.white.opacity(0.60)
    static let faint = Color.white.opacity(0.34)

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            VStack(spacing: 0) {
                header
                tabBar
                content
            }
        }
        .task { await model.bootstrap() }
        .navigationTitle("").navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Color.black, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
    }

    // MARK: header — radial-gold court splash

    private var header: some View {
        HStack(alignment: .center) {
            VStack(alignment: .leading, spacing: 3) {
                Text("Sauda")
                    .font(.system(size: 30, weight: .heavy, design: .serif))
                    .foregroundStyle(Self.gold)
                Text(model.statusLine)
                    .font(.system(size: 12.5, weight: .medium))
                    .foregroundStyle(Self.dim)
            }
            Spacer()
            ZStack {
                Circle().fill(Self.terra.opacity(0.18)).frame(width: 46, height: 46)
                Image(systemName: "cart.fill").font(.system(size: 20, weight: .semibold)).foregroundStyle(Self.terra)
            }
        }
        .padding(.horizontal, 18).padding(.top, 6).padding(.bottom, 12)
    }

    // MARK: tab bar — the real Sauda tabs

    private var tabBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(SaudaTab.allCases, id: \.self) { t in
                    let on = tab == t
                    Button { tab = t } label: {
                        Text(t.label)
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(on ? .black : Self.dim)
                            .padding(.horizontal, 14).padding(.vertical, 8)
                            .background(on ? Self.gold : Self.card, in: Capsule())
                            .overlay(Capsule().stroke(on ? Color.clear : Self.line, lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 16)
        }
        .padding(.bottom, 10)
    }

    @ViewBuilder private var content: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                switch tab {
                case .order:   orderTab
                case .place:   placeTab
                case .buy:     buyTab
                case .pay:     payTab
                case .vendors: vendorsTab
                case .compare: compareTab
                }
            }
            .padding(.horizontal, 16).padding(.bottom, 24)
        }
        .scrollIndicators(.hidden)
        .refreshable { await model.refresh() }
    }

    // MARK: Order (live read) — today's placed lines, grouped by vendor

    @ViewBuilder private var orderTab: some View {
        label("THE DAY'S ORDER", model.date)
        if model.lines.isEmpty {
            note("Blank every morning — nothing placed yet for \(model.date)." +
                 (model.placed.isEmpty ? "" : " Last order placed \(model.placed)."), icon: "sunrise")
        } else {
            let groups = Dictionary(grouping: model.lines, by: { $0.vendor ?? "—" })
            ForEach(groups.keys.sorted(), id: \.self) { v in
                vendorBasket(v, lines: groups[v] ?? [])
            }
            HStack {
                Text("Bill basis").font(.system(size: 13, weight: .semibold)).foregroundStyle(Self.dim)
                Spacer()
                Text("₹\(Int(model.lineTotalRupees.rounded()))")
                    .font(.system(size: 17, weight: .heavy, design: .rounded)).foregroundStyle(Self.gold)
            }.padding(.horizontal, 4).padding(.top, 4)
        }
    }

    private func vendorBasket(_ vendor: String, lines: [SaudaLine]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(vendor).font(.system(size: 15, weight: .bold)).foregroundStyle(.white)
                if let b = lines.first?.brand, !b.isEmpty { brandChip(b) }
                Spacer()
            }
            ForEach(lines) { l in
                HStack(alignment: .firstTextBaseline) {
                    Text(l.item ?? "—").font(.system(size: 14)).foregroundStyle(.white.opacity(0.9))
                    Spacer()
                    Text(l.qtyDisplay).font(.system(size: 12.5, weight: .medium)).foregroundStyle(Self.dim)
                    if l.hasAmount {
                        Text("₹\(Int(l.rupees.rounded()))").font(.system(size: 14, weight: .bold, design: .rounded)).foregroundStyle(.white)
                    }
                }
            }
        }
        .padding(14)
        .background(Self.card, in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Self.line, lineWidth: 1))
        .overlay(Rectangle().fill(Self.terra).frame(width: 3).clipShape(RoundedRectangle(cornerRadius: 2)), alignment: .leading)
    }

    // MARK: Vendors (live read) — the registry master

    @ViewBuilder private var vendorsTab: some View {
        label("VENDOR MASTER", "\(model.vendors.count)")
        if model.vendors.isEmpty { note("No vendors loaded.", icon: "person.2") }
        ForEach(model.vendors) { v in
            VStack(alignment: .leading, spacing: 7) {
                HStack {
                    Text(v.name).font(.system(size: 15, weight: .semibold)).foregroundStyle(.white)
                    Spacer()
                    if let b = v.brand, !b.isEmpty { brandChip(b) }
                    if let ch = v.channel, !ch.isEmpty { tag(ch.uppercased()) }
                }
                if let m = v.materials, !m.isEmpty {
                    Text(m).font(.system(size: 12.5)).foregroundStyle(Self.dim).lineLimit(1)
                }
                if let u = v.vpa, !u.isEmpty {
                    HStack(spacing: 5) {
                        Image(systemName: "indianrupeesign.circle").font(.system(size: 11)).foregroundStyle(Self.faint)
                        Text(u).font(.system(size: 11.5, design: .monospaced)).foregroundStyle(Self.faint).lineLimit(1)
                    }
                }
            }
            .padding(14).frame(maxWidth: .infinity, alignment: .leading)
            .background(Self.card, in: RoundedRectangle(cornerRadius: 16))
            .overlay(RoundedRectangle(cornerRadius: 16).stroke(Self.line, lineWidth: 1))
        }
    }

    // MARK: To pay (live read) — the money witness queue

    @ViewBuilder private var payTab: some View {
        label("TO PAY", "\(model.pendingRequests.count)")
        if model.pendingRequests.isEmpty {
            note("Nothing pending payment.", icon: "checkmark.seal")
        } else {
            ForEach(model.pendingRequests) { r in
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(r.vendor ?? "—").font(.system(size: 15, weight: .semibold)).foregroundStyle(.white)
                        if let v = r.vpa, !v.isEmpty { Text(v).font(.system(size: 11, design: .monospaced)).foregroundStyle(Self.faint).lineLimit(1) }
                    }
                    Spacer()
                    Text("₹\(Int(r.rupees.rounded()))").font(.system(size: 17, weight: .heavy, design: .rounded)).foregroundStyle(.white)
                }
                .padding(14).background(Self.card, in: RoundedRectangle(cornerRadius: 16))
                .overlay(RoundedRectangle(cornerRadius: 16).stroke(Self.line, lineWidth: 1))
            }
            ownerActionNote("Mark-paid is the money witness — owner-approve. Wiring next, behind your tap.")
        }
    }

    // MARK: Place — honest structure (writes are owner-approve, fires WhatsApp)

    @ViewBuilder private var placeTab: some View {
        label("PLACE THE ORDER", nil)
        note("Build the day's order — add items to each vendor's basket, then Place writes one order per vendor and WhatsApps Basheer (go & buy) or Zoya (order it in).", icon: "paperplane")
        ownerActionNote("Place fires real WhatsApp orders — owner-approve. The vendor baskets + brand toggle + search are the next build on this secured tab.")
        label("YOUR VENDORS TO BUILD FROM", "\(model.vendors.count)")
        ForEach(model.vendors.prefix(6)) { v in
            HStack {
                Text(v.name).font(.system(size: 14, weight: .medium)).foregroundStyle(.white.opacity(0.85))
                Spacer()
                if let b = v.brand, !b.isEmpty { brandChip(b) }
                if let ch = v.channel, !ch.isEmpty { tag(ch.uppercased()) }
            }
            .padding(.horizontal, 14).padding(.vertical, 11)
            .background(Self.card, in: RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(Self.line, lineWidth: 1))
        }
    }

    // MARK: Buy list / Paste — honest

    @ViewBuilder private var buyTab: some View {
        label("BUY LIST", nil)
        note("Need-first: add what to buy for today or tomorrow; the engine routes each line to its cheapest workable source.", icon: "list.bullet")
        // the primary input — paste a WhatsApp order
        HStack(spacing: 12) {
            Image(systemName: "doc.on.clipboard.fill").font(.system(size: 18, weight: .semibold)).foregroundStyle(.black)
            VStack(alignment: .leading, spacing: 2) {
                Text("Paste a WhatsApp order").font(.system(size: 15, weight: .bold)).foregroundStyle(.black)
                Text("Pick the brand, paste the staff dump — it's decoded into a clean PO").font(.system(size: 11.5, weight: .medium)).foregroundStyle(.black.opacity(0.7))
            }
            Spacer()
        }
        .padding(14).frame(maxWidth: .infinity, alignment: .leading)
        .background(Self.terra, in: RoundedRectangle(cornerRadius: 16))
        ownerActionNote("The decode (Claude → structured PO) + the requisition send are the next wire on this tab.")
    }

    // MARK: Compare — honest

    @ViewBuilder private var compareTab: some View {
        label("COMPARE PRICES", nil)
        note("Cheapest across platforms — your usual price vs Hyperpure, Zepto, Blinkit, Instamart, BigBasket, JioMart, Amazon, per item.", icon: "scalemass")
        ownerActionNote("The nightly price-scrape feed + the per-item compare grid are the next build on this tab.")
    }

    // MARK: chrome

    private func label(_ t: String, _ trailing: String?) -> some View {
        HStack {
            Text(t).font(.system(size: 11, weight: .heavy)).foregroundStyle(Self.faint).tracking(0.6)
            Spacer()
            if let trailing, !trailing.isEmpty { Text(trailing).font(.system(size: 11, weight: .bold)).foregroundStyle(Self.dim) }
        }.padding(.horizontal, 4).padding(.top, 4)
    }
    private func note(_ msg: String, icon: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon).font(.system(size: 18)).foregroundStyle(Self.gold)
            Text(msg).font(.system(size: 13.5)).foregroundStyle(Self.dim)
            Spacer()
        }
        .padding(15).frame(maxWidth: .infinity, alignment: .leading)
        .background(Self.card, in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Self.line, lineWidth: 1))
    }
    private func ownerActionNote(_ msg: String) -> some View {
        HStack(spacing: 9) {
            Image(systemName: "hand.raised.fill").font(.system(size: 12)).foregroundStyle(Self.amber)
            Text(msg).font(.system(size: 11.5, weight: .medium)).foregroundStyle(Self.amber)
            Spacer()
        }
        .padding(.horizontal, 12).padding(.vertical, 9)
        .background(Self.amber.opacity(0.10), in: RoundedRectangle(cornerRadius: 12))
    }
    private func brandChip(_ b: String) -> some View {
        Text(b.uppercased()).font(.system(size: 9, weight: .heavy)).foregroundStyle(Self.terra)
            .padding(.horizontal, 7).padding(.vertical, 3).background(Self.terra.opacity(0.16), in: Capsule())
    }
    private func tag(_ s: String) -> some View {
        Text(s).font(.system(size: 9, weight: .heavy)).foregroundStyle(Self.dim)
            .padding(.horizontal, 7).padding(.vertical, 3).background(Self.card2, in: Capsule())
    }
}

enum SaudaTab: CaseIterable {
    case order, place, buy, pay, vendors, compare
    // verification hook: SAUDA_TAB=vendors|pay|… picks the starting tab on the sim
    static var initial: SaudaTab {
        switch ProcessInfo.processInfo.environment["SAUDA_TAB"] {
        case "vendors": return .vendors; case "pay": return .pay; case "place": return .place
        case "buy": return .buy; case "compare": return .compare; default: return .order
        }
    }
    var label: String {
        switch self {
        case .order: return "Order"; case .place: return "Place"; case .buy: return "Buy list"
        case .pay: return "To pay"; case .vendors: return "Vendors"; case .compare: return "Compare"
        }
    }
}
