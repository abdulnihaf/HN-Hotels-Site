import SwiftUI

// Darbar — Apple Watch app. The wrist surface for the court: glance at attendance/health,
// then OPEN THE COURT — one exception per card with one-tap owner-confirm decisions
// (Mark Left, Ignore ghost). Form-heavy actions (leave dates, onboarding, set-pay) route to
// the phone. Read over the SAME live backend (darbar.hnhotels.in); auto-auths with the owner
// PIN (owner's wrist). Honest loading/empty/error — never a fake number.

@main
struct DarbarWatchApp: App {
    var body: some Scene { WindowGroup { DarbarRoot() } }
}

// ── models (subset of /api/darbar ?action=auth / ?action=home) ──
struct DWAuth: Codable { var token: String? }
struct DWHome: Codable { var stats: DWStats?; var exception_count: Int?; var exceptions: [DWException]?; var health: DWHealth? }
struct DWStats: Codable { var expected: Int?; var present: Int?; var absent: Int?; var off: Int? }
struct DWHealth: Codable { var cams_last_punch_age_min: Int?; var cams_ok: Bool? }
struct DWException: Codable, Identifiable, Hashable {
    var type: String?; var id: Int?; var pin: String?; var brand: String?
    var name: String?; var device_name: String?
    var days_silent: Int?; var odd_days: Int?; var punches: Int?; var days: Int?
    var monthly_salary: Double?; var tier: String?; var last_punch: String?
    var uid: String { "\(type ?? "x")-\(pin ?? id.map(String.init) ?? name ?? "?")" }
    var display: String { name ?? device_name ?? (pin.map { "PIN \($0)" } ?? "Unknown") }
}
enum DWErr: Error { case bad }

actor DarbarWatchClient {
    static let shared = DarbarWatchClient()
    private let base = "https://darbar.hnhotels.in"
    private let dec = JSONDecoder()
    private var token: String?

    func home() async throws -> DWHome {
        let t = try await ensureToken()
        do { return try await get("/api/darbar?action=home", t) }
        catch { token = nil; return try await get("/api/darbar?action=home", try await ensureToken()) }
    }
    func markExit(employeeId: Int) async throws { try await post("/api/darbar?action=mark-exit", ["employee_id": employeeId, "reason": ""]) }
    func dismissGhost(pin: String) async throws { try await post("/api/darbar?action=dismiss-ghost", ["pin": pin]) }

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
    private func get<T: Decodable>(_ path: String, _ t: String) async throws -> T {
        var r = URLRequest(url: URL(string: base + path)!); r.timeoutInterval = 12
        r.setValue(t, forHTTPHeaderField: "x-darbar-token")
        let (d, resp) = try await URLSession.shared.data(for: r)
        if let h = resp as? HTTPURLResponse, h.statusCode == 401 || h.statusCode == 403 { throw DWErr.bad }
        return try dec.decode(T.self, from: d)
    }
    private func post(_ path: String, _ body: [String: Any]) async throws {
        let t = try await ensureToken()
        var r = URLRequest(url: URL(string: base + path)!); r.httpMethod = "POST"; r.timeoutInterval = 12
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        r.setValue(t, forHTTPHeaderField: "x-darbar-token")
        r.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (_, resp) = try await URLSession.shared.data(for: r)
        if let h = resp as? HTTPURLResponse, !(200..<300).contains(h.statusCode) { throw DWErr.bad }
    }
}

@MainActor final class DWModel: ObservableObject {
    @Published var home: DWHome?
    @Published var status = "Loading…"
    var exceptions: [DWException] { home?.exceptions ?? [] }
    func load() async {
        if home == nil { status = "Loading…" }
        do { home = try await DarbarWatchClient.shared.home(); status = "" }
        catch { status = "Can't reach Darbar" }
    }
    func markLeft(_ e: DWException) async { await fire { if let id = e.id { try await DarbarWatchClient.shared.markExit(employeeId: id) } } }
    func ignoreGhost(_ e: DWException) async { await fire { if let p = e.pin { try await DarbarWatchClient.shared.dismissGhost(pin: p) } } }
    private func fire(_ op: @escaping () async throws -> Void) async {
        do { try await op(); await load() } catch { status = "Action failed" }
    }
}

