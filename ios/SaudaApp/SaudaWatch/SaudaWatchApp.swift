import SwiftUI

// Sauda — Apple Watch app. The wrist surface for the day's paying: glance at the to-pay total,
// drill the vendor list, see what's owed per vendor, and one-tap Mark Paid (owner-confirm on the
// wrist) once you've paid. Read over the SAME live backend (sauda.hnhotels.in); auto-auths with
// the owner PIN. Honest loading/empty/error — never a fake number.

@main
struct SaudaWatchApp: App {
    var body: some Scene { WindowGroup { SaudaRoot() } }
}

// qty arrives as String ("3", ".5") OR number — accept both
struct SWQty: Codable, Hashable {
    let text: String
    init(from d: Decoder) throws {
        let c = try d.singleValueContainer()
        if let s = try? c.decode(String.self) { text = s }
        else if let i = try? c.decode(Int.self) { text = String(i) }
        else if let n = try? c.decode(Double.self) { text = n.truncatingRemainder(dividingBy: 1) == 0 ? String(Int(n)) : String(n) }
        else { text = "" }
    }
    var double: Double { Double(text.trimmingCharacters(in: .whitespaces)) ?? 0 }
}
struct SWAuth: Codable { var token: String? }
struct SWOpen: Codable { var orders: [SWOrder]? }
struct SWOrder: Codable, Identifiable, Hashable {
    var ids: [Int]?; var vendor_name: String?; var brand: String?
    var pay_amount_paise: Int?; var items_json: String?; var payRail: String?
    var id: String { (ids?.map(String.init).joined(separator: "-") ?? vendor_name ?? "") }
    var rupees: Int { (pay_amount_paise ?? 0) / 100 }
    var lines: [SWLine] {
        guard let j = items_json, let d = j.data(using: .utf8) else { return [] }
        return (try? JSONDecoder().decode([SWLine].self, from: d)) ?? []
    }
}
struct SWLine: Codable, Hashable { var item: String?; var qty: SWQty?; var unit: String?; var price_paise: Int? }
enum SWErr: Error { case bad }

actor SaudaWatchClient {
    static let shared = SaudaWatchClient()
    private let base = "https://sauda.hnhotels.in/api/sauda"
    private let dec = JSONDecoder()
    private var token: String?
    private var dateOverride: String? = ProcessInfo.processInfo.environment["SAUDA_WATCH_DATE"]  // verification only

    func open() async throws -> SWOpen {
        let t = try await ensureToken()
        do { return try await get(openPath(), t) }
        catch { token = nil; return try await get(openPath(), try await ensureToken()) }
    }
    func markPaid(ids: [Int], amountPaise: Int) async throws {
        let t = try await ensureToken()
        var r = URLRequest(url: URL(string: base + "?action=mark-paid")!); r.httpMethod = "POST"; r.timeoutInterval = 12
        r.setValue("application/json", forHTTPHeaderField: "Content-Type"); r.setValue(t, forHTTPHeaderField: "x-darbar-token")
        r.httpBody = try JSONSerialization.data(withJSONObject: ["ids": ids, "amount_paise": amountPaise, "method": "upi"])
        let (_, resp) = try await URLSession.shared.data(for: r)
        if let h = resp as? HTTPURLResponse, !(200..<300).contains(h.statusCode) { throw SWErr.bad }
    }
    private func openPath() -> String { dateOverride.map { "?action=open&for_date=\($0)" } ?? "?action=open" }
    private func ensureToken() async throws -> String {
        if let t = token { return t }
        var r = URLRequest(url: URL(string: base + "?action=auth")!); r.httpMethod = "POST"; r.timeoutInterval = 12
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        r.httpBody = try JSONSerialization.data(withJSONObject: ["pin": "0305"])
        let (d, _) = try await URLSession.shared.data(for: r)
        guard let tok = (try? dec.decode(SWAuth.self, from: d))?.token, !tok.isEmpty else { throw SWErr.bad }
        token = tok; return tok
    }
    private func get<T: Decodable>(_ q: String, _ t: String) async throws -> T {
        var r = URLRequest(url: URL(string: base + q)!); r.timeoutInterval = 12
        r.setValue(t, forHTTPHeaderField: "x-darbar-token")
        let (d, resp) = try await URLSession.shared.data(for: r)
        if let h = resp as? HTTPURLResponse, h.statusCode == 401 || h.statusCode == 403 { throw SWErr.bad }
        return try dec.decode(T.self, from: d)
    }
}

@MainActor final class SWModel: ObservableObject {
    @Published var orders: [SWOrder]?
    @Published var status = "Loading…"
    var total: Int { (orders ?? []).reduce(0) { $0 + $1.rupees } }
    var count: Int { (orders ?? []).count }
    func load() async {
        if orders == nil { status = "Loading…" }
        do { orders = (try await SaudaWatchClient.shared.open()).orders ?? []; status = "" }
        catch { status = "Can't reach Sauda" }
    }
    func pay(_ o: SWOrder) async {
        do { try await SaudaWatchClient.shared.markPaid(ids: o.ids ?? [], amountPaise: o.pay_amount_paise ?? 0); await load() }
        catch { status = "Mark-paid failed" }
    }
}

let SACCENT = Color(red: 0xD4/255.0, green: 0xA2/255.0, blue: 0x4C/255.0)
func srupee(_ n: Int) -> String { let f = NumberFormatter(); f.numberStyle = .decimal; f.maximumFractionDigits = 0; return "₹" + (f.string(from: NSNumber(value: n)) ?? "0") }

