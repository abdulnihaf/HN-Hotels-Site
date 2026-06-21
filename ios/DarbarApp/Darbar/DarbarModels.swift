import Foundation

// Darbar — the HR / staff chamber ("the Court"). FULLY NATIVE port of the deployed PWA
// (darbar.hnhotels.in/ops/darbar, app.js v326). Every model is shaped 1:1 from the LIVE payloads
// (curl-verified 2026-06-20), incl. the execution endpoints — pay advance, settle, set-pay, exit,
// leave, onboard, fix-punch. Money is in RUPEES on these endpoints (no paise conversion).
//
// Cross-ref identity (DIWAN-IOS-CONTRACT §6): employee_id (`id`), staff_pin (`pin`), brand_label,
// job_name travel on every person-bearing row — the join keys other chambers read.

// MARK: - Auth (POST /api/darbar?action=auth {pin})

struct DarbarAuthResponse: Codable {
    var token: String
    var user: String?
    var role: String?
    var fin: Bool?
}

// MARK: - Today / the Court  (GET /api/darbar?action=home)

struct DarbarHome: Codable, Hashable {
    var businessDay: String?
    var istNow: String?
    var stats: DarbarStats?
    var exceptionCount: Int?
    var exceptions: [DarbarException]?
    var health: DarbarHealth?

    enum CodingKeys: String, CodingKey {
        case stats, exceptions, health
        case businessDay = "business_day"
        case istNow = "ist_now"
        case exceptionCount = "exception_count"
    }
}

struct DarbarStats: Codable, Hashable {
    var expected, present, inProgress, missingPunch, absent, off: Int?
    enum CodingKeys: String, CodingKey {
        case expected, present, absent, off
        case inProgress = "in_progress"
        case missingPunch = "missing_punch"
    }
}

struct DarbarException: Codable, Identifiable, Hashable {
    var type: String?
    var id: Int?                 // employee_id (rostered rows)
    var pin: String?             // staff_pin
    var brand: String?           // brand_label
    var jobName: String?
    var name, deviceName: String?
    var punches, days, daysSilent, oddDays: Int?
    var lastPunch, shape, tier: String?
    var active: Bool?
    var monthlySalary, dailyRate: Double?

    enum CodingKeys: String, CodingKey {
        case type, id, pin, name, brand, punches, days, active, shape, tier
        case jobName = "job_name"
        case deviceName = "device_name"
        case lastPunch = "last_punch"
        case daysSilent = "days_silent"
        case oddDays = "odd_days"
        case monthlySalary = "monthly_salary"
        case dailyRate = "daily_rate"
    }

    var uid: String { "\(type ?? "x")-\(pin ?? id.map(String.init) ?? name ?? "?")" }
    var displayName: String { name ?? deviceName ?? (pin.map { "PIN \($0)" } ?? "Unknown") }
    var photoPin: String? { (pin?.isEmpty == false) ? pin : nil }
    var photoId: Int? { photoPin == nil ? id : nil }
}

struct DarbarHealth: Codable, Hashable {
    var camsLastPunchAgeMin: Int?
    var camsQuietHours, camsOk: Bool?
    var ghostCount: Int?
    enum CodingKeys: String, CodingKey {
        case camsLastPunchAgeMin = "cams_last_punch_age_min"
        case camsQuietHours = "cams_quiet_hours"
        case camsOk = "cams_ok"
        case ghostCount = "ghost_count"
    }
}

// MARK: - Roster  (GET /api/hr-admin?action=employees&active=1 → {employees:[…]})

struct DarbarEmployeesResponse: Codable { var employees: [DarbarEmployee]? }

struct DarbarEmployee: Codable, Identifiable, Hashable {
    var id: Int
    var pin: String?
    var name: String?
    var knownAs: String?
    var brandLabel: String?
    var jobName: String?
    var payType: String?
    var monthlySalary: Double?
    var dailyRate: Double?
    var phone: String?
    var isActive: Int?
    var staffPin: String?
    var bioEnrolled: Int?
    var presenceConfirmed: Int?

    enum CodingKeys: String, CodingKey {
        case id, pin, name, phone
        case knownAs = "known_as"
        case brandLabel = "brand_label"
        case jobName = "job_name"
        case payType = "pay_type"
        case monthlySalary = "monthly_salary"
        case dailyRate = "daily_rate"
        case isActive = "is_active"
        case staffPin = "staff_pin"
        case bioEnrolled = "bio_enrolled"
        case presenceConfirmed = "presence_confirmed"
    }

    var displayName: String { (knownAs?.isEmpty == false ? knownAs : name) ?? "Unknown" }
    var hasPay: Bool { (monthlySalary ?? 0) > 0 || (dailyRate ?? 0) > 0 }
    var payLabel: String {
        if payType == "Contract", let d = dailyRate, d > 0 { return "₹\(Int(d))/day" }
        if let m = monthlySalary, m > 0 { return "₹\(Int(m))/mo" }
        if let d = dailyRate, d > 0 { return "₹\(Int(d))/day" }
        return "—"
    }
}

