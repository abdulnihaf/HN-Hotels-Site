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

// MARK: - Hiring (flow #1): manpower suppliers  (GET /api/hiring-darbar?action=suppliers)
// The work BEFORE hire. A supplier is a coordinate (type × area × roles × grade × status);
// the owner CALLS them, and each call is logged so "have we called them" is derived, not declared.

struct SuppliersResponse: Codable { var suppliers: [HiringSupplier]?; var count: Int? }
struct SupplierLogResponse: Codable { var ok: Bool?; var supplier: HiringSupplier? }

struct HiringSupplier: Codable, Identifiable, Hashable {
    var id: Int
    var name: String
    var type: String?
    var phone: String?
    var whatsapp: String?
    var area: String?
    var city: String?
    var website: String?
    var sourceUrls: [String]?
    var specialization: String?
    var rolesSupplied: [String]?
    var hospitalityFocus: Bool?
    var centralBlr: Bool?
    var relevanceScore: Int?
    var grade: String?
    var confidence: String?
    var evidence: String?
    var notes: String?
    var status: String
    var callCount: Int?
    var lastCalledAt: String?
    var lastOutcome: String?

    enum CodingKeys: String, CodingKey {
        case id, name, type, phone, whatsapp, area, city, website, specialization, evidence, notes, status, grade, confidence
        case sourceUrls = "source_urls"
        case rolesSupplied = "roles_supplied"
        case hospitalityFocus = "hospitality_focus"
        case centralBlr = "central_blr"
        case relevanceScore = "relevance_score"
        case callCount = "call_count"
        case lastCalledAt = "last_called_at"
        case lastOutcome = "last_outcome"
    }

    var telURL: URL? { phone.flatMap { URL(string: "tel:+91\($0)") } }
    var hasPhone: Bool { (phone?.isEmpty == false) }
    var rolesLabel: String { (rolesSupplied ?? []).joined(separator: " · ") }
    var firstSource: URL? { sourceUrls?.first.flatMap { URL(string: $0) } }
    var gradeLabel: String { grade ?? "—" }
    // status → human label + colour bucket
    var statusLabel: String {
        switch status {
        case "new": return "To call"
        case "called": return "No answer"
        case "responded": return "Reached"
        case "sent_jd": return "Sent JD"
        case "not_relevant": return "Not relevant"
        case "dead": return "Dead"
        default: return status.capitalized
        }
    }
}

// Closed outcome set logged after a call (mirrors hiring-darbar log_call outcomes).
enum CallOutcome: String, CaseIterable, Identifiable {
    case reached, will_send, no_answer, busy, callback, not_relevant
    var id: String { rawValue }
    var label: String {
        switch self {
        case .reached: return "Reached — interested"
        case .will_send: return "Will send candidates"
        case .no_answer: return "No answer"
        case .busy: return "Busy / call later"
        case .callback: return "Asked to call back"
        case .not_relevant: return "Not relevant"
        }
    }
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

// MARK: - Hiring WhatsApp campaign (flow #2)

struct HiringRolesResponse: Codable { var roles: [HiringRole]?; var nudges: [String]? }

struct HiringRole: Codable, Identifiable, Hashable {
    var roleKey: String
    var label: String
    var brand: String
    var creativeKey: String?
    var posterUrl: String?
    var defaultPackage: String?
    var alwaysNeed: Bool
    var priorityScore: Int?
    var churnRank: Int?
    var templateName: String?
    var odooJobNames: [String]?
    var supplyCount: Int
    var replyRate: Double?
    var replySent: Int?
    var replyReplied: Int?
    var channel: String

    enum CodingKeys: String, CodingKey {
        case roleKey = "role_key"
        case label, brand
        case creativeKey = "creative_key"
        case posterUrl = "poster_url"
        case defaultPackage = "default_package"
        case alwaysNeed = "always_need"
        case priorityScore = "priority_score"
        case churnRank = "churn_rank"
        case templateName = "template_name"
        case odooJobNames = "odoo_job_names"
        case supplyCount = "supply_count"
        case replyRate = "reply_rate"
        case replySent = "reply_sent"
        case replyReplied = "reply_replied"
        case channel
    }

    var id: String { roleKey }
    var channelLabel: String {
        switch channel {
        case "db+referral": return "WhatsApp + referral"
        case "db-on-demand": return "WhatsApp on-demand"
        case "suppliers+referral+fb": return "Suppliers + FB"
        case "suppliers+referral": return "Suppliers + referral"
        default: return channel
        }
    }
}

struct AudiencePreview: Codable {
    var role: String
    var city: String?
    var totalCandidates: Int
    var afterExclusion: Int
    var excludedStaff: Int

    enum CodingKeys: String, CodingKey {
        case role, city
        case totalCandidates = "total_candidates"
        case afterExclusion = "after_exclusion"
        case excludedStaff = "excluded_staff"
    }
}

struct ComposeResponse: Codable {
    var ok: Bool?
    var campaignId: Int?
    var brand: String?
    var roleKey: String?
    var roleLabel: String?
    var queued: Int?
    var commission: String?
    var package: String?
    var posterUrl: String?
    var audienceMode: String?
    var city: String?

