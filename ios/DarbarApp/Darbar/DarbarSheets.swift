import SwiftUI

// Darbar execution sheets — the real owner actions, native. Each fires a confirmed tap → live
// endpoint via the model, shows a toast, and dismisses. fin (owner) gates the money sheets.

private let accent = DarbarView.accent

// Reusable sheet chrome.
struct DSheet<Content: View>: View {
    let title: String
    var subtitle: String = ""
    @ViewBuilder var content: () -> Content
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        ZStack {
            HK.bg.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    HStack {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(title).font(.system(size: 22, weight: .heavy, design: .rounded)).foregroundStyle(HK.text)
                            if !subtitle.isEmpty { Text(subtitle).font(.system(size: 13)).foregroundStyle(HK.textDim) }
                        }
                        Spacer()
                        Button { dismiss() } label: { Image(systemName: "xmark.circle.fill").font(.system(size: 26)).foregroundStyle(HK.textFaint) }
                    }
                    content()
                }.padding(18)
            }
        }
        .presentationDetents([.medium, .large])
    }
}

struct DField<Content: View>: View {
    let label: String
    @ViewBuilder var content: () -> Content
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label.uppercased()).font(.system(size: 11, weight: .heavy)).tracking(0.4).foregroundStyle(HK.textFaint)
            content()
        }
    }
}

func dInput(_ text: Binding<String>, _ placeholder: String, numeric: Bool = false) -> some View {
    TextField(placeholder, text: text)
        .keyboardType(numeric ? .numberPad : .default)
        .font(.system(size: 16, weight: .semibold)).foregroundStyle(HK.text).tint(accent)
        .padding(12).background(HK.bgElev, in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(HK.line, lineWidth: 1))
}

func dPrimary(_ label: String, disabled: Bool = false, _ act: @escaping () -> Void) -> some View {
    Button(action: act) {
        Text(label).font(.system(size: 15, weight: .bold)).foregroundStyle(.black)
            .frame(maxWidth: .infinity).padding(.vertical, 13)
            .background(disabled ? accent.opacity(0.4) : accent, in: RoundedRectangle(cornerRadius: 12))
    }.buttonStyle(.plain).disabled(disabled)
}

