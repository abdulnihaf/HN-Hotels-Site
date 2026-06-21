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
    @Published var user: String?
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
    @Published var attendFilter: String?       // present | incomplete | absent | off (tap a stat to filter)
    @Published var attMode = "day"             // day | month
    @Published var monthRows: [MonthAttendanceRow] = []
    @Published var loadingAttend = false

    // pay
    @Published var advances: [AdvanceRow] = []
    @Published var payMonth = activeSettlementMonth()
    @Published var payBrand = "all"
    @Published var loadingPay = false
    @Published var board: [MonthBoardRow] = []
    @Published var loadingBoard = false

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

    // TRUE only while the selected attendance day is the still-open business day.
    // Threaded into every attendance state calc so odd-on-open = WORKING, not an error.
    var attendLive: Bool { attendDate == DarbarClient.bizDayIST() }

    var attendFiltered: [AttendanceRow] {
        let live = attendLive
        var rows = attendBrand == "all" ? attendRows : attendRows.filter { $0.brandLabel == attendBrand }
        if let f = attendFilter {
            rows = rows.filter { r in
                let st = r.attState(isLiveDay: live)
                switch f {
                case "present": return st.kind == "present"
                case "incomplete": return st.kind == "present" && st.incomplete
                case "absent": return st.kind == "absent"
                case "off": return st.kind == "off"
                default: return true
                }
            }
        }
        // Incomplete first (need fix), then present, absent, off — PWA ordering (app.js order()).
        return rows.sorted { a, b in attendRank(a, live: live) < attendRank(b, live: live) }
    }
    private func attendRank(_ r: AttendanceRow, live: Bool) -> Int {
        let st = r.attState(isLiveDay: live)
        if st.kind == "present" { return st.incomplete ? 0 : 1 }
        return st.kind == "absent" ? 2 : 3
    }
    // Pay list: GROUPED BY PERSON (the PWA shows the month's total per person, not raw rows).
    struct PayPerson: Identifiable, Hashable { let id: Int; let name: String; let brand: String?; var advTotal: Double; var setTotal: Double
        var total: Double { advTotal + setTotal }; var settled: Bool { setTotal > 0 } }
    var payFilteredRows: [AdvanceRow] {
        payBrand == "all" ? advances : advances.filter { $0.brandLabel == payBrand }
    }
    var payPeople: [PayPerson] {
        var by: [Int: PayPerson] = [:]
        for a in payFilteredRows {
            guard let eid = a.employeeId else { continue }
            var p = by[eid] ?? PayPerson(id: eid, name: a.who, brand: a.brandLabel, advTotal: 0, setTotal: 0)
            if a.isSettlement { p.setTotal += a.amount ?? 0 } else { p.advTotal += a.amount ?? 0 }
            by[eid] = p
        }
        return by.values.sorted { $0.total > $1.total }
    }
    var payTotal: Double { payFilteredRows.reduce(0) { $0 + ($1.amount ?? 0) } }
    var rosterFiltered: [DarbarEmployee] {
        rosterBrand == "all" ? employees : employees.filter { $0.brandLabel == rosterBrand }
    }
    // Monthly staffing cost (owner-only card): Σ monthly_salary OR daily_rate×30 per active person.
    var rosterMonthlyCost: Double {
        rosterFiltered.reduce(0) { acc, e in
            if let m = e.monthlySalary, m > 0 { return acc + m }
            if let d = e.dailyRate, d > 0 { return acc + d * 30 }
            return acc
        }
    }
    var rosterMissingPay: Int { rosterFiltered.filter { !$0.hasPay }.count }

    // Month attendance grouped into per-person dot strips (PWA renderAttendMonth).
    var monthPeople: [MonthPerson] {
        var by: [Int: MonthPerson] = [:]
        let biz = DarbarClient.bizDayIST()
        for r in monthRows {
            if attendBrand != "all" && r.brand != attendBrand { continue }
            guard let id = r.id else { continue }
            var p = by[id] ?? MonthPerson(id: id, name: r.name ?? "—", brand: r.brand, byDate: [:])
            if let d = r.date { p.byDate[d] = r }
            by[id] = p
        }
        // Tally worked/errors/absent over closed days.
        var people = Array(by.values)
        for i in people.indices {
            for (ds, r) in people[i].byDate {
                guard ds < biz else { continue }
                let st = r.status?.lowercased()
                if st == "week_off" || st == "leave" { continue }
                let pc = r.punchCount ?? 0
                if pc == 0 { people[i].absent += 1 }
                else { people[i].worked += 1; if pc % 2 == 1 { people[i].errs += 1 } }
            }
        }
        return people.sorted { $0.name < $1.name }
    }
    var boardFiltered: [MonthBoardRow] {
        payBrand == "all" ? board : board.filter { ($0.brand ?? "") == payBrand }
    }
    var isActiveSettlementMonth: Bool { payMonth == activeSettlementMonth() }

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
            home = h; todayStatus = liveStatus(h); todayDate = Self.dayShort(h.businessDay)
        } catch DarbarError.unauthorized { await reauth(); if let t2 = mintedToken { home = try? await DarbarClient.shared.home(token: t2) } }
        catch { todayStatus = "Source unreachable" }
    }

    func loadAttendance() async {
        if attMode == "month" { await loadMonthAttendance(); return }
        guard let t = await ensureToken() else { return }
        loadingAttend = true; defer { loadingAttend = false }
        attendRows = (try? await DarbarClient.shared.attendanceDaily(date: attendDate, token: t)) ?? []
    }
    func loadMonthAttendance() async {
        guard let t = await ensureToken() else { return }
        loadingAttend = true; defer { loadingAttend = false }
        monthRows = (try? await DarbarClient.shared.monthAttendance(month: String(attendDate.prefix(7)), token: t)) ?? []
    }
    // Refresh button (PWA refreshAttend) — server recomputes from the device feed, then reload.
    func pullAttendance() async {
        guard let t = await ensureToken() else { return }
        show("Pulling punches…", ok: true)
        try? await DarbarClient.shared.pullAttendance(pin: ownerPin(), from: attendDate, to: attendDate, token: t)
        await loadAttendance()
    }

    func loadPay() async {
        guard let t = await ensureToken() else { return }
        loadingPay = true; defer { loadingPay = false }
        advances = (try? await DarbarClient.shared.listAdvances(month: payMonth, token: t)) ?? []
    }
    func loadBoard() async {
        guard let t = await ensureToken() else { return }
        loadingBoard = true; defer { loadingBoard = false }
        board = (try? await DarbarClient.shared.monthBoard(month: payMonth, token: t)) ?? []
    }
    func changePayMonth(_ delta: Int) { payMonth = shiftMonth(payMonth, by: delta); Task { await loadPay() } }

    func loadRoster() async {
        guard let t = await ensureToken() else { return }
        loadingRoster = true; defer { loadingRoster = false }
        employees = ((try? await DarbarClient.shared.employees(token: t)) ?? [])
            .filter { ($0.isActive ?? 1) == 1 }
            .sorted { $0.displayName < $1.displayName }
    }

    func settleContext(employeeId: Int, month: String? = nil) async -> SettleContext? {
        guard let t = await ensureToken() else { return nil }
        return try? await DarbarClient.shared.settleContext(employeeId: employeeId, month: month ?? payMonth, token: t)
    }
    func photoMeta(pin: String?, id: Int?) async -> PhotoMeta? {
        guard let t = await ensureToken() else { return nil }
        return try? await DarbarClient.shared.photoMeta(pin: pin, id: id, token: t)
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

    // One payment path for both advance + settlement (mirrors the PWA doPay). The toast reflects
    // the real receipt status returned by the server — never a fabricated "sent".
    func recordPayment(employeeId: Int, amount: Double, paidVia: String, phone: String,
                       note: String?, month: String, settlement: Bool) async {
        guard fin else { return show("Pay is owner-only", ok: false) }
        guard let t = await ensureToken() else { return show("Locked", ok: false) }
        do {
            let rc = try await DarbarClient.shared.recordAdvance(employeeId: employeeId, amount: amount,
                paidVia: paidVia, payPeriod: month, phone: phone, note: note, settlement: settlement, token: t)
            let base = settlement ? "Settlement recorded" : "Advance recorded"
            show(base + (rc?.toastSuffix() ?? ""), ok: true)
            await loadPay()
            if settlement { await loadBoard() }
        } catch { show(error.localizedDescription, ok: false) }
    }
    func updateAdvance(id: Int, amount: Double, payPeriod: String, paidVia: String) async {
        guard fin else { return show("Editing pay is owner-only", ok: false) }
        await run("Entry updated", refresh: .pay) {
            try await DarbarClient.shared.updateAdvance(id: id, amount: amount, payPeriod: payPeriod, paidVia: paidVia, token: $0)
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
    func onboard(pin: String, name: String, brand: String, payType: String, wage: Double?, phone: String?) async {
        await run("Added to roster · sync to Odoo from Roster", refresh: .roster) {
            try await DarbarClient.shared.onboard(pin: pin, name: name, brand: brand,
                payType: payType, wage: wage, phone: phone, token: $0)
        }
    }
    func salaryOverride(employeeId: Int, payPeriod: String, amount: Double, note: String?) async {
        guard fin else { return show("Editing pay is owner-only", ok: false) }
        await run("Over-write saved", refresh: .none) {
            try await DarbarClient.shared.salaryOverride(employeeId: employeeId, payPeriod: payPeriod, amount: amount, note: note, token: $0)
        }
    }
    func keepActive() { show("Kept active — will re-ask if still silent", ok: true) }
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
            mintedToken = r.token; token = r.token; fin = r.fin ?? true; user = r.user; locked = false
            return r.token
        }
        return nil
    }
    private func reauth() async {
        mintedToken = nil
        if let pin = ownerPin(), let r = try? await DarbarClient.shared.auth(pin: pin) {
            mintedToken = r.token; token = r.token; fin = r.fin ?? true; user = r.user
        }
    }

    // PWA fmtDayShort: "yyyy-MM-dd" → "Sun, 21 Jun" (weekday short · day · month short).
    static func dayShort(_ d: String?) -> String {
        guard let d, d.count >= 10 else { return "" }
        let i = DateFormatter(); i.dateFormat = "yyyy-MM-dd"; i.timeZone = TimeZone(identifier: "Asia/Kolkata")
        let o = DateFormatter(); o.dateFormat = "EEE, d MMM"; o.timeZone = TimeZone(identifier: "Asia/Kolkata"); o.locale = Locale(identifier: "en_IN")
        return i.date(from: String(d.prefix(10))).map { o.string(from: $0) } ?? ""
    }

    // True when the status carries the device-silent warning (the PWA renders it RED).
    var todayDeviceSilent = false
    // PWA day-date next to the "Darbar" title (e.g. "Sun, 21 Jun").
    var todayDate = ""

    private func liveStatus(_ h: DarbarHome) -> String {
        let present = h.stats?.present ?? 0
        guard let hh = h.health else { todayDeviceSilent = false; return "\(present) present" }
        if hh.camsOk == true {
            todayDeviceSilent = false
            if let a = hh.camsLastPunchAgeMin {
                return a > 90 ? "\(present) present · last punch \(a)m · normal lull"
                              : "\(present) present · device live (\(a)m ago)"
            }
            return "\(present) present · device live"
        }
        todayDeviceSilent = true
        if let a = hh.camsLastPunchAgeMin { return "\(present) present · device silent \(a)m — check it" }
        return "\(present) present · device silent — check it"
    }
}
