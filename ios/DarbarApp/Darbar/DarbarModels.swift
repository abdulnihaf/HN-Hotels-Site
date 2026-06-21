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

struct AdvancesListResponse: Codable { var rows: [AdvanceRow]? }

struct AdvanceRow: Codable, Identifiable, Hashable {
    var id: Int
    var employeeId: Int?
    var advanceDate: String?
    var amount: Double?
    var paidVia: String?
    var reason: String?
    var receiptStatus: String?
    var payPeriod: String?
    var employeeName: String?
    var employeeKnownAs: String?
    var brandLabel: String?

    enum CodingKeys: String, CodingKey {
        case id, amount, reason
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
}

// MARK: - Settle context  (GET /api/hr-payroll?action=settle-context&employee_id=&month=)

struct SettleContext: Codable, Hashable {
    var ok: Bool?
    var employee: SettleEmployee?
    var month: String?
    var attendance: SettleAttendance?
    var advances: SettleAdvances?
    var remainingHint: Double?
    enum CodingKeys: String, CodingKey {
        case ok, employee, month, attendance, advances
        case remainingHint = "remaining_hint"
    }
}

struct SettleEmployee: Codable, Hashable {
    var id: Int?
    var name, brand, payType: String?
    var monthlySalary, dailyRate: Double?
    var phone, payLane: String?
    enum CodingKeys: String, CodingKey {
        case id, name, brand, phone
        case payType = "pay_type"
        case monthlySalary = "monthly_salary"
        case dailyRate = "daily_rate"
        case payLane = "pay_lane"
    }
}

struct SettleAttendance: Codable, Hashable {
    var present, irregular, absent, off, pending, recorded: Int?
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
    // Owner's rule: any tap = present; 0 = absent; single/odd punch = present-but-missing.
    var working: Bool { (lastOutAt == nil) && (punchCount ?? 0) > 0 }
    var missingPunch: Bool { (isSinglePunch ?? 0) == 1 || ((punchCount ?? 0) % 2 == 1) }
    var isAbsent: Bool { (punchCount ?? 0) == 0 && status?.lowercased() != "off" }
}

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

// Closed payment-method set (PWA PAY_VIA) — the only values paid_via may take.
enum PayVia: String, CaseIterable, Identifiable {
    case cash, upi, bank, razorpay, paytm
    var id: String { rawValue }
    var label: String { rawValue == "upi" ? "UPI" : rawValue.capitalized }
}