// A button that ALWAYS routes a money / outward-send / irreversible action through an owner
// confirmation dialog before it fires — never a single-tap mutation. Mirrors the PWA's own
// confirms + the owner-approve rule.
struct ConfirmButton: View {
    let label: String
    var confirmTitle: String
    var confirmVerb: String
    var role: ButtonRole? = nil
    var tint: Color = accent
    var fg: Color = .black
    let action: () -> Void
    @State private var asking = false
    var body: some View {
        Button { asking = true } label: {
            Text(label).font(.system(size: 15, weight: .bold)).foregroundStyle(fg)
                .frame(maxWidth: .infinity).padding(.vertical, 13)
                .background(tint, in: RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
        .confirmationDialog(confirmTitle, isPresented: $asking, titleVisibility: .visible) {
            Button(confirmVerb, role: role) { action() }
            Button("Cancel", role: .cancel) {}
        }
    }
}

func payViaPicker(_ sel: Binding<PayVia>) -> some View {
    HStack(spacing: 6) {
        ForEach(PayVia.allCases) { v in
            let on = sel.wrappedValue == v
            Text(v.label).font(.system(size: 12.5, weight: .semibold)).foregroundStyle(on ? .black : HK.textDim)
                .frame(maxWidth: .infinity).padding(.vertical, 9)
                .background(on ? accent : HK.bgElev, in: RoundedRectangle(cornerRadius: 9))
                .overlay(RoundedRectangle(cornerRadius: 9).stroke(on ? .clear : HK.line, lineWidth: 1))
                .onTapGesture { sel.wrappedValue = v }
        }
    }
}

// MARK: - Pay advance (the named execution)

struct PayAdvanceSheet: View {
    @ObservedObject var model: DarbarAppModel
    let preset: DarbarEmployee?
    @Environment(\.dismiss) private var dismiss
    @State private var emp: DarbarEmployee?
    @State private var amount = ""
    @State private var via: PayVia = .cash
    @State private var phone = ""
    @State private var note = ""
    @State private var picking = false

    var body: some View {
        DSheet(title: "Pay an advance", subtitle: "Attendance comes up first — you never pay blind. Lands on this month.") {
            DField(label: "Who") {
                Button { picking = true } label: {
                    HStack {
                        Text(emp?.displayName ?? "Choose a person").foregroundStyle(emp == nil ? HK.textFaint : HK.text)
                            .font(.system(size: 16, weight: .semibold))
                        Spacer(); Image(systemName: "chevron.down").font(.system(size: 12, weight: .bold)).foregroundStyle(HK.textFaint)
                    }.padding(12).background(HK.bgElev, in: RoundedRectangle(cornerRadius: 10))
                     .overlay(RoundedRectangle(cornerRadius: 10).stroke(HK.line, lineWidth: 1))
                }.buttonStyle(.plain)
            }
            DField(label: "Amount ₹") { dInput($amount, "e.g. 2000", numeric: true) }
            DField(label: "📲 Receipt goes to — confirm their number") { dInput($phone, "10-digit WhatsApp number", numeric: true) }
            DField(label: "Paid via") { payViaPicker($via) }
            DField(label: "Note (optional)") { dInput($note, "reason") }
            // Money-out → owner confirm before it fires (also sends a WhatsApp receipt).
            ConfirmButton(label: "Give advance \(amount.isEmpty ? "" : inrLabel(Double(amount)))",
                          confirmTitle: "Give \(emp?.displayName ?? "")\(amount.isEmpty ? "" : " " + inrLabel(Double(amount)))? A receipt goes to their phone.",
                          confirmVerb: "Give advance") {
                guard let e = emp, let amt = Double(amount), amt > 0 else { return }
                Task { await model.recordPayment(employeeId: e.id, amount: amt, paidVia: via.rawValue,
                    phone: phone, note: note, month: model.payMonth, settlement: false); dismiss() }
            }
            .opacity(emp == nil || (Double(amount) ?? 0) <= 0 ? 0.4 : 1)
            .disabled(emp == nil || (Double(amount) ?? 0) <= 0)
        }
        .onAppear { emp = preset; phone = preset?.phone ?? "" }
        .sheet(isPresented: $picking) { EmployeePicker(model: model) { emp = $0; phone = $0.phone ?? ""; picking = false } }
    }
}

struct EmployeePicker: View {
    @ObservedObject var model: DarbarAppModel
    let pick: (DarbarEmployee) -> Void
    @State private var q = ""
    var filtered: [DarbarEmployee] {
        q.isEmpty ? model.employees : model.employees.filter { $0.displayName.localizedCaseInsensitiveContains(q) }
    }
    var body: some View {
        ZStack {
            HK.bg.ignoresSafeArea()
            VStack(spacing: 10) {
                dInput($q, "Search a name").padding(.horizontal, 16).padding(.top, 16)
                ScrollView {
                    LazyVStack(spacing: 8) {
                        ForEach(filtered) { e in
                            Button { pick(e) } label: {
                                HStack(spacing: 10) {
                                    DarbarFace(pin: e.pin, id: e.id, name: e.displayName, token: model.photoToken, size: 36)
                                    VStack(alignment: .leading, spacing: 1) {
                                        Text(e.displayName).font(.system(size: 15, weight: .semibold)).foregroundStyle(HK.text)
                                        Text("\(e.jobName ?? "") \(e.pin.map { "· PIN \($0)" } ?? "")").font(.system(size: 11.5)).foregroundStyle(HK.textDim)
                                    }
                                    Spacer(); darbarBrandChip(e.brandLabel)
                                }.padding(11).background(HK.card, in: RoundedRectangle(cornerRadius: 12))
                            }.buttonStyle(.plain)
                        }
                    }.padding(.horizontal, 16).padding(.bottom, 16)
                }
            }
        }
        .task { if model.employees.isEmpty { await model.loadRoster() } }
    }
}

// MARK: - Edit advance

struct EditAdvanceSheet: View {
    @ObservedObject var model: DarbarAppModel
    let row: AdvanceRow
    @Environment(\.dismiss) private var dismiss
    @State private var amount = ""
    @State private var via: PayVia = .cash
    @State private var month = ""
    @State private var deleting = false

    private var months: [String] {
        let cur = activeSettlementMonth()
        return Array(Set([shiftMonth(cur, by: -1), cur, row.payPeriod ?? cur, model.payMonth])).sorted()
    }
    var body: some View {
        DSheet(title: row.who, subtitle: "Edit or undo this entry. Undo is for MIS-ENTRIES only.") {
            DField(label: "Amount ₹") { dInput($amount, "amount", numeric: true) }
            DField(label: "Belongs to month") {
                HStack(spacing: 6) {
                    ForEach(months, id: \.self) { mm in
                        let on = month == mm
                        Text(monthLabel(mm)).font(.system(size: 12, weight: .semibold)).foregroundStyle(on ? .black : HK.textDim)
                            .frame(maxWidth: .infinity).padding(.vertical, 9)
                            .background(on ? accent : HK.bgElev, in: RoundedRectangle(cornerRadius: 9))
                            .lineLimit(1).minimumScaleFactor(0.7)
                            .onTapGesture { month = mm }
                    }
                }
            }
            DField(label: "Paid via") { payViaPicker($via) }
            // Editing a recorded payment → owner confirm.
            ConfirmButton(label: "Save change", confirmTitle: "Rewrite this entry to \(inrLabel(Double(amount))) · \(monthLabel(month))?", confirmVerb: "Save change") {
                guard let amt = Double(amount), amt > 0 else { return }
                Task { await model.updateAdvance(id: row.id, amount: amt, payPeriod: month, paidVia: via.rawValue); dismiss() }
            }
            .opacity((Double(amount) ?? 0) <= 0 ? 0.4 : 1).disabled((Double(amount) ?? 0) <= 0)
            // Delete: matches the PWA's explicit mis-entry confirm copy.
            Button { deleting = true } label: {
                Text("Undo this entry").font(.system(size: 14, weight: .semibold)).foregroundStyle(HK.error)
                    .frame(maxWidth: .infinity).padding(.vertical, 11)
                    .background(HK.error.opacity(0.14), in: RoundedRectangle(cornerRadius: 11))
            }.buttonStyle(.plain)
            .confirmationDialog("Remove this \(inrLabel(row.amount)) entry? This is for MIS-ENTRIES only — the money record disappears from the month.",
                                isPresented: $deleting, titleVisibility: .visible) {
                Button("Remove entry", role: .destructive) { Task { await model.deleteAdvance(id: row.id); dismiss() } }
                Button("Cancel", role: .cancel) {}
            }
        }
        .onAppear {
            amount = String(Int(row.amount ?? 0)); via = PayVia(rawValue: row.paidVia ?? "cash") ?? .cash
            month = row.payPeriod ?? model.payMonth
        }
    }
}

// MARK: - Set pay

struct SetPaySheet: View {
    @ObservedObject var model: DarbarAppModel
    let id: Int; let name: String
    @Environment(\.dismiss) private var dismiss
    @State private var type = "Contract"
    @State private var amount = ""
    var body: some View {
        DSheet(title: "\(name) — set pay", subtitle: "One number, once. Unlocks their money facts everywhere.") {
            DField(label: "Pay type") {
                HStack(spacing: 6) {
                    ForEach(["Contract", "Monthly"], id: \.self) { t in
                        let on = type == t
                        Text(t == "Contract" ? "Daily wage" : "Monthly").font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(on ? .black : HK.textDim).frame(maxWidth: .infinity).padding(.vertical, 9)
                            .background(on ? accent : HK.bgElev, in: RoundedRectangle(cornerRadius: 9))
                            .onTapGesture { type = t }
                    }
                }
            }
            DField(label: "Amount ₹ (per day / per month)") { dInput($amount, "e.g. 600", numeric: true) }
            ConfirmButton(label: "Save pay",
                          confirmTitle: "Set \(name)'s pay to \(inrLabel(Double(amount)))\(type == "Contract" ? "/day" : "/mo")? This unlocks money facts everywhere.",
                          confirmVerb: "Save pay") {
                guard let amt = Double(amount), amt > 0 else { return }
                Task { await model.setPay(employeeId: id, payType: type, amount: amt); dismiss() }
            }
            .opacity((Double(amount) ?? 0) <= 0 ? 0.4 : 1).disabled((Double(amount) ?? 0) <= 0)
        }
    }
}

// MARK: - Mark exit

struct MarkExitSheet: View {
    @ObservedObject var model: DarbarAppModel
    let id: Int; let name: String
    @Environment(\.dismiss) private var dismiss
    @State private var reason = ""
    @State private var fnf = ""
    var body: some View {
        DSheet(title: "\(name) — mark left", subtitle: "Stops counting them, archives the roster row, drafts a final settlement.") {
            DField(label: "Reason (optional)") { dInput($reason, "stopped coming / found other work") }
            DField(label: "Final settlement ₹ (optional, owner-entered)") { dInput($fnf, "leave blank to draft later", numeric: true) }
            // Irreversible (archives roster + drafts FnF) → owner confirm.
            ConfirmButton(label: "Confirm — they’ve left", confirmTitle: "Mark \(name) as left? This archives their roster row.",
                          confirmVerb: "They’ve left", role: .destructive, tint: HK.error.opacity(0.16), fg: HK.error) {
                Task { await model.markExit(employeeId: id, reason: reason, fnf: Double(fnf)); dismiss() }
            }
        }
    }
}

// MARK: - Mark leave

struct MarkLeaveSheet: View {
    @ObservedObject var model: DarbarAppModel
    let id: Int; let name: String
    @Environment(\.dismiss) private var dismiss
    @State private var from = Date()
    @State private var to = Date()
    @State private var type = "unpaid"
    private let f: DateFormatter = { let d = DateFormatter(); d.dateFormat = "yyyy-MM-dd"; d.timeZone = TimeZone(identifier: "Asia/Kolkata"); return d }()
    // PWA leave types: unpaid (LOP) | paid | sick.
    private let types: [(String, String)] = [("unpaid", "Unpaid (LOP)"), ("paid", "Paid"), ("sick", "Sick")]
    var body: some View {
        DSheet(title: "\(name) — on leave", subtitle: "Marks the range as leave; suppresses alerts and feeds payroll.") {
            DatePicker("From", selection: $from, displayedComponents: .date).tint(accent).foregroundStyle(HK.text)
            DatePicker("To", selection: $to, displayedComponents: .date).tint(accent).foregroundStyle(HK.text)
            DField(label: "Type") {
                HStack(spacing: 6) {
                    ForEach(types, id: \.0) { t in
                        let on = type == t.0
                        Text(t.1).font(.system(size: 12.5, weight: .semibold)).foregroundStyle(on ? .black : HK.textDim)
                            .frame(maxWidth: .infinity).padding(.vertical, 9).lineLimit(1).minimumScaleFactor(0.7)
                            .background(on ? accent : HK.bgElev, in: RoundedRectangle(cornerRadius: 9)).onTapGesture { type = t.0 }
                    }
                }
            }
            ConfirmButton(label: "Save leave", confirmTitle: "Record \(type) leave for \(name) from \(f.string(from: from)) to \(f.string(from: to))?", confirmVerb: "Save leave") {
                Task { await model.markLeave(employeeId: id, start: f.string(from: from), end: f.string(from: to), type: type); dismiss() }
            }
        }
    }
}

// MARK: - Onboard a ghost

struct OnboardSheet: View {
    @ObservedObject var model: DarbarAppModel
    let pin: String; let deviceName: String
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var brand = "HE"
    @State private var payType = "Contract"
    @State private var wage = ""
    @State private var phone = ""

    var body: some View {
        DSheet(title: "Name PIN \(pin)", subtitle: "Turn this working ghost into a roster member. Attendance counts from their first punch.") {
            // The device face on file (CAMS) — confirms you're naming the right person.
            HStack {
                Spacer()
                DarbarFace(pin: pin, id: nil, name: name.isEmpty ? deviceName : name, token: model.photoToken, size: 88)
                Spacer()
            }
            DField(label: "Name") { dInput($name, deviceName.isEmpty ? "their name" : deviceName) }
            DField(label: "Brand") {
                HStack(spacing: 6) {
                    ForEach(["NCH", "HE", "HQ"], id: \.self) { b in
                        let on = brand == b
                        Text(b).font(.system(size: 13, weight: .semibold)).foregroundStyle(on ? .black : HK.textDim)
                            .frame(maxWidth: .infinity).padding(.vertical, 9)
                            .background(on ? accent : HK.bgElev, in: RoundedRectangle(cornerRadius: 9)).onTapGesture { brand = b }
                    }
                }
            }
            DField(label: "Pay type") {
                HStack(spacing: 6) {
                    ForEach([("Contract", "Daily wage"), ("Monthly", "Monthly")], id: \.0) { t in
                        let on = payType == t.0
                        Text(t.1).font(.system(size: 13, weight: .semibold)).foregroundStyle(on ? .black : HK.textDim)
                            .frame(maxWidth: .infinity).padding(.vertical, 9)
                            .background(on ? accent : HK.bgElev, in: RoundedRectangle(cornerRadius: 9)).onTapGesture { payType = t.0 }
                    }
                }
            }
            DField(label: payType == "Monthly" ? "Monthly ₹ (optional)" : "Daily rate ₹ (optional)") { dInput($wage, "leave blank to set later", numeric: true) }
            DField(label: "Phone (for punch-reminders, optional)") { dInput($phone, "10-digit", numeric: true) }
            ConfirmButton(label: "Add to roster",
                          confirmTitle: "Add \(name.isEmpty ? deviceName : name) (PIN \(pin)) to the \(brand) roster?",
                          confirmVerb: "Add to roster") {
                Task { await model.onboard(pin: pin, name: name.isEmpty ? deviceName : name, brand: brand,
                    payType: payType, wage: Double(wage), phone: phone); dismiss() }
            }
            .opacity(name.isEmpty && deviceName.isEmpty ? 0.4 : 1).disabled(name.isEmpty && deviceName.isEmpty)
        }
    }
}

// MARK: - Settle / Advance (the full per-person money view, 1:1 with the PWA loadPayCtx)
// Lanes: 1·Attendance calendar grid · 2·Advances trail · 3·Settled trail · ≈Rough-left ·
// payment entry form (amount/phone/via/note) · Over-write · Mark left. Month chips switch month.

struct SettleSheet: View {
    @ObservedObject var model: DarbarAppModel
    let id: Int; let name: String
    var mode: String = "settle"           // settle | advance
    @Binding var sheet: DarbarSheet?
    @Environment(\.dismiss) private var dismiss

    @State private var ctx: SettleContext?
    @State private var loading = true
    @State private var month = ""
    @State private var faceTrail = ""
    // entry form
    @State private var amount = ""
    @State private var via: PayVia = .cash
    @State private var phone = ""
    @State private var note = ""
    @State private var editing: AdvanceRow?

    private var monthChips: [String] {
        Array(Set([shiftMonth(activeSettlementMonth(), by: -1), String(DarbarClient.todayIST().prefix(7)), month])).sorted()
    }

    var body: some View {
        DSheet(title: name, subtitle: mode == "settle" ? "Their month: attendance, advances, settled." : "Attendance first — you never pay blind.") {
            if loading {
                ProgressView().tint(accent).frame(maxWidth: .infinity).padding(.vertical, 30)
            } else if let c = ctx, let e = c.employee {
                if !faceTrail.isEmpty {
                    Text(faceTrail).font(.system(size: 11)).foregroundStyle(HK.textFaint)
                }
                if e.payLane == "daily" {
                    Text("DAILY LANE — paid day by day, separate from the monthly salary cycle.")
                        .font(.system(size: 11.5, weight: .semibold)).foregroundStyle(accent)
                        .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                        .background(accent.opacity(0.12), in: RoundedRectangle(cornerRadius: 10))
                }
                monthChipRow
                attendanceLane(c.attendance)
                lane("2 · Advances given — \(monthLabel(month))", total: c.advances?.total, rows: c.advances?.rows ?? [])
                lane("3 · Settled", total: c.settlements?.total, rows: c.settlements?.rows ?? [])
                roughLeft(e, c)
                entryForm(e)
                ownerActions(e)
            } else {
                Text(ctx?.error ?? "Couldn’t load — close and retry.").font(.system(size: 13)).foregroundStyle(HK.error)
            }
        }
        .task {
            month = mode == "settle" ? model.payMonth : String(DarbarClient.todayIST().prefix(7))
            await reload()
            if let e = ctx?.employee {
                if let pm = await model.photoMeta(pin: e.pin, id: e.id) {
                    if let cnt = pm.count, cnt > 0 {
                        faceTrail = "📷 face on file" + (cnt > 1 ? " · \(cnt) versions" : "") + (pm.latest.map { " · updated \($0.prefix(10))" } ?? "")
                    } else { faceTrail = "📷 no face enrolled yet" }
                }
            }
        }
        .sheet(item: $editing) { r in EditAdvanceSheet(model: model, row: r) }
    }

    private func reload() async {
        loading = true
        ctx = await model.settleContext(employeeId: id, month: month)
        phone = ctx?.employee?.phone ?? phone
        loading = false
    }

    private var monthChipRow: some View {
        HStack(spacing: 6) {
            ForEach(monthChips, id: \.self) { mm in
                let on = month == mm
                Text(monthLabel(mm) + (mm == String(DarbarClient.todayIST().prefix(7)) ? " · live" : ""))
                    .font(.system(size: 11.5, weight: .semibold)).foregroundStyle(on ? .black : HK.textDim)
                    .padding(.horizontal, 10).padding(.vertical, 7).lineLimit(1).minimumScaleFactor(0.7)
                    .background(on ? accent : HK.bgElev, in: Capsule())
                    .onTapGesture { month = mm; Task { await reload() } }
            }
            Spacer()
        }
    }

    private func attendanceLane(_ a: SettleAttendance?) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("1 · Attendance — \(monthLabel(month))").font(.system(size: 12.5, weight: .heavy)).foregroundStyle(HK.text)
            AttendanceGrid(month: month, days: a?.days ?? [])
            HStack(spacing: 6) {
                pill("worked \(a?.present ?? 0)", HK.ready)
                if (a?.irregular ?? 0) > 0 { pill("punch missing \(a?.irregular ?? 0)", HK.running) }
                pill("absent \(a?.absent ?? 0)", (a?.absent ?? 0) > 0 ? HK.error : HK.textFaint)
                if (a?.off ?? 0) > 0 { pill("off \(a?.off ?? 0)", Color(hex: 0xA78BFA)) }
            }
        }
        .padding(13).frame(maxWidth: .infinity, alignment: .leading)
        .background(HK.card, in: RoundedRectangle(cornerRadius: HK.radius))
        .overlay(RoundedRectangle(cornerRadius: HK.radius).stroke(HK.line, lineWidth: 1))
    }

