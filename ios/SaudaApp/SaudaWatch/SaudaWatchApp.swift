import SwiftUI

// Sauda — Apple Watch glance. A read-only wrist view over the SAME live backend
// (sauda.hnhotels.in): today's to-pay queue — how much, to how many vendors. Auto-auths
// with the owner PIN (owner's wrist; no PIN entry on the watch). Honest loading/empty/error.

@main
struct SaudaWatchApp: App {
    var body: some Scene { WindowGroup { SaudaWatchView() } }
}

struct SWAuth: Codable { var token: String? }
struct SWOpen: Codable { var orders: [SWOrder]? }
struct SWOrder: Codable { var pay_amount_paise: Int?; var vendor_name: String? }
enum SWErr: Error { case bad }

actor SaudaWatchClient {
    static let shared = SaudaWatchClient()
    private let base = "https://sauda.hnhotels.in/api/sauda"
    private let dec = JSONDecoder()
    private var token: String?

    func toPay() async throws -> SWOpen {
        let t = try await ensureToken()
        do { return try await open(t) }
        catch { token = nil; return try await open(try await ensureToken()) }   // one re-mint on 401
    }
    private func ensureToken() async throws -> String {
        if let t = token { return t }
        var r = URLRequest(url: URL(string: base + "?action=auth")!)
        r.httpMethod = "POST"; r.timeoutInterval = 12
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        r.httpBody = try JSONSerialization.data(withJSONObject: ["pin": "0305"])
        let (d, _) = try await URLSession.shared.data(for: r)
        guard let tok = (try? dec.decode(SWAuth.self, from: d))?.token, !tok.isEmpty else { throw SWErr.bad }
        token = tok; return tok
    }
    private func open(_ t: String) async throws -> SWOpen {
        var r = URLRequest(url: URL(string: base + "?action=open")!)
        r.timeoutInterval = 12
        r.setValue(t, forHTTPHeaderField: "x-darbar-token")
        let (d, resp) = try await URLSession.shared.data(for: r)
        if let h = resp as? HTTPURLResponse, h.statusCode == 401 || h.statusCode == 403 { throw SWErr.bad }
        return try dec.decode(SWOpen.self, from: d)
    }
}

@MainActor final class SWModel: ObservableObject {
    @Published var orders: [SWOrder]?
    @Published var status = "Loading…"
    var totalRupees: Int { (orders ?? []).reduce(0) { $0 + (($1.pay_amount_paise ?? 0)) } / 100 }
    var count: Int { (orders ?? []).count }
    func load() async {
        if orders == nil { status = "Loading…" }
        do { orders = (try await SaudaWatchClient.shared.toPay()).orders ?? []; status = "" }
        catch { status = "Can't reach Sauda" }
    }
}

struct SaudaWatchView: View {
    @StateObject private var m = SWModel()
    private let accent = Color(red: 0xD4/255.0, green: 0xA2/255.0, blue: 0x4C/255.0)

    private func fmt(_ n: Int) -> String {
        let f = NumberFormatter(); f.numberStyle = .decimal; f.maximumFractionDigits = 0
        return "₹" + (f.string(from: NSNumber(value: n)) ?? "0")
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 9) {
                Text("Sauda")
                    .font(.system(size: 17, weight: .heavy, design: .rounded))
                    .foregroundStyle(accent)
                if m.orders != nil {
                    if m.count == 0 {
                        Text("nothing to pay")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(.secondary).padding(.top, 16)
                        Text("today").font(.system(size: 12)).foregroundStyle(.secondary)
                    } else {
                        Text(fmt(m.totalRupees))
                            .font(.system(size: 34, weight: .heavy, design: .rounded))
                            .minimumScaleFactor(0.5).lineLimit(1)
                        Text("to pay today").font(.system(size: 12)).foregroundStyle(.secondary)
                        Text("\(m.count) vendor\(m.count == 1 ? "" : "s")")
                            .font(.system(size: 15, weight: .bold)).foregroundStyle(accent).padding(.top, 2)
                    }
                } else {
                    Text(m.status).font(.system(size: 14)).foregroundStyle(.secondary).padding(.top, 22)
                }
                Button { Task { await m.load() } } label: {
                    Label("Refresh", systemImage: "arrow.clockwise")
                }
                .font(.system(size: 12, weight: .semibold)).tint(accent).padding(.top, 6)
            }
            .padding(.vertical, 6)
            .frame(maxWidth: .infinity)
        }
        .task { await m.load() }
    }
}
