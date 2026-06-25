import Foundation
import SwiftUI

// Reads the live Hukum bridge over Tailscale and composes the board. READ-ONLY — it never
// mutates a lane, job, or approval; it only reflects state the bridge already holds.
@MainActor
final class BoardModel: ObservableObject {
    @Published var board: BoardState?
    @Published var statusLine: String = "Connecting to Hukum…"
    @Published var reachable = true

    // The five chambers of the chain, in order: Sauda → Anbar → Takht → Nazar → Darbar.
    private let chainSpec: [(name: String, keys: [String])] = [
        ("Sauda",  ["sauda"]),
        ("Anbar",  ["anbar", "ambar"]),
        ("Takht",  ["takht"]),
        ("Nazar",  ["nazar"]),
        ("Darbar", ["darbar"]),
    ]
    private let active = Set(["queued", "waiting", "running"])

    func bootstrap() async { await refresh() }

    func refresh() async {
        await Net.resolve()
        do {
            async let lanesT: LanesResponse = Net.get("/api/lanes")
            async let jobsT: JobsResponse   = Net.get("/api/jobs?limit=30")
            let approvals = await loadApprovals()
            let lanes = try await lanesT
            let jobs  = try await jobsT

            let laneList = lanes.lanes ?? []
            let jobList  = jobs.jobs ?? []

            var st = BoardState()
            st.laneCount = laneList.count
            st.needsYou  = approvals
            st.inFlight  = jobList.filter { active.contains(($0.status ?? "").lowercased()) }
            st.doneToday = jobList.filter { ($0.status ?? "") == "done" && isToday($0.finished_at ?? $0.created_at) }
                                  .sorted { ($0.finished_at ?? 0) > ($1.finished_at ?? 0) }

            let activeAlias = (lanes.active ?? "").lowercased()
            st.chain = chainSpec.map { spec in
                let lane = laneList.first { l in
                    let hay = [(l.workflow ?? ""), (l.alias ?? ""), (l.title ?? "")].map { $0.lowercased() }
                    return spec.keys.contains { k in hay.contains { $0.contains(k) } }
                }
                let working = st.inFlight.contains { j in
                    let t = (Fmt.jobTitle(j)).lowercased()
                    return spec.keys.contains { t.contains($0) }
                }
                let isActive = spec.keys.contains { activeAlias.contains($0) }
                return ChamberHealth(
                    name: spec.name,
                    engine: lane?.app,
                    present: lane != nil,
                    active: isActive,
                    working: working)
            }
            st.updated = Date()
            self.board = st
            self.reachable = true
            self.statusLine = "\(st.needsYou.count) need you · \(st.inFlight.count) in flight · \(laneList.count) lanes"
        } catch {
            self.reachable = false
            self.statusLine = "Hukum bridge unreachable — is Tailscale on?"
        }
    }

    private func loadApprovals() async -> [Approval] {
        if let r: ApprovalsResponse = try? await Net.get("/api/approvals"), let a = r.approvals { return a }
        if let a: [Approval] = try? await Net.get("/api/approvals") { return a }
        return []
    }

    private func isToday(_ epoch: Double?) -> Bool {
        guard let e = epoch, e > 0 else { return false }
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "Asia/Kolkata") ?? .current
        return cal.isDateInToday(Date(timeIntervalSince1970: e))
    }
}

// Tiny networking layer — token + candidate base URLs baked at build time (Config.swift).
// It probes once to pick the reachable base: 127.0.0.1 when running on the Mac/simulator,
// the Tailscale IP when running on the phone. Token never logged.
enum Net {
    static private(set) var base = Config.bases.first ?? "http://127.0.0.1:8790"
    static private var resolved = false

    static func resolve() async {
        if resolved { return }
        for b in Config.bases {
            guard let url = URL(string: b + "/api/health?t=" + Config.token) else { continue }
            var req = URLRequest(url: url); req.timeoutInterval = 4
            if let (_, resp) = try? await URLSession.shared.data(for: req),
               (resp as? HTTPURLResponse)?.statusCode == 200 {
                base = b; resolved = true; return
            }
        }
    }

    static func get<T: Decodable>(_ path: String) async throws -> T {
        let sep = path.contains("?") ? "&" : "?"
        guard let url = URL(string: base + path + sep + "t=" + Config.token) else {
            throw URLError(.badURL)
        }
        var req = URLRequest(url: url)
        req.timeoutInterval = 12
        let (data, resp) = try await URLSession.shared.data(for: req)
        guard let http = resp as? HTTPURLResponse, http.statusCode == 200, !data.isEmpty else {
            throw URLError(.badServerResponse)
        }
        return try JSONDecoder().decode(T.self, from: data)
    }
}