    private func lane(_ title: String, total: Double?, rows: [AdvanceRow]) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack {
                Text(title).font(.system(size: 12.5, weight: .heavy)).foregroundStyle(HK.text)
                Spacer()
                Text(inrLabel(total)).font(.system(size: 14, weight: .heavy, design: .rounded)).foregroundStyle(accent).monospacedDigit()
            }
            if rows.isEmpty {
                Text("none").font(.system(size: 12)).foregroundStyle(HK.textFaint)
            } else {
                ForEach(rows) { r in
                    HStack(spacing: 8) {
                        Text(inrLabel(r.amount)).font(.system(size: 13.5, weight: .bold)).foregroundStyle(HK.text).monospacedDigit()
                        Spacer()
                        Text("\(r.advanceDate?.prefix(10) ?? "") · \(PayVia(rawValue: r.paidVia ?? "")?.label ?? r.paidVia ?? "")\(receiptMark(r))")
                            .font(.system(size: 11.5)).foregroundStyle(HK.textDim)
                        Button { editing = r } label: { Image(systemName: "pencil").font(.system(size: 12, weight: .bold)).foregroundStyle(accent) }.buttonStyle(.plain)
                    }.padding(.vertical, 4).overlay(Divider().background(HK.lineSoft), alignment: .bottom)
                }
            }
        }
        .padding(13).frame(maxWidth: .infinity, alignment: .leading)
        .background(HK.card, in: RoundedRectangle(cornerRadius: HK.radius))
        .overlay(RoundedRectangle(cornerRadius: HK.radius).stroke(HK.line, lineWidth: 1))
    }
    private func receiptMark(_ r: AdvanceRow) -> String {
        switch r.receiptStatus { case "sent": return " ✓"; case "failed": return " ✗"; case "no_phone": return " (no phone)"; default: return "" }
    }

    @ViewBuilder private func roughLeft(_ e: SettleEmployee, _ c: SettleContext) -> some View {
        let eb = darbarEstBand(payType: e.payType, monthlySalary: e.monthlySalary, dailyRate: e.dailyRate,
                               daysWorked: c.attendance?.present ?? 0, startDate: e.startDate,
                               presenceConfirmed: e.presenceConfirmed, trackAttendance: e.trackAttendance,
                               isActive: e.isActive, payLane: e.payLane, month: month)
        if eb.lo != nil {
            let given = (c.advances?.total ?? 0) + (c.settlements?.total ?? 0)
            VStack(alignment: .leading, spacing: 5) {
                HStack {
                    Text("≈ Rough left — \(monthLabel(month))").font(.system(size: 12.5, weight: .heavy)).foregroundStyle(HK.text)
                    Spacer()
                    Text(darbarLeftBand(eb, given: given)).font(.system(size: 15, weight: .heavy, design: .rounded)).foregroundStyle(accent)
                }
                Text("approximation from their window (\(eb.flag.map { "⚠ \($0) — " } ?? "")attendance is a guide, not gospel) · your number below is what counts")
                    .font(.system(size: 11)).foregroundStyle(HK.textDim)
            }
            .padding(13).frame(maxWidth: .infinity, alignment: .leading)
            .background(accent.opacity(0.08), in: RoundedRectangle(cornerRadius: HK.radius))
            .overlay(RoundedRectangle(cornerRadius: HK.radius).stroke(accent.opacity(0.5), lineWidth: 1))
        }
    }

    private func entryForm(_ e: SettleEmployee) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            DField(label: mode == "settle" ? "You paid ₹ — your number" : "Advance amount ₹") { dInput($amount, "your number", numeric: true) }
            DField(label: "📲 Receipt goes to — confirm \(name)’s number") { dInput($phone, "10-digit WhatsApp number", numeric: true) }
            DField(label: "Paid via") { payViaPicker($via) }
            DField(label: "Note (optional)") { dInput($note, mode == "settle" ? "final settlement / partial" : "reason") }
            ConfirmButton(label: (mode == "settle" ? "Record settlement" : "Give advance") + " — \(monthLabel(month))",
                          confirmTitle: "\(mode == "settle" ? "Settle" : "Advance") \(inrLabel(Double(amount))) to \(name) for \(monthLabel(month))? A receipt goes to their phone.",
                          confirmVerb: mode == "settle" ? "Record settlement" : "Give advance") {
                guard let amt = Double(amount), amt > 0 else { return }
                Task {
                    await model.recordPayment(employeeId: id, amount: amt, paidVia: via.rawValue, phone: phone,
                        note: note, month: month, settlement: mode == "settle")
                    dismiss()
                }
            }
            .opacity((Double(amount) ?? 0) <= 0 ? 0.4 : 1).disabled((Double(amount) ?? 0) <= 0)
        }
    }

    @ViewBuilder private func ownerActions(_ e: SettleEmployee) -> some View {
        if model.fin {
            HStack(spacing: 8) {
                Button { sheet = .salaryOverride(id: id, name: name) } label: {
                    Text("Over-write").font(.system(size: 13, weight: .semibold)).foregroundStyle(HK.textDim)
                        .frame(maxWidth: .infinity).padding(.vertical, 10)
                        .background(HK.bgElev, in: RoundedRectangle(cornerRadius: 10))
                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(HK.line, lineWidth: 1))
                }.buttonStyle(.plain)
                Button { sheet = .exit(id: id, name: name) } label: {
                    Text("Mark left").font(.system(size: 13, weight: .semibold)).foregroundStyle(HK.error)
                        .frame(maxWidth: .infinity).padding(.vertical, 10)
                        .background(HK.error.opacity(0.14), in: RoundedRectangle(cornerRadius: 10))
                }.buttonStyle(.plain)
            }
        }
    }

    private func pill(_ s: String, _ c: Color) -> some View {
        Text(s).font(.system(size: 9.5, weight: .heavy)).foregroundStyle(c)
            .padding(.horizontal, 7).padding(.vertical, 3).background(c.opacity(0.16), in: Capsule())
    }
}