struct SaudaRoot: View {
    @StateObject private var m = SWModel()
    var body: some View {
        NavigationStack {
            if ProcessInfo.processInfo.environment["SAUDA_WATCH_VIEW"] == "list" {
                ToPayList(m: m).task { await m.load() }
            } else {
                TabView {
                    ToPayGlance(m: m)
                    OrdersGlance(m: m)
                }.tabViewStyle(.page).task { await m.load() }
            }
        }
    }
}

struct ToPayGlance: View {
    @ObservedObject var m: SWModel
    var body: some View {
        ScrollView {
            VStack(spacing: 8) {
                Text("Sauda").font(.system(size: 16, weight: .heavy, design: .rounded)).foregroundStyle(SACCENT)
                if m.orders != nil {
                    if m.count == 0 {
                        Text("nothing to pay").font(.system(size: 15, weight: .semibold)).foregroundStyle(.secondary).padding(.top, 14)
                        Text("today").font(.system(size: 11)).foregroundStyle(.secondary)
                    } else {
                        Text(srupee(m.total)).font(.system(size: 34, weight: .heavy, design: .rounded)).minimumScaleFactor(0.5).lineLimit(1)
                        Text("to pay today").font(.system(size: 11)).foregroundStyle(.secondary)
                        NavigationLink { ToPayList(m: m) } label: {
                            Text("\(m.count) vendor\(m.count == 1 ? "" : "s") ›").font(.system(size: 14, weight: .bold))
                        }.foregroundStyle(SACCENT).padding(.top, 4)
                    }
                } else { Text(m.status).font(.system(size: 13)).foregroundStyle(.secondary).padding(.top, 18) }
                Button { Task { await m.load() } } label: { Label("Refresh", systemImage: "arrow.clockwise") }
                    .font(.system(size: 11)).tint(SACCENT).padding(.top, 4)
            }.padding(.vertical, 6).frame(maxWidth: .infinity)
        }
    }
}

struct OrdersGlance: View {
    @ObservedObject var m: SWModel
    var body: some View {
        VStack(spacing: 6) {
            Text("Today's orders").font(.system(size: 14, weight: .heavy)).foregroundStyle(SACCENT)
            if let o = m.orders {
                Text("\(o.count)").font(.system(size: 34, weight: .heavy, design: .rounded))
                Text("vendor orders").font(.system(size: 11)).foregroundStyle(.secondary)
                let items = o.reduce(0) { $0 + $1.lines.count }
                Text("\(items) line\(items == 1 ? "" : "s")").font(.system(size: 13)).foregroundStyle(.secondary)
            } else { Text(m.status).font(.system(size: 12)).foregroundStyle(.secondary) }
        }.padding()
    }
}

struct ToPayList: View {
    @ObservedObject var m: SWModel
    var body: some View {
        Group {
            if let o = m.orders, !o.isEmpty {
                List(o) { order in
                    NavigationLink { VendorDetail(m: m, order: order) } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 1) {
                                Text(order.vendor_name ?? "—").font(.system(size: 14, weight: .semibold)).lineLimit(1)
                                Text("\(order.lines.count) item\(order.lines.count == 1 ? "" : "s")").font(.system(size: 10)).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Text(srupee(order.rupees)).font(.system(size: 14, weight: .bold, design: .rounded)).foregroundStyle(SACCENT)
                        }
                    }
                }
            } else if m.orders != nil {
                VStack(spacing: 8) { Image(systemName: "checkmark.seal.fill").font(.system(size: 30)).foregroundStyle(.green); Text("Nothing to pay today").font(.system(size: 14, weight: .semibold)) }
            } else { Text(m.status).font(.system(size: 13)).foregroundStyle(.secondary) }
        }
        .navigationTitle("To pay")
    }
}

struct VendorDetail: View {
    @ObservedObject var m: SWModel
    let order: SWOrder
    @State private var showConfirm = false
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                HStack { Text(order.vendor_name ?? "—").font(.system(size: 15, weight: .bold)).lineLimit(1); Spacer(); Text(srupee(order.rupees)).font(.system(size: 15, weight: .heavy, design: .rounded)).foregroundStyle(SACCENT) }
                ForEach(Array(order.lines.enumerated()), id: \.offset) { _, ln in
                    HStack {
                        Text(ln.item ?? "—").font(.system(size: 12)).foregroundStyle(.secondary).lineLimit(1)
                        Spacer()
                        Text("\(ln.qty?.text ?? "")\(ln.unit.map { " " + $0 } ?? "")").font(.system(size: 11)).foregroundStyle(.secondary)
                    }
                }
                Button("Mark Paid") { showConfirm = true }
                    .tint(SACCENT).font(.system(size: 14, weight: .semibold)).padding(.top, 6)
                Text(order.payRail == "upi" ? "you pay by UPI, then confirm" : "pay manually, then confirm")
                    .font(.system(size: 10)).foregroundStyle(.secondary)
            }.padding(10)
        }
        .navigationTitle("Vendor")
        .confirmationDialog("Mark \(srupee(order.rupees)) paid to \(order.vendor_name ?? "")?", isPresented: $showConfirm, titleVisibility: .visible) {
            Button("Confirm paid", role: .destructive) { Task { await m.pay(order) } }
            Button("Cancel", role: .cancel) {}
        }
    }
}
