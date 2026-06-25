import SwiftUI

// The four Darbar tabs — native ports of the deployed PWA's Today / Attendance / Pay / Roster.

// MARK: - Today (the Court)

struct DarbarTodayTab: View {
    @ObservedObject var model: DarbarAppModel
    @Binding var sheet: DarbarSheet?
    private let accent = DarbarView.accent

    var body: some View {
        DarbarScreen(title: "Darbar", subtitle: model.todayStatus) {
            ScrollView {
                VStack(spacing: 12) {
                    hero
                    sectionLabel("THE COURT", trailing: model.exceptionCount > 0 ? "\(model.exceptionCount) to handle" : "all clear",
                                 trailingColor: model.exceptionCount > 0 ? accent : HK.ready)
                    if model.exceptions.isEmpty {
                        emptyCourt
                    } else {
                        ForEach(model.exceptions, id: \.uid) { ex in
                            CourtCard(ex: ex, token: model.photoToken, model: model, sheet: $sheet)
                        }
                    }
                    Text("Open day closes 4:00 AM IST · presence pays the full day")
                        .font(.system(size: 10.5, weight: .medium)).foregroundStyle(HK.textFaint)
                        .frame(maxWidth: .infinity).padding(.top, 4)
                }
                .padding(.horizontal, 16).padding(.bottom, 24)
            }
            .scrollIndicators(.hidden)
            .refreshable { await model.loadToday() }
        }
    }

    private var hero: some View {
        let s = model.stats
        return HStack(spacing: 8) {
            statTile("Present", s?.present, HK.ready)
            statTile("Working", s?.missingPunch, accent)
            statTile("Absent", add(s?.absent, s?.inProgress), HK.error)
            statTile("Expected", s?.expected, HK.text)
        }
    }
    private func add(_ a: Int?, _ b: Int?) -> Int? { (a == nil && b == nil) ? nil : (a ?? 0) + (b ?? 0) }
    private func statTile(_ l: String, _ v: Int?, _ tint: Color) -> some View {
        VStack(spacing: 5) {
            Text(v.map(String.init) ?? "—").font(.system(size: 28, weight: .heavy, design: .rounded))
                .foregroundStyle(v == nil ? HK.textFaint : tint).monospacedDigit()
            Text(l.uppercased()).font(.system(size: 9.5, weight: .heavy)).tracking(0.4).foregroundStyle(HK.textFaint)
        }
        .frame(maxWidth: .infinity).padding(.vertical, 13)
        .background(HK.card, in: RoundedRectangle(cornerRadius: HK.radiusSm))
        .overlay(RoundedRectangle(cornerRadius: HK.radiusSm).stroke(HK.line, lineWidth: 1))
    }
    private var emptyCourt: some View {
        VStack(spacing: 10) {
            Image(systemName: "checkmark.seal.fill").font(.system(size: 34)).foregroundStyle(HK.ready)
            Text("The court is quiet").font(.system(size: 16, weight: .semibold)).foregroundStyle(HK.text)
            Text("Nothing needs you.").font(.system(size: 13)).foregroundStyle(HK.textDim)
        }.frame(maxWidth: .infinity).padding(.vertical, 44)
    }
}

func sectionLabel(_ title: String, trailing: String = "", trailingColor: Color = HK.textFaint) -> some View {
    HStack {
        Text(title).font(.system(size: 11, weight: .heavy)).tracking(0.7).foregroundStyle(HK.textFaint)
        Spacer()
        if !trailing.isEmpty { Text(trailing).font(.system(size: 11, weight: .heavy)).foregroundStyle(trailingColor) }
    }.padding(.horizontal, 4).padding(.top, 6)
}