// The monthly attendance calendar (7×6) — one numbered cell per day, status-coloured.
struct AttendanceGrid: View {
    let month: String
    let days: [SettleDay]
    private let cols = Array(repeating: GridItem(.flexible(), spacing: 4), count: 7)
    private let purple = Color(hex: 0xA78BFA)

    var body: some View {
        let map = Dictionary(days.compactMap { d in d.date.map { ($0, d) } }, uniquingKeysWith: { a, _ in a })
        let parts = month.split(separator: "-").compactMap { Int($0) }
        let y = parts.first ?? 2026, m = parts.count > 1 ? parts[1] : 1
        let nDays = daysInMonth(y: y, m: m)
        let firstDow = firstWeekday(y: y, m: m)
        let biz = DarbarClient.bizDayIST()
        VStack(spacing: 4) {
            HStack(spacing: 4) {
                ForEach(Array(["S","M","T","W","T","F","S"].enumerated()), id: \.offset) { _, w in
                    Text(w).font(.system(size: 9, weight: .heavy)).foregroundStyle(HK.textFaint).frame(maxWidth: .infinity)
                }
            }
            LazyVGrid(columns: cols, spacing: 4) {
                ForEach(0..<firstDow, id: \.self) { _ in Color.clear.frame(height: 30) }
                ForEach(1...max(1, nDays), id: \.self) { d in
                    let ds = "\(month)-" + String(format: "%02d", d)
                    cell(d: d, ds: ds, r: map[ds], biz: biz)
                }
            }
        }
    }
    private func cell(d: Int, ds: String, r: SettleDay?, biz: String) -> some View {
        let (bg, fg, dashed) = style(ds: ds, r: r, biz: biz)
        return VStack(spacing: 1) {
            Text("\(d)").font(.system(size: 11, weight: .bold)).foregroundStyle(fg)
            if let r, let h = r.totalHours, h > 0 { Text("\(Int(h))h").font(.system(size: 7.5)).foregroundStyle(fg.opacity(0.8)) }
        }
        .frame(maxWidth: .infinity).frame(height: 30)
        .background(bg, in: RoundedRectangle(cornerRadius: 6))
        .overlay(RoundedRectangle(cornerRadius: 6).stroke(dashed ? HK.line : .clear, style: StrokeStyle(lineWidth: 1, dash: [3])))
    }
    private func style(ds: String, r: SettleDay?, biz: String) -> (Color, Color, Bool) {
        let purple = Color(hex: 0xA78BFA)
        if ds > biz { return (.clear, HK.textFaint, true) }                                   // future
        if ds == biz { return (DarbarView.accent.opacity(0.25), HK.text, false) }             // open today
        guard let r else { return (HK.bgElev, HK.textFaint, false) }                          // nodata
        let st = r.status?.lowercased()
        if st == "week_off" || st == "leave" { return (purple.opacity(0.22), purple, false) } // off
        let pc = r.punchCount ?? 0
        if pc == 0 { return (HK.error.opacity(0.18), HK.error, false) }                       // absent
        if pc % 2 == 1 { return (HK.running.opacity(0.22), HK.running, false) }               // punch missing
        return (HK.ready.opacity(0.20), HK.ready, false)                                      // worked
    }
    private func firstWeekday(y: Int, m: Int) -> Int {
        var c = DateComponents(); c.year = y; c.month = m; c.day = 1
        var cal = Calendar(identifier: .gregorian); cal.timeZone = TimeZone(identifier: "Asia/Kolkata")!
        if let d = cal.date(from: c) { return cal.component(.weekday, from: d) - 1 }  // 0=Sun
        return 0
    }
}

