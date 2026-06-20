import Foundation
import Combine

// Darbar native model — drives all four tabs (Today / Attendance / Pay / Roster) and owns every
// execution action. AUTH = the one Diwan unlock (no per-chamber gate): mint a token from the seeded
// owner PIN, re-mint on 401. `fin` (owner) gates the money actions, mirroring the PWA.
@MainActor
final class DarbarAppModel: ObservableObject {
    // session
    @Published var token: String?
    @Published var fin = true
    @Published var locked = false
    @Published var toast: ToastMsg?

    // today
    @Published var home: DarbarHome?
    @Published var todayStatus = "Opening the court…"
    @Published var loadingToday = false

    // attendance
    @Published var attendDate = DarbarClient.bizDayIST()
    @Published var attendRows: [AttendanceRow] = []
    @Published var attendBrand = "all"
    @Published var loadingAttend = false

    // pay
    @Published var advances: [AdvanceRow] = []
    @Published var payMonth = DarbarClient.monthIST()
    @Published var payBrand = "all"
    @Published var loadingPay = false

    // roster
    @Published var employees: [DarbarEmployee] = []
    @Published var rosterBrand = "all"
    @Published var loadingRoster = false

    private var mintedToken: String?

    struct ToastMsg: Identifiable, Equatable { let id = UUID(); let text: String; let ok: Bool }

    // MARK: derived
    var exceptions: [DarbarException] { home?.exceptions ?? [] }
    var exceptionCount: Int { home?.exceptionCount ?? exceptions.count }
    var stats: DarbarStats? { home?.stats }

    var attendFiltered: [AttendanceRow] {
        attendBrand == "all" ? attendRows : attendRows.filter { $0.brandLabel == attendBrand }
    }
    var payFiltered: [AdvanceRow] {
        payBrand == "all" ? advances : advances.filter { $0.brandLabel == payBrand }
    }
    var payTotal: Double { payFiltered.reduce(0) { $0 + ($1.amount ?? 0) } }
    var rosterFiltered: [DarbarEmployee] {
        rosterBrand == "all" ? employees : employees.filter { $0.brandLabel == rosterBrand }
    }

    // MARK: lifecycle
    func bootstrap() async {
        guard await ensureToken() != nil else {
            locked = (ownerPin() == nil); todayStatus = locked ? "Locked · unlock from the Diwan" : "Source unreachable"
            return
        }
        await loadToday()
    }

    func loadToday() async {
        guard let t = await ensureToken() else { return }
        loadingToday = true; defer { loadingToday = false }
        do {
            let h = try await DarbarClient.shared.home(token: t)
            home = h; todayStatus = liveStatus(h)
        } catch DarbarError.unauthorized { await reauth(); if let t2 = mintedToken { home = try? await DarbarClient.shared.home(token: t2) } }
        catch { todayStatus = "Source unreachable" }
    }

    func loadAttendance() async {
        guard let t = await ensureToken() else { return }
        loadingAttend = true; defer { loadingAttend = false }
        attendRows = (try? await DarbarClient.shared.attendanceDaily(date: attendDate, token: t)) ?? []
    }

    func loadPay() async {
        guard let t = await ensureToken() else { return }
        loadingPay = true; defer { loadingPay = false }
        advances = (try? await DarbarClient.shared.listAdvances(month: payMonth, token: t)) ?? []
    }

    func loadRoster() async {
        guard let t = await ensureToken() else { return }
        loadingRoster = true; defer { loadingRoster = false }
        employees = ((try? await DarbarClient.shared.employees(token: t)) ?? [])
            .filter { ($0.isActive ?? 1) == 1 }
            .sorted { $0.displayName < $1.displayName }
    }

    func settleContext(employeeId: Int) async -> SettleContext? {
        guard let t = await ensureToken() else { return nil }
        return try? await DarbarClient.shared.settleContext(employeeId: employeeId, month: payMonth, token: t)
    }

    // MARK: execution actions (each shows a toast + refreshes; fin-gated where the PWA gates)
    private func run(_ label: String, refresh: RefreshKind = .today, _ op: @escaping (String) async throws -> Void) async {
        guard let t = await ensureToken() else { show("Locked", ok: false); return }
        do {
            try await op(t)
            show(label, ok: true)
            switch refresh {
            case .today: await loadToday()
            case .pay: await loadPay()
            case .attend: await loadAttendance()
            case .roster: await loadRoster(); await loadToday()
            case .none: break
            }
        } catch { show(error.localizedDescription, ok: false) }
    }
    enum RefreshKind { case today, pay, attend, roster, none }