// One Court card with the type-specific evidence + the real actions.
struct CourtCard: View {
    let ex: DarbarException
    let token: String?
    @ObservedObject var model: DarbarAppModel
    @Binding var sheet: DarbarSheet?
    private let accent = DarbarView.accent

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 12) {
                Rectangle().fill(rail).frame(width: 3, height: 38).clipShape(Capsule())
                DarbarFace(pin: ex.photoPin, id: ex.photoId, name: ex.displayName, token: token, size: 44)
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 6) {
                        Text(ex.displayName).font(.system(size: 15.5, weight: .bold)).foregroundStyle(HK.text).lineLimit(1)
                        darbarBrandChip(ex.brand)
                        Spacer(minLength: 2)
                        Text(pill.0).font(.system(size: 9, weight: .heavy))
                            .foregroundStyle(pill.1).padding(.horizontal, 7).padding(.vertical, 3)
                            .background(pill.1.opacity(0.16), in: Capsule())
                    }
                    Text(evidence).font(.system(size: 12.5)).foregroundStyle(HK.textDim).fixedSize(horizontal: false, vertical: true)
                }
            }
            if !actions.isEmpty {
                HStack(spacing: 8) { ForEach(actions, id: \.0) { a in actionButton(a) } }
            }
        }
        .padding(13)
        .background(HK.card, in: RoundedRectangle(cornerRadius: HK.radius))
        .overlay(RoundedRectangle(cornerRadius: HK.radius).stroke(HK.line, lineWidth: 1))
    }

    // (label, style, action)
    private var actions: [(String, ActStyle, () -> Void)] {
        switch ex.type {
        case "ghost":
            return [("Add to roster", .primary, { sheet = .onboard(pin: ex.pin ?? "", name: ex.deviceName ?? "") }),
                    ("Ignore", .ghost, { if let p = ex.pin { Task { await model.dismissGhost(pin: p) } } })]
        case "pay_missing":
            return [("Set pay", .primary, { if let id = ex.id { sheet = .setPay(id: id, name: ex.displayName) } })]
        case "departed":
            return [("Mark left", .danger, { if let id = ex.id { sheet = .exit(id: id, name: ex.displayName) } }),
                    ("On leave", .dark, { if let id = ex.id { sheet = .leave(id: id, name: ex.displayName) } })]
        default: return []
        }
    }
    enum ActStyle { case primary, dark, danger, ghost }
    private func actionButton(_ a: (String, ActStyle, () -> Void)) -> some View {
        Button(action: a.2) {
            Text(a.0).font(.system(size: 13, weight: .semibold)).frame(maxWidth: .infinity).padding(.vertical, 9)
                .foregroundStyle(fg(a.1)).background(bg(a.1), in: RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(a.1 == .ghost ? HK.line : .clear, lineWidth: 1))
        }.buttonStyle(.plain)
    }
    private func fg(_ s: ActStyle) -> Color { switch s { case .primary: return .black; case .danger: return HK.error; case .dark: return HK.text; case .ghost: return HK.textDim } }
    private func bg(_ s: ActStyle) -> Color { switch s { case .primary: return accent; case .danger: return HK.error.opacity(0.16); case .dark: return HK.cardHi; case .ghost: return .clear } }

    private var rail: Color {
        switch ex.type { case "ghost": return accent; case "chronic_missed", "chronic": return HK.running
        case "pay_missing", "departed": return HK.error; default: return HK.idle }
    }
    private var pill: (String, Color) {
        switch ex.type {
        case "ghost": return ("no roster", accent)
        case "chronic_missed", "chronic": return ("chronic", HK.running)
        case "pay_missing": return ("pay not set", HK.error)
        case "never_punched": return ("no punches", HK.idle)
        case "departed": return (ex.tier == "certain" ? "gone 21d+" : ex.tier == "strong" ? "14d+" : "7d+", HK.error)
        default: return (ex.type ?? "exception", HK.idle)
        }
    }
    private var evidence: String {
        switch ex.type {
        case "ghost":
            var b: [String] = [ex.pin.map { "PIN \($0) · no roster match" } ?? "no roster match"]
            if let p = ex.punches, let d = ex.days { b.append("\(p) punches over \(d) days") }
            if let s = ex.shape { b.append(s) }
            b.append(ex.active == true ? "working now" : (ex.daysSilent.map { "last seen \($0)d ago" } ?? ""))
            return b.filter { !$0.isEmpty }.joined(separator: " · ")
        case "chronic_missed", "chronic": return "Forgot a punch on \(ex.oddDays ?? 0) of the last 7 days — needs a word, not another SMS."
        case "pay_missing": return "No pay set — money facts are held for them until you set it."
        case "never_punched": return "On roster (PIN \(ex.pin ?? "?")) but has never punched."
        case "departed": return "Silent \(ex.daysSilent ?? 0)d · still on payroll."
        default: return "Exception: \(ex.type ?? "unknown")"
        }
    }
}

// MARK: - Attendance

struct DarbarAttendanceTab: View {
    @ObservedObject var model: DarbarAppModel
    private let accent = DarbarView.accent

    var body: some View {
        DarbarScreen(title: "Attendance", subtitle: "The punch-intelligence board") {
            VStack(spacing: 10) {
                dateStepper
                DarbarBrandSeg(sel: $model.attendBrand)
                if model.loadingAttend && model.attendRows.isEmpty {
                    ProgressView().tint(accent).frame(maxHeight: .infinity)
                } else {
                    ScrollView {
                        LazyVStack(spacing: 9) {
                            ForEach(model.attendFiltered) { AttendRowCard(row: $0, model: model) }
                            if model.attendFiltered.isEmpty {
                                Text("No punches for this day.").font(.system(size: 14)).foregroundStyle(HK.textFaint).padding(.top, 40)
                            }
                        }.padding(.horizontal, 16).padding(.bottom, 16)
                    }
                    .scrollIndicators(.hidden)
                    .refreshable { await model.loadAttendance() }
                }
            }
        }
        .task(id: model.attendDate) { await model.loadAttendance() }
    }

