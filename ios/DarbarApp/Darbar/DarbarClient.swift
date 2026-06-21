import Foundation

// Darbar API client — the full surface the deployed PWA uses: /api/darbar, /api/hr-admin,
// /api/hr-payroll. One actor, hardcoded base, shared decoder, 12s timeout. Every call carries the
// shared Diwan token (x-darbar-token); the photo endpoint also accepts it as `?t=`.
//
// Reads: home, employees, attendance-daily, settle-context, list-advances, photo.
// Writes (owner-approved execution): record/update/delete-advance, set-pay (employee-upsert),
// salary-override, mark-exit, mark-leave, onboard, dismiss-ghost, fix-punch, pull-attendance.
actor DarbarClient {
    static let shared = DarbarClient()
    static let base = "https://darbar.hnhotels.in"

    private let decoder = JSONDecoder()

    // MARK: auth (the token mint)
    func auth(pin: String) async throws -> DarbarAuthResponse {
        let data = try await send(path: "/api/darbar", query: ["action": "auth"], method: "POST",
                                  body: ["pin": pin], token: nil, authError: .badPIN)
        return try decoder.decode(DarbarAuthResponse.self, from: data)
    }

    // Gate entry point — validates the PIN by minting a token (401 → wrong PIN).
    func verify(pin: String) async throws -> Bool { _ = try await auth(pin: pin); return true }

    // MARK: reads
    func home(token: String) async throws -> DarbarHome {
        try decoder.decode(DarbarHome.self, from:
            try await get("/api/darbar", ["action": "home"], token))
    }
    func employees(token: String) async throws -> [DarbarEmployee] {
        let d = try await get("/api/hr-admin", ["action": "employees", "active": "1"], token)
        return (try decoder.decode(DarbarEmployeesResponse.self, from: d)).employees ?? []
    }
    func attendanceDaily(date: String, token: String) async throws -> [AttendanceRow] {
        let d = try await get("/api/hr-admin", ["action": "attendance-daily", "date": date], token)
        return (try decoder.decode(AttendanceDailyResponse.self, from: d)).rows ?? []
    }
    func settleContext(employeeId: Int, month: String, token: String) async throws -> SettleContext {
        let d = try await get("/api/hr-payroll",
                              ["action": "settle-context", "employee_id": String(employeeId), "month": month], token)
        return try decoder.decode(SettleContext.self, from: d)
    }
    func listAdvances(month: String, token: String) async throws -> [AdvanceRow] {
        let d = try await get("/api/hr-payroll", ["action": "list-advances", "month": month], token)
        let r = try decoder.decode(AdvancesListResponse.self, from: d)
        return r.advances ?? r.rows ?? []
    }
    func monthAttendance(month: String, token: String) async throws -> [MonthAttendanceRow] {
        let d = try await get("/api/darbar", ["action": "month-attendance", "month": month], token)
        return (try decoder.decode(MonthAttendanceResponse.self, from: d)).rows ?? []
    }
    func monthBoard(month: String, token: String) async throws -> [MonthBoardRow] {
        let d = try await get("/api/darbar", ["action": "month-board", "month": month], token)
        return (try decoder.decode(MonthBoardResponse.self, from: d)).rows ?? []
    }
    func photoMeta(pin: String?, id: Int?, token: String) async throws -> PhotoMeta {
        var q: [String: String] = ["action": "photo-meta"]
        if let pin, !pin.isEmpty { q["pin"] = pin } else if let id { q["id"] = String(id) }
        return try decoder.decode(PhotoMeta.self, from: try await get("/api/darbar", q, token))
    }

    // MARK: writes — execution (each is an owner-approved action, fired from a CONFIRMED tap)

    // Record a payment. mode=settle adds source/reason/notes (1:1 with the PWA doPay).
    // Returns the receipt status (ok / no_phone / failed) so the toast can be honest.
    @discardableResult
    func recordAdvance(employeeId: Int, amount: Double, paidVia: String, payPeriod: String,
                       phone: String, note: String?, settlement: Bool, token: String) async throws -> ReceiptResult? {
        var body: [String: Any] = ["employee_id": employeeId, "amount": amount,
            "advance_date": Self.todayIST(), "paid_via": paidVia,
            "confirmed_phone": phone, "pay_period": payPeriod]
        if settlement {
            body["source"] = "settlement"; body["reason"] = "salary settlement"
            body["notes"] = (note?.isEmpty == false) ? note! : "Settlement \(payPeriod)"
        } else {
            body["reason"] = (note?.isEmpty == false) ? note! : NSNull()
        }
        let data = try await send(path: "/api/hr-payroll", query: ["action": "record-advance"],
                                  method: "POST", body: body, token: token)
        return try? decoder.decode(RecordAdvanceResponse.self, from: data).receipt
    }
    func pullAttendance(pin: String?, from: String, to: String, token: String) async throws {
        _ = try await send(path: "/api/hr-admin", query: [:], method: "POST",
            body: ["action": "pull-attendance", "pin": pin ?? "", "from": from, "to": to], token: token)
    }
    func updateAdvance(id: Int, amount: Double, payPeriod: String, paidVia: String, token: String) async throws {
        _ = try await send(path: "/api/hr-payroll", query: ["action": "update-advance"], method: "POST",
            body: ["id": id, "amount": amount, "pay_period": payPeriod, "paid_via": paidVia], token: token)
    }
    func deleteAdvance(id: Int, token: String) async throws {
        _ = try await send(path: "/api/hr-payroll", query: ["action": "delete-advance"], method: "POST",
            body: ["id": id], token: token)
    }
    func setPay(employeeId: Int, payType: String, amount: Double, token: String) async throws {
        let monthly = payType == "Monthly" ? amount : amount * 30
        let daily = payType == "Contract" ? amount : (amount / 30).rounded()
        _ = try await send(path: "/api/hr-admin", query: [:], method: "POST",
            body: ["action": "employee-upsert", "id": employeeId, "pay_type": payType,
                   "monthly_salary": monthly, "daily_rate": daily], token: token)
    }
    func salaryOverride(employeeId: Int, payPeriod: String, amount: Double, note: String?, token: String) async throws {
        _ = try await send(path: "/api/darbar", query: ["action": "salary-override"], method: "POST",
            body: ["employee_id": employeeId, "pay_period": payPeriod, "amount": amount,
                   "note": note ?? ""], token: token)
    }
    func markExit(employeeId: Int, reason: String?, fnf: Double?, token: String) async throws {
        var body: [String: Any] = ["employee_id": employeeId]
        // PWA sends reason: null when empty (not ""). Match it.
        body["reason"] = (reason?.isEmpty == false) ? reason! : NSNull()
        if let fnf { body["fnf_amount"] = fnf }
        _ = try await send(path: "/api/darbar", query: ["action": "mark-exit"], method: "POST", body: body, token: token)
    }
    func markLeave(employeeId: Int, start: String, end: String, type: String, token: String) async throws {
        _ = try await send(path: "/api/darbar", query: ["action": "mark-leave"], method: "POST",
            body: ["employee_id": employeeId, "start_date": start, "end_date": end, "leave_type": type], token: token)
    }
    func onboard(pin: String, name: String, brand: String, payType: String, wage: Double?,
                 phone: String?, token: String) async throws {
        var body: [String: Any] = ["pin": pin, "name": name, "brand": brand, "pay_type": payType]
        body["monthly_salary"] = (payType == "Monthly") ? (wage.map { $0 as Any } ?? NSNull()) : NSNull()
        body["daily_rate"] = (payType == "Contract") ? (wage.map { $0 as Any } ?? NSNull()) : NSNull()
        body["phone"] = (phone?.isEmpty == false) ? phone! : NSNull()
        _ = try await send(path: "/api/darbar", query: ["action": "onboard"], method: "POST", body: body, token: token)
    }
    func dismissGhost(pin: String, token: String) async throws {
        _ = try await send(path: "/api/darbar", query: ["action": "dismiss-ghost"], method: "POST",
            body: ["pin": pin], token: token)
    }
    func fixPunch(employeeId: Int, date: String, token: String) async throws {
        _ = try await send(path: "/api/darbar", query: ["action": "fix-punch"], method: "POST",
            body: ["employee_id": employeeId, "date": date], token: token)
    }

    // MARK: photo
    nonisolated static func photoURL(pin: String?, id: Int?, token: String) -> URL? {
        guard pin != nil || id != nil else { return nil }
        var c = URLComponents(string: base); c?.path = "/api/darbar"
        var q = [URLQueryItem(name: "action", value: "photo-img")]
        if let pin, !pin.isEmpty { q.append(.init(name: "pin", value: pin)) } else if let id { q.append(.init(name: "id", value: String(id))) }
        q.append(.init(name: "t", value: token)); c?.queryItems = q
        return c?.url
    }

    // MARK: plumbing
    private func get(_ path: String, _ query: [String: String], _ token: String) async throws -> Data {
        try await send(path: path, query: query, method: "GET", body: nil, token: token)
    }

    @discardableResult
    private func send(path: String, query: [String: String], method: String,
                      body: [String: Any]?, token: String?, authError: DarbarError = .unauthorized) async throws -> Data {
        guard var c = URLComponents(string: Self.base) else { throw DarbarError.badURL }
        c.path = path
        if !query.isEmpty { c.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) } }
        guard let url = c.url else { throw DarbarError.badURL }
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.timeoutInterval = 12
        req.setValue("https://darbar.hnhotels.in", forHTTPHeaderField: "Origin")
        if let token { req.setValue(token, forHTTPHeaderField: "x-darbar-token") }
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let (data, resp) = try await URLSession.shared.data(for: req)
        if let http = resp as? HTTPURLResponse {
            if http.statusCode == 401 { throw authError }
            if !(200..<300).contains(http.statusCode) {
                let msg = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
                throw DarbarError.server(msg ?? "Darbar HTTP \(http.statusCode)")
            }
        }
        return data
    }

    static func todayIST() -> String {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.timeZone = TimeZone(identifier: "Asia/Kolkata")
        return f.string(from: Date())
    }
    static func monthIST() -> String {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM"; f.timeZone = TimeZone(identifier: "Asia/Kolkata")
        return f.string(from: Date())
    }
    static func bizDayIST() -> String {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.timeZone = TimeZone(identifier: "Asia/Kolkata")
        return f.string(from: Date().addingTimeInterval(-4 * 3600))   // day rolls at 04:00 IST
    }
}