    func recordAdvance(employeeId: Int, amount: Double, paidVia: String, phone: String) async {
        guard fin else { return show("Pay is owner-only", ok: false) }
        await run("Advance paid · ₹\(Int(amount))", refresh: .pay) {
            try await DarbarClient.shared.recordAdvance(employeeId: employeeId, amount: amount,
                paidVia: paidVia, payPeriod: self.payMonth, phone: phone, token: $0)
        }
    }
    func updateAdvance(id: Int, amount: Double, paidVia: String) async {
        await run("Advance updated", refresh: .pay) {
            try await DarbarClient.shared.updateAdvance(id: id, amount: amount, payPeriod: self.payMonth, paidVia: paidVia, token: $0)
        }
    }
    func deleteAdvance(id: Int) async {
        await run("Advance removed", refresh: .pay) { try await DarbarClient.shared.deleteAdvance(id: id, token: $0) }
    }
    func setPay(employeeId: Int, payType: String, amount: Double) async {
        guard fin else { return show("Pay is owner-only", ok: false) }
        await run("Pay set", refresh: .roster) { try await DarbarClient.shared.setPay(employeeId: employeeId, payType: payType, amount: amount, token: $0) }
    }
    func markExit(employeeId: Int, reason: String, fnf: Double?) async {
        await run("Marked left · roster updated", refresh: .roster) {
            try await DarbarClient.shared.markExit(employeeId: employeeId, reason: reason, fnf: fnf, token: $0)
        }
    }
    func markLeave(employeeId: Int, start: String, end: String, type: String) async {
        await run("Leave recorded", refresh: .today) {
            try await DarbarClient.shared.markLeave(employeeId: employeeId, start: start, end: end, type: type, token: $0)
        }
    }
    func onboard(pin: String, name: String, brand: String) async {
        await run("Added to roster", refresh: .roster) { try await DarbarClient.shared.onboard(pin: pin, name: name, brand: brand, token: $0) }
    }
    func dismissGhost(pin: String) async {
        await run("Ghost dismissed", refresh: .today) { try await DarbarClient.shared.dismissGhost(pin: pin, token: $0) }
    }
    func fixPunch(employeeId: Int, date: String) async {
        await run("Checkout imputed", refresh: .attend) { try await DarbarClient.shared.fixPunch(employeeId: employeeId, date: date, token: $0) }
    }

    func show(_ text: String, ok: Bool) { toast = ToastMsg(text: text, ok: ok) }

    // MARK: token
    var photoToken: String? { mintedToken ?? (DiwanAuth.credential("darbar").flatMap { $0.contains(".") ? $0 : nil }) }

    private func currentToken() -> String? {
        if let m = mintedToken { return m }
        if let c = DiwanAuth.credential("darbar"), c.contains(".") { return c }
        return nil
    }
    private func ownerPin() -> String? {
        let n = "^[0-9]{3,8}$"
        if let o = DiwanAuth.credential("owner"), o.range(of: n, options: .regularExpression) != nil { return o }
        if let d = DiwanAuth.credential("darbar"), d.range(of: n, options: .regularExpression) != nil { return d }
        return nil
    }
    private func ensureToken() async -> String? {
        if let t = currentToken() { token = t; return t }
        guard let pin = ownerPin() else { return nil }
        if let r = try? await DarbarClient.shared.auth(pin: pin) {
            mintedToken = r.token; token = r.token; fin = r.fin ?? true; locked = false
            return r.token
        }
        return nil
    }
    private func reauth() async {
        mintedToken = nil
        if let pin = ownerPin(), let r = try? await DarbarClient.shared.auth(pin: pin) {
            mintedToken = r.token; token = r.token; fin = r.fin ?? true
        }
    }

    private func liveStatus(_ h: DarbarHome) -> String {
        let present = h.stats?.present ?? 0
        guard let hh = h.health else { return "\(present) present" }
        if hh.camsOk == true {
            if let a = hh.camsLastPunchAgeMin { return a > 90 ? "\(present) present · last punch \(a)m" : "\(present) present · device live (\(a)m)" }
            return "\(present) present · device live"
        }
        return "\(present) present · device silent — check it"
    }
}