    private var dateStepper: some View {
        HStack(spacing: 8) {
            stepBtn("chevron.left") { shift(-1) }
            Text(prettyDate(model.attendDate)).font(.system(size: 14, weight: .semibold)).foregroundStyle(HK.text)
                .frame(maxWidth: .infinity).padding(.vertical, 9).background(HK.bgElev, in: RoundedRectangle(cornerRadius: 10))
            stepBtn("chevron.right") { shift(1) }
            Button("Today") { model.attendDate = DarbarClient.bizDayIST() }
                .font(.system(size: 13, weight: .semibold)).foregroundStyle(accent)
                .padding(.horizontal, 12).padding(.vertical, 9).background(HK.bgElev, in: RoundedRectangle(cornerRadius: 10))
        }.padding(.horizontal, 16)
    }
    private func stepBtn(_ icon: String, _ act: @escaping () -> Void) -> some View {
        Button(action: act) { Image(systemName: icon).font(.system(size: 15, weight: .bold)).foregroundStyle(HK.text)
            .frame(width: 40, height: 40).background(HK.bgElev, in: RoundedRectangle(cornerRadius: 10)) }.buttonStyle(.plain)
    }
    private func shift(_ d: Int) {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.timeZone = TimeZone(identifier: "Asia/Kolkata")
        if let dt = f.date(from: model.attendDate) { model.attendDate = f.string(from: dt.addingTimeInterval(Double(d) * 86400)) }
    }
    private func prettyDate(_ s: String) -> String {
        let i = DateFormatter(); i.dateFormat = "yyyy-MM-dd"; i.timeZone = TimeZone(identifier: "Asia/Kolkata")
        let o = DateFormatter(); o.dateFormat = "EEE, d MMM"; o.timeZone = TimeZone(identifier: "Asia/Kolkata")
        return i.date(from: s).map { o.string(from: $0) } ?? s
    }
}

struct AttendRowCard: View {
    let row: AttendanceRow
    @ObservedObject var model: DarbarAppModel
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                Circle().fill(dotColor).frame(width: 9, height: 9)
                VStack(alignment: .leading, spacing: 1) {
                    HStack(spacing: 6) {
                        Text(row.displayName).font(.system(size: 14.5, weight: .semibold)).foregroundStyle(HK.text)
                        darbarBrandChip(row.brandLabel)
                    }
                    Text("\(row.jobName ?? "") · \(sessionLine)").font(.system(size: 12)).foregroundStyle(HK.textDim).lineLimit(1)
                }
                Spacer()
                Text(stateLabel).font(.system(size: 9.5, weight: .heavy)).foregroundStyle(dotColor)
                    .padding(.horizontal, 7).padding(.vertical, 3).background(dotColor.opacity(0.16), in: Capsule())
            }
            if row.missingPunch && !row.working {
                Button { Task { await model.fixPunch(employeeId: row.employeeId ?? row.id, date: model.attendDate) } } label: {
                    Text("Fix — impute missing punch").font(.system(size: 12.5, weight: .semibold)).foregroundStyle(.black)
                        .frame(maxWidth: .infinity).padding(.vertical, 8).background(DarbarView.accent, in: RoundedRectangle(cornerRadius: 9))
                }.buttonStyle(.plain)
            }
        }
        .padding(12).background(HK.card, in: RoundedRectangle(cornerRadius: HK.radius))
        .overlay(RoundedRectangle(cornerRadius: HK.radius).stroke(HK.line, lineWidth: 1))
    }
    private var sessionLine: String {
        let i = (row.firstInAt?.suffix(8).prefix(5)).map(String.init) ?? "—"
        let o = (row.lastOutAt?.suffix(8).prefix(5)).map(String.init) ?? (row.working ? "in" : "—")
        return "\(i) → \(o)"
    }
    private var dotColor: Color { row.working ? DarbarView.accent : row.isAbsent ? HK.error : row.missingPunch ? HK.running : HK.ready }
    private var stateLabel: String { row.working ? "WORKING" : row.isAbsent ? "ABSENT" : row.missingPunch ? "MISSING PUNCH" : "PRESENT" }
}

// MARK: - Pay

struct DarbarPayTab: View {
    @ObservedObject var model: DarbarAppModel
    @Binding var sheet: DarbarSheet?
    private let accent = DarbarView.accent