// MARK: - Pay: advances list  (GET /api/hr-payroll?action=list-advances&month=)

struct AdvancesListResponse: Codable { var advances: [AdvanceRow]?; var rows: [AdvanceRow]? }

struct AdvanceRow: Codable, Identifiable, Hashable {
    var id: Int
    var employeeId: Int?
    var advanceDate: String?
    var amount: Double?
    var paidVia: String?
    var reason: String?
    var source: String?
    var receiptStatus: String?
    var payPeriod: String?
    var employeeName: String?
    var employeeKnownAs: String?
    var brandLabel: String?

    enum CodingKeys: String, CodingKey {
        case id, amount, reason, source
        case employeeId = "employee_id"
        case advanceDate = "advance_date"
        case paidVia = "paid_via"
        case receiptStatus = "receipt_status"
        case payPeriod = "pay_period"
        case employeeName = "employee_name"
        case employeeKnownAs = "employee_known_as"
        case brandLabel = "brand_label"
    }
    var who: String { (employeeKnownAs?.isEmpty == false ? employeeKnownAs : employeeName) ?? "—" }
    var isSettlement: Bool { source == "settlement" }
}

// MARK: - Settle context  (GET /api/hr-payroll?action=settle-context&employee_id=&month=)

struct SettleContext: Codable, Hashable {
    var ok: Bool?
    var error: String?
    var employee: SettleEmployee?
    var month: String?
    var attendance: SettleAttendance?
    var advances: SettleAdvances?
    var settlements: SettleAdvances?
    var remainingHint: Double?
    enum CodingKeys: String, CodingKey {
        case ok, error, employee, month, attendance, advances, settlements
        case remainingHint = "remaining_hint"
    }
}

struct SettleEmployee: Codable, Hashable {
    var id: Int?
    var pin: String?
    var name, brand, payType: String?
    var monthlySalary, dailyRate: Double?
    var phone, payLane, startDate: String?
    var presenceConfirmed, trackAttendance, isActive: Int?
    enum CodingKeys: String, CodingKey {
        case id, pin, name, brand, phone
        case payType = "pay_type"
        case monthlySalary = "monthly_salary"
        case dailyRate = "daily_rate"
        case payLane = "pay_lane"
        case startDate = "start_date"
        case presenceConfirmed = "presence_confirmed"
        case trackAttendance = "track_attendance"
        case isActive = "is_active"
    }
    var salaryLabel: String {
        if let m = monthlySalary, m > 0 { return "₹\(Int(m))/mo" }
        if let d = dailyRate, d > 0 { return "₹\(Int(d))/day" }
        return "—"
    }
}

struct SettleAttendance: Codable, Hashable {
    var present, irregular, absent, off, pending, recorded: Int?
    var days: [SettleDay]?
}

// One calendar cell in the settle-context attendance grid (PWA attGridHTML).
struct SettleDay: Codable, Hashable, Identifiable {
    var date: String?
    var status: String?
    var punchCount: Int?
    var totalHours: Double?
    var id: String { date ?? UUID().uuidString }
    enum CodingKeys: String, CodingKey {
        case date, status
        case punchCount = "punch_count"
        case totalHours = "total_hours"
    }
}

struct SettleAdvances: Codable, Hashable {
    var total: Double?
    var rows: [AdvanceRow]?
}

// MARK: - Daily attendance  (GET /api/hr-admin?action=attendance-daily&date=)

struct AttendanceDailyResponse: Codable {
    var date: String?
    var rows: [AttendanceRow]?
    var count: Int?
}

struct AttendanceRow: Codable, Identifiable, Hashable {
    var id: Int
    var employeeId: Int?
    var pin: String?
    var date: String?
    var firstInAt: String?
    var lastOutAt: String?
    var punchCount: Int?
    var totalHours: Double?
    var status: String?
    var isSinglePunch: Int?
    var name: String?
    var knownAs: String?
    var brandLabel: String?
    var jobName: String?

    enum CodingKeys: String, CodingKey {
        case id, pin, date, status, name
        case employeeId = "employee_id"
        case firstInAt = "first_in_at"
        case lastOutAt = "last_out_at"
        case punchCount = "punch_count"
        case totalHours = "total_hours"
        case isSinglePunch = "is_single_punch"
        case knownAs = "known_as"
        case brandLabel = "brand_label"
        case jobName = "job_name"
    }

    var displayName: String { (knownAs?.isEmpty == false ? knownAs : name) ?? (pin.map { "PIN \($0)" } ?? "—") }

