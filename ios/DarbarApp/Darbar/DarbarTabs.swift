import SwiftUI

// The four Darbar tabs — native ports of the deployed PWA's Today / Attendance / Pay / Roster.

// MARK: - Today (the Court)

struct DarbarTodayTab: View {
    @ObservedObject var model: DarbarAppModel
    @Binding var sheet: DarbarSheet?
    private let accent = DarbarView.accent

    var body: some View {
        DarbarScreen(title: "Darbar", subtitle: model.todayStatus, trailing: {
            Button { sheet = .account } label: {
                Image(systemName: "gearshape.fill").font(.system(size: 17, weight: .semibold)).foregroundStyle(HK.textDim)
            }.buttonStyle(.plain)
        }) {
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
    @State private var ignoring = false

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
        // chronic / never_punched / pay_missing / departed top row drills into the person's month.
        .contentShape(Rectangle())
        .onTapGesture {
            if drillable, let id = ex.id { sheet = .settle(id: id, name: ex.displayName, mode: "settle") }
        }
        .confirmationDialog("Ignore PIN \(ex.pin ?? "")? It drops out of the inbox.", isPresented: $ignoring, titleVisibility: .visible) {
            Button("Ignore ghost", role: .destructive) { if let p = ex.pin { Task { await model.dismissGhost(pin: p) } } }
            Button("Cancel", role: .cancel) {}
        }
    }

    private var drillable: Bool { ["chronic", "chronic_missed", "never_punched", "pay_missing", "departed"].contains(ex.type ?? "") }

    // (label, style, action). dismissGhost is confirm-gated; the rest open a sheet.
    private var actions: [(String, ActStyle, () -> Void)] {
        switch ex.type {
        case "ghost":
            return [("Add to roster", .primary, { sheet = .onboard(pin: ex.pin ?? "", name: ex.deviceName ?? "") }),
                    ("Ignore", .ghost, { ignoring = true })]
        case "pay_missing":
            return [("Set pay", .primary, { if let id = ex.id { sheet = .setPay(id: id, name: ex.displayName) } })]
        case "departed":
            return [("Mark left", .danger, { if let id = ex.id { sheet = .exit(id: id, name: ex.displayName) } }),
                    ("On leave", .dark, { if let id = ex.id { sheet = .leave(id: id, name: ex.displayName) } }),
                    ("Keep", .ghost, { model.keepActive() })]
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
    @Binding var sheet: DarbarSheet?
    private let accent = DarbarView.accent

    var body: some View {
        DarbarScreen(title: "Attendance", subtitle: "The punch-intelligence board", trailing: {
            Button { Task { await model.pullAttendance() } } label: {
                Image(systemName: "arrow.clockwise").font(.system(size: 16, weight: .bold)).foregroundStyle(HK.textDim)
            }.buttonStyle(.plain)
        }) {
            VStack(spacing: 10) {
                dateStepper
                DarbarBrandSeg(sel: $model.attendBrand)
                if model.attMode == "day" { dayStats }
                if model.loadingAttend && (model.attMode == "day" ? model.attendRows.isEmpty : model.monthRows.isEmpty) {
                    ProgressView().tint(accent).frame(maxHeight: .infinity)
                } else if model.attMode == "month" {
                    monthList
                } else {
                    dayList
                }
            }
        }
        .task(id: model.attendDate + model.attMode) { await model.loadAttendance() }
    }

    // DAY: four clickable stat cards that filter the list (tap again clears).
    // Counts mirror the PWA renderAttend tally — present (incl. working+incomplete),
    // ⚠ Fix = present-but-incomplete (never on the open day), absent, off.
    private var dayStats: some View {
        let live = model.attendLive
        let rows = model.attendBrand == "all" ? model.attendRows : model.attendRows.filter { $0.brandLabel == model.attendBrand }
        let states = rows.map { $0.attState(isLiveDay: live) }
        let present = states.filter { $0.kind == "present" }.count
        let incomplete = states.filter { $0.kind == "present" && $0.incomplete }.count
        let absent = states.filter { $0.kind == "absent" }.count
        let off = states.filter { $0.kind == "off" }.count
        return HStack(spacing: 8) {
            filterTile("Present", present, HK.ready, "present")
            filterTile("⚠ Fix", incomplete, HK.running, "incomplete")
            filterTile("Absent", absent, HK.error, "absent")
            filterTile("Off", off, HK.textDim, "off")
        }.padding(.horizontal, 16)
    }
    private func filterTile(_ l: String, _ v: Int, _ tint: Color, _ key: String) -> some View {
        let on = model.attendFilter == key
        return VStack(spacing: 3) {
            Text("\(v)").font(.system(size: 21, weight: .heavy, design: .rounded)).foregroundStyle(tint).monospacedDigit()
            Text(l.uppercased()).font(.system(size: 8.5, weight: .heavy)).tracking(0.3).foregroundStyle(HK.textFaint).lineLimit(1)
        }
        .frame(maxWidth: .infinity).padding(.vertical, 9)
        .background(HK.card, in: RoundedRectangle(cornerRadius: HK.radiusSm))
        .overlay(RoundedRectangle(cornerRadius: HK.radiusSm).stroke(on ? accent : HK.line, lineWidth: on ? 2 : 1))
        .contentShape(Rectangle())
        .onTapGesture { model.attendFilter = (model.attendFilter == key) ? nil : key }
    }

    private var dayList: some View {
        ScrollView {
            LazyVStack(spacing: 9) {
                if let f = model.attendFilter {
                    Text("Showing \(f) — tap the card again to clear").font(.system(size: 11.5)).foregroundStyle(accent)
                        .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 4)
                }
                ForEach(model.attendFiltered) { row in
                    AttendRowCard(row: row, isLiveDay: model.attendLive, model: model)
                        // PWA attRowTap: a day-row opens that person's month settle sheet (fin-gated).
                        // Month = the attendance day's month, matching loadPayCtx('settle', id, slice(0,7)).
                        .contentShape(Rectangle())
                        .onTapGesture {
                            guard model.fin else { return }
                            sheet = .settle(id: row.employeeId ?? row.id, name: row.displayName, mode: "settle")
                        }
                }
                if model.attendFiltered.isEmpty {
                    Text("No punches for this day.").font(.system(size: 14)).foregroundStyle(HK.textFaint).padding(.top, 40)
                }
            }.padding(.horizontal, 16).padding(.bottom, 16)
        }
        .scrollIndicators(.hidden)
        .refreshable { await model.loadAttendance() }
    }

    private var monthList: some View {
        ScrollView {
            LazyVStack(spacing: 9) {
                ForEach(model.monthPeople) { p in
                    MonthStripRow(p: p, month: String(model.attendDate.prefix(7)), token: model.photoToken)
                        // PWA rosterTap: a month-strip row opens that person's settle sheet (fin-gated).
                        .contentShape(Rectangle())
                        .onTapGesture {
                            guard model.fin else { return }
                            sheet = .settle(id: p.id, name: p.name, mode: "settle")
                        }
                }
                if model.monthPeople.isEmpty {
                    Text("No attendance recorded this month.").font(.system(size: 14)).foregroundStyle(HK.textFaint).padding(.top, 40)
                }
            }.padding(.horizontal, 16).padding(.bottom, 16)
        }
        .scrollIndicators(.hidden)
        .refreshable { await model.loadMonthAttendance() }
    }

    private var dateStepper: some View {
        HStack(spacing: 8) {
            stepBtn("chevron.left") { shift(-1) }
            Text(model.attMode == "month" ? monthLabel(String(model.attendDate.prefix(7))) : prettyDate(model.attendDate))
                .font(.system(size: 14, weight: .semibold)).foregroundStyle(HK.text)
                .frame(maxWidth: .infinity).padding(.vertical, 9).background(HK.bgElev, in: RoundedRectangle(cornerRadius: 10))
            stepBtn("chevron.right") { shift(1) }
            Button(model.attMode == "month" ? "Day" : "Month") {
                model.attMode = model.attMode == "month" ? "day" : "month"
            }
            .font(.system(size: 13, weight: .semibold)).foregroundStyle(accent)
            .padding(.horizontal, 11).padding(.vertical, 9).background(HK.bgElev, in: RoundedRectangle(cornerRadius: 10))
            Button("Today") { model.attendDate = DarbarClient.bizDayIST() }
                .font(.system(size: 13, weight: .semibold)).foregroundStyle(accent)
                .padding(.horizontal, 11).padding(.vertical, 9).background(HK.bgElev, in: RoundedRectangle(cornerRadius: 10))
        }.padding(.horizontal, 16)
    }
    private func stepBtn(_ icon: String, _ act: @escaping () -> Void) -> some View {
        Button(action: act) { Image(systemName: icon).font(.system(size: 15, weight: .bold)).foregroundStyle(HK.text)
            .frame(width: 38, height: 40).background(HK.bgElev, in: RoundedRectangle(cornerRadius: 10)) }.buttonStyle(.plain)
    }
    private func shift(_ d: Int) {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.timeZone = TimeZone(identifier: "Asia/Kolkata")
        guard let dt = f.date(from: model.attendDate) else { return }
        if model.attMode == "month" {
            let cur = String(model.attendDate.prefix(7))
            model.attendDate = shiftMonth(cur, by: d) + "-01"
        } else {
            model.attendDate = f.string(from: dt.addingTimeInterval(Double(d) * 86400))
        }
    }
    private func prettyDate(_ s: String) -> String {
        let i = DateFormatter(); i.dateFormat = "yyyy-MM-dd"; i.timeZone = TimeZone(identifier: "Asia/Kolkata")
        let o = DateFormatter(); o.dateFormat = "EEE, d MMM"; o.timeZone = TimeZone(identifier: "Asia/Kolkata")
        return i.date(from: s).map { o.string(from: $0) } ?? s
    }
}

// One person's full-month dot strip (PWA renderAttendMonth row).
struct MonthStripRow: View {
    let p: MonthPerson
    let month: String
    let token: String?
    private let purple = Color(hex: 0xA78BFA)

    var body: some View {
        HStack(spacing: 10) {
            DarbarFace(pin: nil, id: p.id, name: p.name, token: token, size: 36)
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(p.name).font(.system(size: 14, weight: .semibold)).foregroundStyle(HK.text).lineLimit(1)
                    darbarBrandChip(p.brand)
                }
                strip
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 1) {
                Text("\(p.worked)w").font(.system(size: 11, weight: .bold)).foregroundStyle(HK.ready)
                if p.errs > 0 { Text("\(p.errs)!").font(.system(size: 10.5, weight: .bold)).foregroundStyle(HK.running) }
                Text("\(p.absent)a").font(.system(size: 10.5, weight: .bold)).foregroundStyle(HK.error)
            }
        }
        .padding(11).background(HK.card, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(HK.line, lineWidth: 1))
    }
    private var strip: some View {
        let parts = month.split(separator: "-").compactMap { Int($0) }
        let y = parts.first ?? 2026, m = parts.count > 1 ? parts[1] : 1
        let n = daysInMonth(y: y, m: m)
        let biz = DarbarClient.bizDayIST()
        return HStack(spacing: 2) {
            ForEach(1...max(1, n), id: \.self) { d in
                let ds = "\(month)-" + String(format: "%02d", d)
                Circle().fill(color(ds: ds, r: p.byDate[ds], biz: biz)).frame(width: 5, height: 5)
            }
        }
    }
    private func color(ds: String, r: MonthAttendanceRow?, biz: String) -> Color {
        if ds > biz { return HK.line }
        if ds == biz { return DarbarView.accent }
        guard let r else { return HK.bgElev }
        let st = r.status?.lowercased()
        if st == "week_off" || st == "leave" { return purple }
        let pc = r.punchCount ?? 0
        if pc == 0 { return HK.error }
        return pc % 2 == 1 ? HK.running : HK.ready
    }
}