    var body: some View {
        DarbarScreen(title: "Pay", subtitle: model.loadingPay ? "Loading payments…" : "\(model.payFiltered.count) payments · \(inrLabel(model.payTotal)) this month") {
            VStack(spacing: 10) {
                Button { sheet = .advance(nil) } label: {
                    HStack(spacing: 8) { Image(systemName: "plus.circle.fill"); Text("Pay an advance") }
                        .font(.system(size: 15, weight: .bold)).foregroundStyle(.black)
                        .frame(maxWidth: .infinity).padding(.vertical, 13).background(accent, in: RoundedRectangle(cornerRadius: 12))
                }.buttonStyle(.plain).padding(.horizontal, 16)
                DarbarBrandSeg(sel: $model.payBrand)
                ScrollView {
                    LazyVStack(spacing: 9) {
                        sectionLabel("PAYMENTS THIS MONTH", trailing: inrLabel(model.payTotal), trailingColor: accent).padding(.horizontal, 12)
                        ForEach(model.payFiltered) { row in
                            AdvanceCard(row: row).onTapGesture { sheet = .editAdvance(row) }
                        }
                        if model.payFiltered.isEmpty && !model.loadingPay {
                            Text("No advances paid this month.").font(.system(size: 14)).foregroundStyle(HK.textFaint).padding(.top, 36)
                        }
                    }.padding(.horizontal, 16).padding(.bottom, 16)
                }
                .scrollIndicators(.hidden)
                .refreshable { await model.loadPay() }
            }
        }
        .task { await model.loadPay(); if model.employees.isEmpty { await model.loadRoster() } }
    }
}

struct AdvanceCard: View {
    let row: AdvanceRow
    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(row.who).font(.system(size: 15, weight: .semibold)).foregroundStyle(HK.text)
                    darbarBrandChip(row.brandLabel)
                }
                Text("\(row.advanceDate?.prefix(10) ?? "") · \(PayVia(rawValue: row.paidVia ?? "")?.label ?? row.paidVia ?? "")\(row.receiptStatus == "sent" ? " · receipt sent" : "")")
                    .font(.system(size: 12)).foregroundStyle(HK.textDim)
            }
            Spacer()
            Text(inrLabel(row.amount)).font(.system(size: 16, weight: .heavy, design: .rounded)).foregroundStyle(HK.text).monospacedDigit()
            Image(systemName: "chevron.right").font(.system(size: 12, weight: .bold)).foregroundStyle(HK.textFaint)
        }
        .padding(13).background(HK.card, in: RoundedRectangle(cornerRadius: HK.radius))
        .overlay(RoundedRectangle(cornerRadius: HK.radius).stroke(HK.line, lineWidth: 1))
    }
}

// MARK: - Roster

struct DarbarRosterTab: View {
    @ObservedObject var model: DarbarAppModel
    @Binding var sheet: DarbarSheet?
    var body: some View {
        DarbarScreen(title: "Roster", subtitle: "\(model.rosterFiltered.count) serving the realm") {
            VStack(spacing: 10) {
                DarbarBrandSeg(sel: $model.rosterBrand)
                if model.loadingRoster && model.employees.isEmpty {
                    ProgressView().tint(DarbarView.accent).frame(maxHeight: .infinity)
                } else {
                    ScrollView {
                        LazyVStack(spacing: 9) {
                            ForEach(model.rosterFiltered) { e in
                                RosterRow(e: e, token: model.photoToken, fin: model.fin)
                                    .onTapGesture { sheet = .settle(id: e.id, name: e.displayName) }
                            }
                        }.padding(.horizontal, 16).padding(.bottom, 16)
                    }
                    .scrollIndicators(.hidden)
                    .refreshable { await model.loadRoster() }
                }
            }
        }
        .task { if model.employees.isEmpty { await model.loadRoster() } }
    }
}

struct RosterRow: View {
    let e: DarbarEmployee; let token: String?; let fin: Bool
    var body: some View {
        HStack(spacing: 12) {
            DarbarFace(pin: e.pin, id: e.id, name: e.displayName, token: token, size: 42)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(e.displayName).font(.system(size: 15, weight: .semibold)).foregroundStyle(HK.text)
                    darbarBrandChip(e.brandLabel)
                    if e.pin == nil { Text("no pin").font(.system(size: 9, weight: .heavy)).foregroundStyle(HK.running)
                        .padding(.horizontal, 6).padding(.vertical, 2).background(HK.running.opacity(0.16), in: Capsule()) }
                }
                Text("\(e.jobName ?? "") \(e.pin.map { "· PIN \($0)" } ?? "") · \(e.payType ?? "")").font(.system(size: 12)).foregroundStyle(HK.textDim).lineLimit(1)
            }
            Spacer()
            if fin { Text(e.payLabel).font(.system(size: 13, weight: .bold)).foregroundStyle(e.hasPay ? HK.text : HK.running).monospacedDigit() }
        }
        .padding(12).background(HK.card, in: RoundedRectangle(cornerRadius: HK.radius))
        .overlay(RoundedRectangle(cornerRadius: HK.radius).stroke(HK.line, lineWidth: 1))
    }
}