    // 1:1 port of the PWA attState (app.js 395–409). Owner's canonical rule:
    //   ANY tap = present; 0 taps = absent; an ODD punch count = a punch missing —
    //   BUT on the still-OPEN business day (closes 4am) an odd count just means
    //   MID-SHIFT (working or on break), never an error, never a Fix button.
    //   Errors only exist on CLOSED days. 0 taps on the open day = "not in yet".
    // `isLiveDay` MUST be threaded in by the caller = (attendDate == bizDayIST()).
    struct AttState {
        let kind: String        // present | absent | off
        let incomplete: Bool    // present but a punch missing (the ones to fix)
        let working: Bool       // odd-on-open-day → mid-shift
        let label: String
    }
    func attState(isLiveDay: Bool) -> AttState {
        let st = status?.lowercased()
        if st == "week_off" || st == "leave" {
            return AttState(kind: "off", incomplete: false, working: false,
                            label: st == "leave" ? "LEAVE" : "WEEK OFF")
        }
        let pc = punchCount ?? 0
        if pc >= 1 {
            let odd = pc % 2 == 1
            if isLiveDay && odd {
                return AttState(kind: "present", incomplete: false, working: true, label: "WORKING")
            }
            return AttState(kind: "present", incomplete: odd, working: false,
                            label: odd ? (pc == 1 ? "IN — NO OUT" : "MISSING PUNCH") : "PRESENT")
        }
        return AttState(kind: "absent", incomplete: false, working: false,
                        label: isLiveDay ? "NOT IN YET" : "ABSENT")
    }
}

// MARK: - Month attendance  (GET /api/darbar?action=month-attendance&month=)
// Flat rows: one per (employee, day). The view groups them into per-person dot strips.

struct MonthAttendanceResponse: Codable { var rows: [MonthAttendanceRow]? }

struct MonthAttendanceRow: Codable, Hashable {
    var id: Int?
    var name: String?
    var brand: String?
    var date: String?
    var status: String?
    var punchCount: Int?
    var totalHours: Double?
    enum CodingKeys: String, CodingKey {
        case id, name, brand, date, status
        case punchCount = "punch_count"
        case totalHours = "total_hours"
    }
}

// One person's full-month dot strip (derived from the flat rows, PWA renderAttendMonth).
struct MonthPerson: Identifiable, Hashable {
    let id: Int
    let name: String
    let brand: String?
    var byDate: [String: MonthAttendanceRow]
    var worked = 0, errs = 0, absent = 0
}

// MARK: - Month board  (GET /api/darbar?action=month-board&month=)

struct MonthBoardResponse: Codable { var month: String?; var rows: [MonthBoardRow]? }

struct MonthBoardRow: Codable, Identifiable, Hashable {
    var id: Int
    var pin: String?
    var name: String?
    var brand: String?
    var isActive: Int?
    var payLane: String?
    var dailyRate, monthlySalary: Double?
    var daysWorked, daysError: Int?
    var advances, settled: Double?
    var startDate: String?
    var presenceConfirmed, trackAttendance: Int?
    var payType: String?
    enum CodingKeys: String, CodingKey {
        case id, pin, name, brand
        case isActive = "is_active"
        case payLane = "pay_lane"
        case dailyRate = "daily_rate"
        case monthlySalary = "monthly_salary"
        case daysWorked = "days_worked"
        case daysError = "days_error"
        case advances, settled
        case startDate = "start_date"
        case presenceConfirmed = "presence_confirmed"
        case trackAttendance = "track_attendance"
        case payType = "pay_type"
    }
}

// MARK: - Record-advance receipt  (POST /api/hr-payroll?action=record-advance → {receipt})

struct RecordAdvanceResponse: Codable { var receipt: ReceiptResult? }

struct ReceiptResult: Codable, Hashable {
    var ok: Bool?
    var reason: String?
    var attempted: Bool?
    // PWA receiptToast: ok → "receipt sent"; no_phone / not attempted → "no number on file";
    // else → "recorded, receipt didn't send".
    func toastSuffix() -> String {
        if ok == true { return " · receipt sent" }
        if reason == "no_phone" || attempted == false { return " · no number on file, no receipt" }
        return " · recorded, receipt didn’t send"
    }
}

// MARK: - Photo meta  (GET /api/darbar?action=photo-meta)

struct PhotoMeta: Codable, Hashable { var count: Int?; var latest: String? }

// MARK: - error

enum DarbarError: LocalizedError {
    case badURL, badPIN, unauthorized, server(String)
    var errorDescription: String? {
        switch self {
        case .badURL: return "Darbar URL is invalid."
        case .badPIN: return "Wrong PIN."
        case .unauthorized: return "Session expired."
        case .server(let m): return m
        }
    }
}

// MARK: - Rough-band estimator (1:1 port of the PWA estBand, owner rules 2026-06-12)
// Always a RANGE, never a verdict. The owner's typed number is the only truth; this is
// a guide. Returns lo/hi/flag, or nil with a `why` when the person isn't estimable.