let DACCENT = Color(red: 0x5B/255.0, green: 0x86/255.0, blue: 0xC9/255.0)

// ── root: paged glances (Today / Attendance / Health); Today opens the Court ──
struct DarbarRoot: View {
    @StateObject private var m = DWModel()
    var body: some View {
        NavigationStack {
            // sim/test hook: launch straight into the Court for verification (no effect in prod)
            if ProcessInfo.processInfo.environment["DARBAR_WATCH_VIEW"] == "court" {
                CourtView(m: m).task { await m.load() }
            } else {
                TabView {
                    TodayGlance(m: m)
                    AttendanceGlance(m: m)
                    HealthGlance(m: m)
                }
                .tabViewStyle(.page)
                .task { await m.load() }
            }
        }
    }
}

struct TodayGlance: View {
    @ObservedObject var m: DWModel
    var body: some View {
        ScrollView {
            VStack(spacing: 8) {
                Text("Darbar").font(.system(size: 16, weight: .heavy, design: .rounded)).foregroundStyle(DACCENT)
                if let s = m.home?.stats {
                    Text("\(s.present ?? 0)/\(s.expected ?? 0)").font(.system(size: 38, weight: .heavy, design: .rounded))
                    Text("present today").font(.system(size: 11)).foregroundStyle(.secondary)
                    let n = m.home?.exception_count ?? 0
                    NavigationLink { CourtView(m: m) } label: {
                        HStack(spacing: 6) {
                            Image(systemName: n > 0 ? "exclamationmark.circle.fill" : "checkmark.circle")
                            Text(n > 0 ? "\(n) to handle" : "court clear")
                        }
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(n > 0 ? .orange : .green)
                    }
                    .padding(.top, 4)
                } else {
                    Text(m.status).font(.system(size: 13)).foregroundStyle(.secondary).padding(.top, 18)
                }
                Button { Task { await m.load() } } label: { Label("Refresh", systemImage: "arrow.clockwise") }
                    .font(.system(size: 11)).tint(DACCENT).padding(.top, 4)
            }.padding(.vertical, 6).frame(maxWidth: .infinity)
        }
    }
}

struct AttendanceGlance: View {
    @ObservedObject var m: DWModel
    var body: some View {
        VStack(spacing: 8) {
            Text("Attendance").font(.system(size: 14, weight: .heavy)).foregroundStyle(DACCENT)
            if let s = m.home?.stats {
                row("present", s.present ?? 0, .green)
                row("absent", s.absent ?? 0, .orange)
                row("off", s.off ?? 0, .secondary)
            } else { Text(m.status).font(.system(size: 12)).foregroundStyle(.secondary) }
        }.padding()
    }
    func row(_ l: String, _ v: Int, _ c: Color) -> some View {
        HStack { Text(l).foregroundStyle(.secondary); Spacer(); Text("\(v)").font(.system(size: 20, weight: .bold, design: .rounded)).foregroundStyle(c) }
            .font(.system(size: 14))
    }
}

struct HealthGlance: View {
    @ObservedObject var m: DWModel
    var body: some View {
        VStack(spacing: 6) {
            Text("CAMS device").font(.system(size: 14, weight: .heavy)).foregroundStyle(DACCENT)
            if let h = m.home?.health {
                let age = h.cams_last_punch_age_min ?? -1
                let ok = h.cams_ok ?? (age >= 0 && age < 90)
                Text(ok ? "🟢 live" : "🔴 silent").font(.system(size: 22, weight: .bold))
                Text(age >= 0 ? "last punch \(age)m ago" : "no recent punch")
                    .font(.system(size: 12)).foregroundStyle(.secondary)
            } else { Text(m.status).font(.system(size: 12)).foregroundStyle(.secondary) }
        }.padding()
    }
}