struct AttendRowCard: View {
    let row: AttendanceRow
    let isLiveDay: Bool
    @ObservedObject var model: DarbarAppModel
    private var st: AttendanceRow.AttState { row.attState(isLiveDay: isLiveDay) }
    // Fix button only when there's a real missing punch on a CLOSED day (PWA: present && incomplete).
    private var showFix: Bool { st.kind == "present" && st.incomplete }
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
                Text(st.label).font(.system(size: 9.5, weight: .heavy)).foregroundStyle(dotColor)
                    .padding(.horizontal, 7).padding(.vertical, 3).background(dotColor.opacity(0.16), in: Capsule())
            }
            if showFix {
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
        let o = (row.lastOutAt?.suffix(8).prefix(5)).map(String.init) ?? (st.working ? "open" : "—")
        return "\(i) → \(o)"
    }
    // PWA dot/pill colours: working→blue, present→green, incomplete→yellow, absent→red, off→purple.
    private var dotColor: Color {
        if st.working { return DarbarView.accent }
        switch st.kind {
        case "present": return st.incomplete ? HK.running : HK.ready
        case "absent": return HK.error
        default: return Color(hex: 0xA78BFA)   // off
        }
    }
}

// MARK: - Pay

struct DarbarPayTab: View {
    @ObservedObject var model: DarbarAppModel
    @Binding var sheet: DarbarSheet?
    private let accent = DarbarView.accent