// MARK: - Salary over-write (owner-only)

struct SalaryOverrideSheet: View {
    @ObservedObject var model: DarbarAppModel
    let id: Int; let name: String
    @Environment(\.dismiss) private var dismiss
    @State private var period = activeSettlementMonth()
    @State private var amount = ""
    @State private var note = ""
    private var periods: [String] {
        let cur = activeSettlementMonth()
        return [shiftMonth(cur, by: -1), cur, String(DarbarClient.todayIST().prefix(7))].reduce(into: [String]()) { if !$0.contains($1) { $0.append($1) } }
    }
    var body: some View {
        DSheet(title: "\(name) — over-write pay", subtitle: "Set the final payable yourself when attendance is gappy. Recorded alongside the computed figure, never silently replacing it.") {
            DField(label: "Pay period") {
                HStack(spacing: 6) {
                    ForEach(periods, id: \.self) { p in
                        let on = period == p
                        Text(monthLabel(p)).font(.system(size: 12, weight: .semibold)).foregroundStyle(on ? .black : HK.textDim)
                            .frame(maxWidth: .infinity).padding(.vertical, 9).lineLimit(1).minimumScaleFactor(0.7)
                            .background(on ? accent : HK.bgElev, in: RoundedRectangle(cornerRadius: 9)).onTapGesture { period = p }
                    }
                }
            }
            DField(label: "Final payable ₹") { dInput($amount, "you type the number", numeric: true) }
            DField(label: "Why (optional)") { dInput($note, "retention bonus / OT / gappy attendance") }
            ConfirmButton(label: "Save over-write",
                          confirmTitle: "Over-write \(name)’s \(monthLabel(period)) payable to \(inrLabel(Double(amount)))? Recorded alongside the computed figure.",
                          confirmVerb: "Save over-write") {
                guard let amt = Double(amount), amt > 0 else { return }
                Task { await model.salaryOverride(employeeId: id, payPeriod: period, amount: amt, note: note); dismiss() }
            }
            .opacity((Double(amount) ?? 0) <= 0 ? 0.4 : 1).disabled((Double(amount) ?? 0) <= 0)
        }
    }
}