// ── The Court: one exception per page, one-tap owner-confirm decisions ──
struct CourtView: View {
    @ObservedObject var m: DWModel
    @State private var pending: (title: String, run: () async -> Void)?
    @State private var showConfirm = false

    var body: some View {
        Group {
            if m.exceptions.isEmpty {
                VStack(spacing: 8) {
                    Image(systemName: "checkmark.seal.fill").font(.system(size: 34)).foregroundStyle(.green)
                    Text("Court clear").font(.system(size: 16, weight: .semibold))
                }
            } else {
                TabView {
                    ForEach(Array(m.exceptions.enumerated()), id: \.element.uid) { idx, e in
                        ExceptionCard(e: e, idx: idx, total: m.exceptions.count, m: m,
                                      ask: { t, r in pending = (t, r); showConfirm = true })
                    }
                }.tabViewStyle(.page)
            }
        }
        .navigationTitle("The Court")
        .confirmationDialog(pending?.title ?? "", isPresented: $showConfirm, titleVisibility: .visible) {
            Button("Confirm", role: .destructive) { if let r = pending?.run { Task { await r() } } }
            Button("Cancel", role: .cancel) {}
        }
    }
}

struct ExceptionCard: View {
    let e: DWException; let idx: Int; let total: Int
    @ObservedObject var m: DWModel
    let ask: (String, @escaping () async -> Void) -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text(e.display).font(.system(size: 16, weight: .bold)).lineLimit(1)
                    Spacer()
                    Text("\(idx+1)/\(total)").font(.system(size: 11)).foregroundStyle(.secondary)
                }
                if let b = e.brand, !b.isEmpty {
                    Text(b.uppercased()).font(.system(size: 9, weight: .heavy)).foregroundStyle(DACCENT)
                        .padding(.horizontal, 6).padding(.vertical, 2).background(DACCENT.opacity(0.16), in: Capsule())
                }
                Text(line).font(.system(size: 13)).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                actions
            }.padding(10)
        }
    }

    private var line: String {
        switch e.type {
        case "departed": return "\(e.days_silent ?? 0)d silent" + (e.monthly_salary.map { " · ₹\(Int($0/1000))k/mo" } ?? "") + (e.last_punch.map { " · last \($0)" } ?? "")
        case "ghost": return "\(e.punches ?? 0) punches / \(e.days ?? 0)d · working now"
        case "chronic_missed": return "missed punch on \(e.odd_days ?? 0) of last 7 days"
        case "never_punched": return "PIN \(e.pin ?? "?") enrolled, no punches yet"
        case "pay_missing": return "no pay set — settlement held"
        default: return e.type ?? "exception"
        }
    }

    @ViewBuilder private var actions: some View {
        switch e.type {
        case "departed":
            Button("Mark Left") { ask("Mark \(e.display) left?", { await m.markLeft(e) }) }
                .tint(.red).font(.system(size: 14, weight: .semibold))
            Text("Leave / dates → set on phone").font(.system(size: 10)).foregroundStyle(.secondary)
        case "ghost":
            Button("Ignore ghost") { ask("Ignore ghost PIN \(e.pin ?? "")?", { await m.ignoreGhost(e) }) }
                .tint(.orange).font(.system(size: 14, weight: .semibold))
            Text("Add to roster → on phone").font(.system(size: 10)).foregroundStyle(.secondary)
        case "chronic_missed":
            Text("Noted — talk to them. Phone for detail.").font(.system(size: 11)).foregroundStyle(.secondary)
        case "pay_missing":
            Text("Set pay → on phone").font(.system(size: 11)).foregroundStyle(.secondary)
        default:
            Text("Open Darbar on phone.").font(.system(size: 11)).foregroundStyle(.secondary)
        }
    }
}
