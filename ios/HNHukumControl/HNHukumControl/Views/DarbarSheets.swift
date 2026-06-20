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
    @State private var picking = false

    var body: some View {
        DSheet(title: "Pay an advance", subtitle: "Records against this month's settlement.") {
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
            DField(label: "Paid via") { payViaPicker($via) }
            DField(label: "Confirm phone (optional)") { dInput($phone, "for the receipt") }
            dPrimary("Pay \(amount.isEmpty ? "" : inrLabel(Double(amount)))", disabled: emp == nil || (Double(amount) ?? 0) <= 0) {
                guard let e = emp, let amt = Double(amount), amt > 0 else { return }
                Task { await model.recordAdvance(employeeId: e.id, amount: amt, paidVia: via.rawValue, phone: phone); dismiss() }
            }
        }
        .onAppear { emp = preset }
        .sheet(isPresented: $picking) { EmployeePicker(model: model) { emp = $0; picking = false } }
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
    var body: some View {
        DSheet(title: row.who, subtitle: "Edit or undo this advance.") {
            DField(label: "Amount ₹") { dInput($amount, "amount", numeric: true) }
            DField(label: "Paid via") { payViaPicker($via) }
            dPrimary("Save change", disabled: (Double(amount) ?? 0) <= 0) {
                guard let amt = Double(amount), amt > 0 else { return }
                Task { await model.updateAdvance(id: row.id, amount: amt, paidVia: via.rawValue); dismiss() }
            }
            Button { Task { await model.deleteAdvance(id: row.id); dismiss() } } label: {
                Text("Undo this advance").font(.system(size: 14, weight: .semibold)).foregroundStyle(HK.error)
                    .frame(maxWidth: .infinity).padding(.vertical, 11)
                    .background(HK.error.opacity(0.14), in: RoundedRectangle(cornerRadius: 11))
            }.buttonStyle(.plain)
        }
        .onAppear { amount = String(Int(row.amount ?? 0)); via = PayVia(rawValue: row.paidVia ?? "cash") ?? .cash }
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
            dPrimary("Save pay", disabled: (Double(amount) ?? 0) <= 0) {
                guard let amt = Double(amount), amt > 0 else { return }
                Task { await model.setPay(employeeId: id, payType: type, amount: amt); dismiss() }
            }
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
        DSheet(title: "\(name) — mark left", subtitle: "Removes them from the active roster.") {
            DField(label: "Reason (optional)") { dInput($reason, "left / absconded / terminated") }
            DField(label: "Full & final ₹ (optional)") { dInput($fnf, "settlement amount", numeric: true) }
            Button { Task { await model.markExit(employeeId: id, reason: reason, fnf: Double(fnf)); dismiss() } } label: {
                Text("Save — mark left").font(.system(size: 15, weight: .bold)).foregroundStyle(HK.error)
                    .frame(maxWidth: .infinity).padding(.vertical, 13)
                    .background(HK.error.opacity(0.16), in: RoundedRectangle(cornerRadius: 12))
            }.buttonStyle(.plain)
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
    @State private var type = "casual"
    private let f: DateFormatter = { let d = DateFormatter(); d.dateFormat = "yyyy-MM-dd"; d.timeZone = TimeZone(identifier: "Asia/Kolkata"); return d }()
    var body: some View {
        DSheet(title: "\(name) — on leave") {
            DatePicker("From", selection: $from, displayedComponents: .date).tint(accent).foregroundStyle(HK.text)
            DatePicker("To", selection: $to, displayedComponents: .date).tint(accent).foregroundStyle(HK.text)
            DField(label: "Type") {
                HStack(spacing: 6) {
                    ForEach(["casual", "sick", "unpaid"], id: \.self) { t in
                        let on = type == t
                        Text(t.capitalized).font(.system(size: 13, weight: .semibold)).foregroundStyle(on ? .black : HK.textDim)
                            .frame(maxWidth: .infinity).padding(.vertical, 9)
                            .background(on ? accent : HK.bgElev, in: RoundedRectangle(cornerRadius: 9)).onTapGesture { type = t }
                    }
                }
            }
            dPrimary("Save leave") { Task { await model.markLeave(employeeId: id, start: f.string(from: from), end: f.string(from: to), type: type); dismiss() } }
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
    var body: some View {
        DSheet(title: "Name PIN \(pin)", subtitle: "Turn this working ghost into a roster member. Attendance counts from their first punch.") {
            DField(label: "Name") { dInput($name, deviceName.isEmpty ? "their name" : deviceName) }
            DField(label: "Brand") {
                HStack(spacing: 6) {
                    ForEach(["HE", "NCH", "HQ"], id: \.self) { b in
                        let on = brand == b
                        Text(b).font(.system(size: 13, weight: .semibold)).foregroundStyle(on ? .black : HK.textDim)
                            .frame(maxWidth: .infinity).padding(.vertical, 9)
                            .background(on ? accent : HK.bgElev, in: RoundedRectangle(cornerRadius: 9)).onTapGesture { brand = b }
                    }
                }
            }
            dPrimary("Add to roster", disabled: name.isEmpty && deviceName.isEmpty) {
                Task { await model.onboard(pin: pin, name: name.isEmpty ? deviceName : name, brand: brand); dismiss() }
            }
        }
    }
}

// MARK: - Settle (per-person money view: attendance + advances)

struct SettleSheet: View {
    @ObservedObject var model: DarbarAppModel
    let id: Int; let name: String
    @Environment(\.dismiss) private var dismiss
    @State private var ctx: SettleContext?
    @State private var loading = true
    @State private var showAdvance = false

    var body: some View {
        DSheet(title: name, subtitle: model.payMonth) {
            if loading {
                ProgressView().tint(accent).frame(maxWidth: .infinity).padding(.vertical, 30)
            } else if let c = ctx, let e = c.employee {
                payHeader(e, c.attendance)
                if let adv = c.advances, !(adv.rows ?? []).isEmpty {
                    sectionLabel("ADVANCES THIS MONTH", trailing: inrLabel(adv.total), trailingColor: accent)
                    ForEach(adv.rows ?? []) { r in
                        HStack {
                            Text(inrLabel(r.amount)).font(.system(size: 14, weight: .bold)).foregroundStyle(HK.text).monospacedDigit()
                            Spacer()
                            Text("\(r.advanceDate?.prefix(10) ?? "") · \(PayVia(rawValue: r.paidVia ?? "")?.label ?? "")").font(.system(size: 12)).foregroundStyle(HK.textDim)
                        }.padding(.vertical, 6).overlay(Divider().background(HK.lineSoft), alignment: .bottom)
                    }
                } else {
                    Text("No advances this month.").font(.system(size: 13)).foregroundStyle(HK.textFaint)
                }
                dPrimary("Pay an advance") { showAdvance = true }
            } else {
                Text("Couldn't load — pull to retry.").font(.system(size: 13)).foregroundStyle(HK.error)
            }
        }
        .task { ctx = await model.settleContext(employeeId: id); loading = false }
        .sheet(isPresented: $showAdvance) {
            PayAdvanceSheet(model: model, preset: model.employees.first { $0.id == id })
        }
    }

    private func payHeader(_ e: SettleEmployee, _ a: SettleAttendance?) -> some View {
        VStack(spacing: 10) {
            HStack(spacing: 12) {
                metric("Worked", a?.present, HK.ready)
                metric("Irregular", a?.irregular, HK.running)
                metric("Absent", a?.absent, HK.error)
                metric("Off", a?.off, HK.textDim)
            }
            HStack {
                Text(e.payType ?? "—").font(.system(size: 12, weight: .semibold)).foregroundStyle(HK.textDim)
                Spacer()
                Text(e.payType == "Contract" ? "\(inrLabel(e.dailyRate))/day" : "\(inrLabel(e.monthlySalary))/mo")
                    .font(.system(size: 14, weight: .bold)).foregroundStyle(HK.text)
            }
        }
    }
    private func metric(_ l: String, _ v: Int?, _ c: Color) -> some View {
        VStack(spacing: 3) {
            Text(v.map(String.init) ?? "—").font(.system(size: 20, weight: .heavy, design: .rounded)).foregroundStyle(c)
            Text(l.uppercased()).font(.system(size: 9, weight: .heavy)).foregroundStyle(HK.textFaint)
        }.frame(maxWidth: .infinity).padding(.vertical, 10).background(HK.bgElev, in: RoundedRectangle(cornerRadius: 10))
    }
}