// MARK: - Month board (who's done, who's left — facts only)

struct MonthBoardSheet: View {
    @ObservedObject var model: DarbarAppModel
    @Binding var sheet: DarbarSheet?
    @Environment(\.dismiss) private var dismiss
    private let purple = Color(hex: 0xA78BFA)

    private var month: String { model.payMonth }
    private var rows: [MonthBoardRow] { model.boardFiltered.filter { $0.payLane != "daily" } }
    private var daily: [MonthBoardRow] { model.boardFiltered.filter { $0.payLane == "daily" } }

    // Exact paid + a rough pending RANGE (each person's real window minus advances), PWA-faithful.
    private var paid: Double { model.boardFiltered.reduce(0) { $0 + ($1.advances ?? 0) + ($1.settled ?? 0) } }
    private func band(for r: MonthBoardRow) -> EstBand {
        darbarEstBand(payType: r.payType, monthlySalary: r.monthlySalary, dailyRate: r.dailyRate,
                      daysWorked: r.daysWorked ?? 0, startDate: r.startDate, presenceConfirmed: r.presenceConfirmed,
                      trackAttendance: r.trackAttendance, isActive: r.isActive, payLane: r.payLane, month: month)
    }
    private var pending: (lo: Double, hi: Double, skipped: [String]) {
        var lo = 0.0, hi = 0.0; var skipped: [String] = []
        for r in rows {
            if (r.settled ?? 0) > 0 { continue }
            let e = band(for: r)
            guard let l = e.lo, let h = e.hi else { if e.why != "left" { skipped.append("\(r.name ?? "?") (\(e.why ?? "?"))") }; continue }
            lo += max(0, l - (r.advances ?? 0)); hi += max(0, h - (r.advances ?? 0))
        }
        return (lo, hi, skipped)
    }