    var body: some View {
        DarbarScreen(title: "Pay", subtitle: model.loadingPay ? "Loading payments…" : "\(model.payPeople.count) paid · \(inrLabel(model.payTotal)) this month", trailing: {
            Button { sheet = .advance(nil) } label: {
                Image(systemName: "plus.circle.fill").font(.system(size: 19, weight: .semibold)).foregroundStyle(accent)
            }.buttonStyle(.plain)
        }) {
            VStack(spacing: 10) {
                settleBanner
                actionsRow
                DarbarBrandSeg(sel: $model.payBrand)
                ScrollView {
                    LazyVStack(spacing: 9) {
                        if !model.payPeople.isEmpty || model.loadingPay {
                            sectionLabel("PAID THIS MONTH", trailing: inrLabel(model.payTotal), trailingColor: accent).padding(.horizontal, 12)
                        }
                        ForEach(model.payPeople) { p in
                            PayPersonCard(p: p).onTapGesture { sheet = .settle(id: p.id, name: p.name, mode: "settle") }
                        }
                        if model.payPeople.isEmpty && !model.loadingPay {
                            Text("No payments recorded for \(monthLabel(model.payMonth)) yet.").font(.system(size: 14)).foregroundStyle(HK.textFaint).padding(.top, 36)
                        }
                    }.padding(.horizontal, 16).padding(.bottom, 16)
                }
                .scrollIndicators(.hidden)
                .refreshable { await model.loadPay() }
            }
        }
        .task { await model.loadPay(); if model.employees.isEmpty { await model.loadRoster() } }
    }