    enum CodingKeys: String, CodingKey {
        case ok
        case campaignId = "campaign_id"
        case brand
        case roleKey = "role_key"
        case roleLabel = "role_label"
        case queued, commission, package
        case posterUrl = "poster_url"
        case audienceMode = "audience_mode"
        case city
    }
}

struct SendResponse: Codable {
    var success: Bool?
    var campaignId: Int?
    var brand: String?
    var sent: Int?
    var failed: Int?
    var remaining: Int?
    var error: String?
}

struct CampaignStatusResponse: Codable {
    var campaign: Campaign?
    var counts: CampaignCounts?
}

struct Campaign: Codable {
    var id: Int
    var name: String?
    var templateName: String?
    var role: String?
    var roleKey: String?
    var brand: String?
    var commission: String?
    var package: String?
    var posterUrl: String?
    var status: String?
    var totalCandidates: Int?
    var createdAt: String?

    enum CodingKeys: String, CodingKey {
        case id, name
        case templateName = "template_name"
        case role
        case roleKey = "role_key"
        case brand, commission, package
        case posterUrl = "poster_url"
        case status
        case totalCandidates = "total_candidates"
        case createdAt = "created_at"
    }
}

struct CampaignCounts: Codable {
    var total: Int?
    var sent: Int?
    var failed: Int?
    var queued: Int?
    var replies: Int?
}

struct InboxResponse: Codable {
    var conversations: [HiringConversation]?
    var total: Int?
    var page: Int?
    var pages: Int?
}

struct HiringConversation: Codable, Identifiable, Hashable {
    var phone: String
    var candidateName: String?
    var campaignId: Int?
    var campaignName: String?
    var campaignRole: String?
    var campaignBrand: String?
    var lastMessage: String?
    var lastDirection: String?
    var lastMessageAt: String?
    var msgType: String?
    var unreadCount: Int
    var totalMessages: Int

    enum CodingKeys: String, CodingKey {
        case phone
        case candidateName = "candidate_name"
        case campaignId = "campaign_id"
        case campaignName = "campaign_name"
        case campaignRole = "campaign_role"
        case campaignBrand = "campaign_brand"
        case lastMessage = "last_message"
        case lastDirection = "last_direction"
        case lastMessageAt = "last_message_at"
        case msgType = "msg_type"
        case unreadCount = "unread_count"
        case totalMessages = "total_messages"
    }

    var id: String { phone }
    var displayName: String { (candidateName?.isEmpty == false ? candidateName : phone) ?? phone }
    var isUnread: Bool { unreadCount > 0 }
}

// Closed payment-method set (PWA PAY_VIA) — the only values paid_via may take.
enum PayVia: String, CaseIterable, Identifiable {
    case cash, upi, bank, razorpay, paytm
    var id: String { rawValue }
    var label: String { rawValue == "upi" ? "UPI" : rawValue.capitalized }
}

// MARK: - Hiring Facebook posting (flow #3)

struct FbOverview: Codable {
    var creativesCount: Int?
    var eligibleGroups: Int?
    var totalMembers: Int?
    var sessionsCount: Int?
    var postsTotal: Int?
    var postsSuccess: Int?
    var postsFailed: Int?

    enum CodingKeys: String, CodingKey {
        case creativesCount = "creatives_count"
        case eligibleGroups = "eligible_groups"
        case totalMembers = "total_members"
        case sessionsCount = "sessions_count"
        case postsTotal = "posts_total"
        case postsSuccess = "posts_success"
        case postsFailed = "posts_failed"
    }
}

struct FbCreative: Codable, Identifiable {
    var id: Int
    var name: String
    var brand: String?
    var postText: String?
    var imageFilename: String?
    var postType: String?
    var timesUsed: Int?

    enum CodingKeys: String, CodingKey {
        case id, name, brand
        case postText = "post_text"
        case imageFilename = "image_filename"
        case postType = "post_type"
        case timesUsed = "times_used"
    }
}

struct FbSession: Codable, Identifiable {
    var id: Int
    var creativeId: Int?
    var accountName: String?
    var totalGroups: Int?
    var postedCount: Int?
    var failedCount: Int?
    var skippedCount: Int?
    var status: String?
    var startedAt: String?
    var completedAt: String?
    var creativeName: String?
    var imageFilename: String?

    enum CodingKeys: String, CodingKey {
        case id, status
        case creativeId = "creative_id"
        case accountName = "account_name"
        case totalGroups = "total_groups"
        case postedCount = "posted_count"
        case failedCount = "failed_count"
        case skippedCount = "skipped_count"
        case startedAt = "started_at"
        case completedAt = "completed_at"
        case creativeName = "creative_name"
        case imageFilename = "image_filename"
    }
}

struct FbPost: Codable, Identifiable {
    var id: Int
    var groupId: Int?
    var creativeId: Int?
    var sessionId: Int?
    var accountName: String?
    var status: String?
    var errorMessage: String?
    var postedAt: String?
    var groupName: String?
    var groupUrl: String?

    enum CodingKeys: String, CodingKey {
        case id, status
        case groupId = "group_id"
        case creativeId = "creative_id"
        case sessionId = "session_id"
        case accountName = "account_name"
        case errorMessage = "error_message"
        case postedAt = "posted_at"
        case groupName = "group_name"
        case groupUrl = "group_url"
    }
}

struct FbComposeResponse: Codable {
    var ok: Bool?
    var sessionId: Int?
    var totalGroups: Int?
    var error: String?

    enum CodingKeys: String, CodingKey {
        case ok, error
        case sessionId = "session_id"
        case totalGroups = "total_groups"
    }
}