    var body: some View {
        DSheet(title: "\(monthLabel(month)) — board", subtitle: "Paid is exact · pending is a range, never a verdict.") {
            if model.loadingBoard && model.board.isEmpty {
                ProgressView().tint(accent).frame(maxWidth: .infinity).padding(.vertical, 30)
            } else if model.board.isEmpty {
                Text("No board data for this month.").font(.system(size: 13)).foregroundStyle(HK.textFaint)
            } else {
                summary
                let done = rows.filter { ($0.settled ?? 0) > 0 }.count
                Text("\(done)/\(rows.count) settled · tap a row — facts come up, you decide")
                    .font(.system(size: 11.5, weight: .semibold)).foregroundStyle(HK.textDim)
                ForEach(rows) { r in boardRow(r, daily: false) }
                if !daily.isEmpty {
                    Text("Daily lane — paid day by day, separate from the monthly cycle\(dailyGiven > 0 ? " · \(inrLabel(dailyGiven)) given" : "")")
                        .font(.system(size: 11.5, weight: .semibold)).foregroundStyle(accent).padding(.top, 6)
                    ForEach(daily) { r in boardRow(r, daily: true) }
                }
            }
        }
        .task { await model.loadBoard() }
    }
    private var dailyGiven: Double { daily.reduce(0) { $0 + ($1.advances ?? 0) + ($1.settled ?? 0) } }

    private var summary: some View {
        let p = pending
        return VStack(alignment: .leading, spacing: 7) {
            HStack { Text("paid for \(monthLabel(month))").font(.system(size: 11, weight: .semibold)).foregroundStyle(HK.textDim); Spacer()
                Text(inrLabel(paid)).font(.system(size: 18, weight: .heavy, design: .rounded)).foregroundStyle(HK.text) }
            HStack { Text("left to pay (rough)").font(.system(size: 11, weight: .semibold)).foregroundStyle(HK.textDim); Spacer()
                Text(p.lo == p.hi ? "≈ \(inrLabel(p.lo))" : "≈ \(inrLabel(p.lo)) – \(inrLabel(p.hi))").font(.system(size: 16, weight: .heavy, design: .rounded)).foregroundStyle(accent) }
            Text("paid is exact · pending is a range from each person’s real window, minus advances · not-punching people are flagged, never zeroed" + (p.skipped.isEmpty ? "" : "\nnot counted: " + p.skipped.joined(separator: ", ")))
                .font(.system(size: 10.5)).foregroundStyle(HK.textFaint)
        }
        .padding(13).frame(maxWidth: .infinity, alignment: .leading)
        .background(accent.opacity(0.08), in: RoundedRectangle(cornerRadius: HK.radius))
        .overlay(RoundedRectangle(cornerRadius: HK.radius).stroke(accent.opacity(0.4), lineWidth: 1))
    }