    // Month navigator + active-period hint (PWA settleBanner).
    private var settleBanner: some View {
        HStack {
            Button { model.changePayMonth(-1) } label: { Text("◄").font(.system(size: 18, weight: .bold)).foregroundStyle(accent).frame(width: 48) }.buttonStyle(.plain)
            VStack(spacing: 2) {
                Text(monthLabel(model.payMonth)).font(.system(size: 16, weight: .heavy)).foregroundStyle(HK.text)
                Text(model.isActiveSettlementMonth ? "Salary period being cleared now — paid by the 10th" : "Browsing — ◄ ► to change month")
                    .font(.system(size: 10.5)).foregroundStyle(HK.textDim).lineLimit(1).minimumScaleFactor(0.7)
            }.frame(maxWidth: .infinity)
            Button { model.changePayMonth(1) } label: { Text("►").font(.system(size: 18, weight: .bold)).foregroundStyle(accent).frame(width: 48) }.buttonStyle(.plain)
        }
        .padding(.vertical, 10).padding(.horizontal, 6)
        .background(HK.card, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(HK.line, lineWidth: 1))
        .padding(.horizontal, 16)
    }

    private var actionsRow: some View {
        VStack(spacing: 8) {
            HStack(spacing: 8) {
                Button { sheet = .advance(nil) } label: {
                    Text("Settle a person").font(.system(size: 14, weight: .bold)).foregroundStyle(.black)
                        .frame(maxWidth: .infinity).padding(.vertical, 12).background(accent, in: RoundedRectangle(cornerRadius: 11))
                }.buttonStyle(.plain)
                Button { sheet = .advance(nil) } label: {
                    Text("Pay advance").font(.system(size: 14, weight: .bold)).foregroundStyle(HK.text)
                        .frame(maxWidth: .infinity).padding(.vertical, 12).background(HK.cardHi, in: RoundedRectangle(cornerRadius: 11))
                        .overlay(RoundedRectangle(cornerRadius: 11).stroke(HK.line, lineWidth: 1))
                }.buttonStyle(.plain)
            }
            Button { sheet = .monthBoard } label: {
                HStack(spacing: 7) { Image(systemName: "list.bullet.rectangle"); Text("Month board — who’s done, who’s left") }
                    .font(.system(size: 13.5, weight: .semibold)).foregroundStyle(HK.text)
                    .frame(maxWidth: .infinity).padding(.vertical, 11).background(HK.cardHi, in: RoundedRectangle(cornerRadius: 11))
                    .overlay(RoundedRectangle(cornerRadius: 11).stroke(HK.line, lineWidth: 1))
            }.buttonStyle(.plain)
        }.padding(.horizontal, 16)
    }
}