struct EstBand: Hashable { var lo: Double?; var hi: Double?; var flag: String?; var why: String? }

func darbarEstBand(payType: String?, monthlySalary: Double?, dailyRate: Double?,
                   daysWorked: Int, startDate: String?, presenceConfirmed: Int?,
                   trackAttendance: Int?, isActive: Int?, payLane: String?, month: String) -> EstBand {
    if isActive == 0 { return EstBand(why: "left") }
    if payLane == "daily" { return EstBand(why: "daily lane") }
    let sal = monthlySalary ?? 0, rate = dailyRate ?? 0, dw = daysWorked
    let parts = month.split(separator: "-").compactMap { Int($0) }
    guard parts.count == 2 else { return EstBand(why: "no rate") }
    let y = parts[0], m = parts[1]
    let mdays = daysInMonth(y: y, m: m)
    var startDay = 1
    if let sd = startDate, sd.count >= 10, String(sd.prefix(7)) == month, let d = Int(sd.dropFirst(8).prefix(2)) { startDay = d }
    let win = max(1, mdays - startDay + 1)
    let conf = presenceConfirmed == 1
    func flagFor() -> String? {
        if conf && Double(dw) < Double(win) * 0.5 { return "not punching" }
        if Double(dw) < Double(win) * 0.5 { return "punches thin" }
        if startDay > 1 { return "joined \(startDay)/\(m)" }
        return nil
    }
    if (payType ?? "").lowercased() == "monthly" && sal > 0 {
        if trackAttendance != 0 && dw == 0 && !conf { return EstBand(why: "no punches") }
        let v = (sal * Double(win) / Double(mdays)).rounded()
        return EstBand(lo: v, hi: v, flag: flagFor())
    }
    if rate > 0 {
        if trackAttendance == 0 && !conf { return EstBand(why: "untracked") }
        let lo = Double(dw) * rate
        let hi = max(lo, min(sal > 0 ? sal : rate * Double(win), rate * Double(win)))
        return EstBand(lo: lo, hi: hi, flag: flagFor())
    }
    return EstBand(why: "no rate")
}

func darbarLeftBand(_ e: EstBand, given: Double) -> String {
    guard let lo = e.lo, let hi = e.hi else { return "" }
    let l1 = max(0, lo - given), l2 = max(0, hi - given)
    return l1 == l2 ? "≈ \(inrLabel(l1))" : "≈ \(inrLabel(l1)) – \(inrLabel(l2))"
}

func daysInMonth(y: Int, m: Int) -> Int {
    var c = DateComponents(); c.year = y; c.month = m
    var cal = Calendar(identifier: .gregorian); cal.timeZone = TimeZone(identifier: "Asia/Kolkata")!
    if let d = cal.date(from: c), let r = cal.range(of: .day, in: .month, for: d) { return r.count }
    return 30
}

// Active settlement month (PWA activeSettlementMonth): 1st–10th clears the previous month.
func activeSettlementMonth() -> String {
    var cal = Calendar(identifier: .gregorian); cal.timeZone = TimeZone(identifier: "Asia/Kolkata")!
    let now = Date()
    var y = cal.component(.year, from: now), m = cal.component(.month, from: now)
    if cal.component(.day, from: now) <= 10 { m -= 1; if m < 1 { m = 12; y -= 1 } }
    return "\(y)-" + String(format: "%02d", m)
}

func shiftMonth(_ ym: String, by delta: Int) -> String {
    let parts = ym.split(separator: "-").compactMap { Int($0) }
    guard parts.count == 2 else { return ym }
    var y = parts[0], m = parts[1] + delta
    while m < 1 { m += 12; y -= 1 }
    while m > 12 { m -= 12; y += 1 }
    return "\(y)-" + String(format: "%02d", m)
}

func monthLabel(_ ym: String) -> String {
    let parts = ym.split(separator: "-").compactMap { Int($0) }
    guard parts.count == 2 else { return ym }
    var c = DateComponents(); c.year = parts[0]; c.month = parts[1]; c.day = 1
    var cal = Calendar(identifier: .gregorian); cal.timeZone = TimeZone(identifier: "Asia/Kolkata")!
    let f = DateFormatter(); f.dateFormat = "LLLL yyyy"; f.locale = Locale(identifier: "en_IN")
    f.timeZone = TimeZone(identifier: "Asia/Kolkata")
    return cal.date(from: c).map { f.string(from: $0) } ?? ym
}

// Closed payment-method set (PWA PAY_VIA) — the only values paid_via may take.
enum PayVia: String, CaseIterable, Identifiable {
    case cash, upi, bank, razorpay, paytm
    var id: String { rawValue }
    var label: String { rawValue == "upi" ? "UPI" : rawValue.capitalized }
}