    private func boardRow(_ r: MonthBoardRow, daily: Bool) -> some View {
        Button {
            dismiss()
            sheet = .settle(id: r.id, name: r.name ?? "—", mode: daily ? "advance" : "settle")
        } label: {
            HStack(spacing: 10) {
                DarbarFace(pin: r.pin, id: r.id, name: r.name ?? "—", token: model.photoToken, size: 36)
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(r.name ?? "—").font(.system(size: 14, weight: .semibold)).foregroundStyle(HK.text).lineLimit(1)
                        darbarBrandChip(r.brand)
                        if daily { Text("daily").font(.system(size: 8.5, weight: .heavy)).foregroundStyle(accent).padding(.horizontal, 5).padding(.vertical, 2).background(accent.opacity(0.16), in: Capsule()) }
                        if r.isActive == 0 { Text("left").font(.system(size: 8.5, weight: .heavy)).foregroundStyle(HK.textFaint).padding(.horizontal, 5).padding(.vertical, 2).background(HK.bgElev, in: Capsule()) }
                    }
                    Text(meta(r, daily: daily)).font(.system(size: 11)).foregroundStyle(HK.textDim).lineLimit(2)
                }
                Spacer()
                statusChip(r)
            }
            .padding(11).background(HK.card, in: RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(HK.line, lineWidth: 1))
        }.buttonStyle(.plain)
    }
    private func meta(_ r: MonthBoardRow, daily: Bool) -> String {
        if daily {
            let rate = (r.dailyRate ?? 0) > 0 ? "\(inrLabel(r.dailyRate))/day · " : "paid via team line · "
            return rate + "given \(inrLabel((r.advances ?? 0) + (r.settled ?? 0))) this month"
        }
        var s = "worked \(r.daysWorked ?? 0)d"
        if let de = r.daysError, de > 0 { s += " · \(de) punch-missing" }
        s += " · adv \(inrLabel(r.advances))"
        if (r.settled ?? 0) <= 0 {
            let e = band(for: r)
            if e.lo != nil { s += " · left \(darbarLeftBand(e, given: r.advances ?? 0))" + (e.flag.map { " ⚠ \($0)" } ?? "") }
        }
        return s
    }
    @ViewBuilder private func statusChip(_ r: MonthBoardRow) -> some View {
        if (r.settled ?? 0) > 0 {
            Text("✓ \(inrLabel(r.settled))").font(.system(size: 10, weight: .heavy)).foregroundStyle(HK.ready)
                .padding(.horizontal, 7).padding(.vertical, 3).background(HK.ready.opacity(0.16), in: Capsule())
        } else if (r.advances ?? 0) > 0 {
            Text("adv \(inrLabel(r.advances))").font(.system(size: 10, weight: .heavy)).foregroundStyle(accent)
                .padding(.horizontal, 7).padding(.vertical, 3).background(accent.opacity(0.16), in: Capsule())
        } else {
            Text("nothing yet").font(.system(size: 10, weight: .heavy)).foregroundStyle(HK.textFaint)
                .padding(.horizontal, 7).padding(.vertical, 3).background(HK.bgElev, in: Capsule())
        }
    }
}

// MARK: - Account / settings

struct AccountSheet: View {
    @ObservedObject var model: DarbarAppModel
    @Environment(\.dismiss) private var dismiss
    private let green = HK.ready, red = HK.error, purple = Color(hex: 0xA78BFA)

    var body: some View {
        let h = model.home?.health
        DSheet(title: "Account", subtitle: "\(model.user ?? "—") · \(model.fin ? "owner" : "manager")") {
            statusRow("🪪", "CAMS device", "biometric punch feed", camsChip(h))
            statusRow("💬", "WhatsApp · HE", "staff nudges + receipts", chip("live", green))
            statusRow("💬", "WhatsApp · NCH", "token blocked → SMS fallback", chip("blocked", red))
            statusRow("👻", "Ghost PINs", "working, unnamed", chip("\(h?.ghostCount ?? 0)", purple))
            Button { dismiss() } label: {
                Text("Sign out").font(.system(size: 14, weight: .semibold)).foregroundStyle(HK.textDim)
                    .frame(maxWidth: .infinity).padding(.vertical, 12)
                    .background(HK.bgElev, in: RoundedRectangle(cornerRadius: 11))
                    .overlay(RoundedRectangle(cornerRadius: 11).stroke(HK.line, lineWidth: 1))
            }.buttonStyle(.plain)
            Text("Darbar · the full retinue serving the realm")
                .font(.system(size: 11)).italic().foregroundStyle(accent.opacity(0.55))
                .frame(maxWidth: .infinity).padding(.top, 8)
        }
    }
    private func camsChip(_ h: DarbarHealth?) -> some View {
        let age = h?.camsLastPunchAgeMin
        if h?.camsOk == true {
            if let a = age, a > 90 { return chip("lull · \(a)m", HK.textDim) }
            return chip("live · \(age ?? 0)m", HK.ready)
        }
        return chip("silent \(age.map(String.init) ?? "?")m", HK.error)
    }
    private func statusRow(_ icon: String, _ title: String, _ sub: String, _ trailing: some View) -> some View {
        HStack(spacing: 11) {
            Text(icon).font(.system(size: 18))
            VStack(alignment: .leading, spacing: 1) {
                Text(title).font(.system(size: 14, weight: .semibold)).foregroundStyle(HK.text)
                Text(sub).font(.system(size: 11.5)).foregroundStyle(HK.textDim)
            }
            Spacer()
            trailing
        }
        .padding(12).background(HK.card, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(HK.line, lineWidth: 1))
    }
    private func chip(_ s: String, _ c: Color) -> some View {
        Text(s).font(.system(size: 10.5, weight: .heavy)).foregroundStyle(c)
            .padding(.horizontal, 8).padding(.vertical, 4).background(c.opacity(0.16), in: Capsule())
    }
}