// Pay list card — GROUPED BY PERSON (the month's total paid), not per-transaction.
struct PayPersonCard: View {
    let p: DarbarAppModel.PayPerson
    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(p.name).font(.system(size: 15, weight: .semibold)).foregroundStyle(HK.text).lineLimit(1)
                    darbarBrandChip(p.brand)
                    if p.settled {
                        Text("✓ Settled").font(.system(size: 8.5, weight: .heavy)).foregroundStyle(HK.ready)
                            .padding(.horizontal, 6).padding(.vertical, 2).background(HK.ready.opacity(0.16), in: Capsule())
                    } else {
                        Text("advance only").font(.system(size: 8.5, weight: .heavy)).foregroundStyle(DarbarView.accent)
                            .padding(.horizontal, 6).padding(.vertical, 2).background(DarbarView.accent.opacity(0.16), in: Capsule())
                    }
                }
                Text(breakdown).font(.system(size: 12)).foregroundStyle(HK.textDim)
            }
            Spacer()
            Text(inrLabel(p.total)).font(.system(size: 16, weight: .heavy, design: .rounded)).foregroundStyle(HK.text).monospacedDigit()
            Image(systemName: "chevron.right").font(.system(size: 12, weight: .bold)).foregroundStyle(HK.textFaint)
        }
        .padding(13).background(HK.card, in: RoundedRectangle(cornerRadius: HK.radius))
        .overlay(RoundedRectangle(cornerRadius: HK.radius).stroke(HK.line, lineWidth: 1))
    }
    private var breakdown: String {
        var parts: [String] = []
        if p.advTotal > 0 { parts.append("advance \(inrLabel(p.advTotal))") }
        if p.setTotal > 0 { parts.append("settlement \(inrLabel(p.setTotal))") }
        return (parts.isEmpty ? "—" : parts.joined(separator: " + ")) + " · tap for the trail"
    }
}

// MARK: - Roster

struct DarbarRosterTab: View {
    @ObservedObject var model: DarbarAppModel
    @Binding var sheet: DarbarSheet?
    var body: some View {
        DarbarScreen(title: "Roster", subtitle: "\(model.rosterFiltered.count) serving · tap a person for their month") {
            VStack(spacing: 10) {
                DarbarBrandSeg(sel: $model.rosterBrand)
                if model.loadingRoster && model.employees.isEmpty {
                    ProgressView().tint(DarbarView.accent).frame(maxHeight: .infinity)
                } else {
                    ScrollView {
                        LazyVStack(spacing: 9) {
                            if model.fin { costCard }
                            ForEach(model.rosterFiltered) { e in
                                RosterRow(e: e, token: model.photoToken, fin: model.fin)
                                    .onTapGesture {
                                        if model.fin { sheet = .settle(id: e.id, name: e.displayName, mode: "settle") }
                                        else { model.show("Pay is owner-only", ok: false) }
                                    }
                            }
                            if model.rosterFiltered.isEmpty { Text("No one here.").font(.system(size: 14)).foregroundStyle(HK.textFaint).padding(.top, 40) }
                        }.padding(.horizontal, 16).padding(.bottom, 16)
                    }
                    .scrollIndicators(.hidden)
                    .refreshable { await model.loadRoster() }
                }
            }
        }
        .task { if model.employees.isEmpty { await model.loadRoster() } }
    }

    // Owner-only monthly staffing cost (Σ monthly OR daily×30 per active person).
    private var costCard: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text("MONTHLY STAFFING COST").font(.system(size: 10.5, weight: .heavy)).tracking(0.5).foregroundStyle(HK.textFaint)
            Text(inrLabel(model.rosterMonthlyCost)).font(.system(size: 26, weight: .heavy, design: .rounded)).foregroundStyle(DarbarView.accent).monospacedDigit()
            Text("\(model.rosterBrand == "all" ? "all outlets" : model.rosterBrand) · \(model.rosterFiltered.count) staff · full attendance, before OT\(model.rosterMissingPay > 0 ? " · \(model.rosterMissingPay) missing salary" : "")")
                .font(.system(size: 11)).foregroundStyle(HK.textDim)
        }
        .padding(14).frame(maxWidth: .infinity, alignment: .leading)
        .background(DarbarView.accent.opacity(0.08), in: RoundedRectangle(cornerRadius: HK.radius))
        .overlay(RoundedRectangle(cornerRadius: HK.radius).stroke(DarbarView.accent.opacity(0.4), lineWidth: 1))
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
