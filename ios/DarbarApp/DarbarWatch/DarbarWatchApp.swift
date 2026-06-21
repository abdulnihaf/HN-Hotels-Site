import SwiftUI

// Darbar — Apple Watch glance. A read-only wrist view over the SAME live backend
// (darbar.hnhotels.in): today's present/expected + how many exceptions need handling.
// Auto-auths with the owner PIN (owner's wrist; no PIN entry on the watch). Honest
// loading/error states — never a fake number.

@main
struct DarbarWatchApp: App {
    var body: some Scene { WindowGroup { DarbarWatchView() } }
}

// minimal subset of /api/darbar?action=auth and ?action=home
struct DWAuth: Codable { var token: String? }
struct DWHome: Codable { var stats: DWStats?; var exception_count: Int? }
struct DWStats: Codable { var expected: Int?; var present: Int?; var absent: Int?; var off: Int? }
enum DWErr: Error { case bad }

actor DarbarWatchClient {
    static let shared = DarbarWatchClient()
    private let base = "https://darbar.hnhotels.in"
    private let dec = JSONDecoder()
    private var token: String?

    func glance() async throws -> DWHome {
        let t = try await ensureToken()
        do { return try await home(t) }
        catch { token = nil; return try await home(try await ensureToken()) }   // one re-mint on 401
    }
    private func ensureToken() async throws -> String {
        if let t = token { return t }
        var r = URLRequest(url: URL(string: base + "/api/darbar?action=auth")!)
        r.httpMethod = "POST"; r.timeoutInterval = 12
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        r.httpBody = try JSONSerialization.data(withJSONObject: ["pin": "0305"])
        let (d, _) = try await URLSession.shared.data(for: r)
        guard let tok = (try? dec.decode(DWAuth.self, from: d))?.token, !tok.isEmpty else { throw DWErr.bad }
        token = tok; return tok
    }
    private func home(_ t: String) async throws -> DWHome {
        var r = URLRequest(url: URL(string: base + "/api/darbar?action=home")!)
        r.timeoutInterval = 12
        r.setValue(t, forHTTPHeaderField: "x-darbar-token")
        let (d, resp) = try await URLSession.shared.data(for: r)
        if let h = resp as? HTTPURLResponse, h.statusCode == 401 || h.statusCode == 403 { throw DWErr.bad }
        return try dec.decode(DWHome.self, from: d)
    }
}

@MainActor final class DWModel: ObservableObject {
    @Published var home: DWHome?
    @Published var status = "Loading…"
    func load() async {
        if home == nil { status = "Loading…" }
        do { home = try await DarbarWatchClient.shared.glance(); status = "" }
        catch { status = "Can't reach Darbar" }
    }
}

struct DarbarWatchView: View {
    @StateObject private var m = DWModel()
    private let accent = Color(red: 0x5B/255.0, green: 0x86/255.0, blue: 0xC9/255.0)

    var body: some View {
        ScrollView {
            VStack(spacing: 9) {
                Text("Darbar")
                    .font(.system(size: 17, weight: .heavy, design: .rounded))
                    .foregroundStyle(accent)
                if let s = m.home?.stats {
                    Text("\(s.present ?? 0)/\(s.expected ?? 0)")
                        .font(.system(size: 40, weight: .heavy, design: .rounded))
                    Text("present today").font(.system(size: 12)).foregroundStyle(.secondary)
                    HStack(spacing: 16) {
                        stat("absent", s.absent ?? 0)
                        stat("off", s.off ?? 0)
                    }.padding(.top, 2)
                    if let ex = m.home?.exception_count, ex > 0 {
                        Text("\(ex) to handle")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(.orange)
                            .padding(.top, 4)
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

    private func stat(_ label: String, _ v: Int) -> some View {
        VStack(spacing: 1) {
            Text("\(v)").font(.system(size: 18, weight: .bold, design: .rounded))
            Text(label).font(.system(size: 10)).foregroundStyle(.secondary)
        }
    }
}
