import SwiftUI

// The four Darbar tabs — native ports of the deployed PWA's Today / Attendance / Pay / Roster.

// MARK: - Today (the Court)

struct DarbarTodayTab: View {
    @ObservedObject var model: DarbarAppModel
    @Binding var sheet: DarbarSheet?
    private let accent = DarbarView.accent

    var body: some View {
        DarbarScreen(title: "Darbar", subtitle: model.todayStatus, dateSuffix: model.todayDate,
                     subtitleDanger: model.todayDeviceSilent, trailing: {
            Button { sheet = .account } label: {
                Image(systemName: "gearshape.fill").font(.system(size: 17, weight: .semibold)).foregroundStyle(HK.textDim)
            }.buttonStyle(.plain)
        }) {
            ScrollView {
                VStack(spacing: 12) {
                    hero
                    sectionLabel("THE COURT", trailing: model.exceptionCount > 0 ? "\(model.exceptionCount) TO HANDLE" : "ALL CLEAR",
                                 trailingColor: model.exceptionCount > 0 ? DK.gold : DK.green)
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
        // PWA hero colours: present→green, working→blue, absent→red, expected→neutral.
        return HStack(spacing: 8) {
            statTile("Present", s?.present, DK.green)
            statTile("Working", s?.missingPunch, DK.blue)
            statTile("Absent", add(s?.absent, s?.inProgress), DK.red)
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
            Image(systemName: "checkmark.seal.fill").font(.system(size: 34)).foregroundStyle(DK.green)
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
            HStack(alignment: .top, spacing: 12) {
                Rectangle().fill(rail).frame(width: 3, height: 38).clipShape(Capsule())
                DarbarFace(pin: ex.photoPin, id: ex.photoId, name: ex.displayName, token: token, size: 44)
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 6) {
                        nameLine
                        Spacer(minLength: 2)
                        if let p = pill {
                            Text(p.0).font(.system(size: 9, weight: .heavy))
                                .foregroundStyle(p.1).padding(.horizontal, 7).padding(.vertical, 3)
                                .background(p.1.opacity(0.16), in: Capsule())
                        }
                    }
                    evidence.font(.system(size: 12.5)).foregroundStyle(HK.textDim).fixedSize(horizontal: false, vertical: true)
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

    // Name line. Ghost rows lead with the device name + a purple "PIN N · no roster" pill,
    // exactly like the PWA; all other types show name + brand chip.
    @ViewBuilder private var nameLine: some View {
        if ex.type == "ghost" {
            if let dn = ex.deviceName, !dn.isEmpty {
                Text(dn).font(.system(size: 15.5, weight: .bold)).foregroundStyle(HK.text).lineLimit(1)
                Text("PIN \(ex.pin ?? "?") · NO ROSTER").font(.system(size: 9, weight: .heavy)).tracking(0.3)
                    .foregroundStyle(DK.purple).padding(.horizontal, 7).padding(.vertical, 3)
                    .background(DK.purpleSoft, in: Capsule())
            } else {
                Text("Unknown — PIN \(ex.pin ?? "?")").font(.system(size: 15.5, weight: .bold)).foregroundStyle(HK.text).lineLimit(1)
                Text("GHOST").font(.system(size: 9, weight: .heavy)).tracking(0.3)
                    .foregroundStyle(DK.purple).padding(.horizontal, 7).padding(.vertical, 3)
                    .background(DK.purpleSoft, in: Capsule())
            }
        } else {
            Text(ex.displayName).font(.system(size: 15.5, weight: .bold)).foregroundStyle(HK.text).lineLimit(1)
            darbarBrandChip(ex.brand)
        }
    }

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
    // PWA: .btn.primary = gold fill / dark text · .btn.danger = red-soft / red · .btn.dark = grey · ghost = outline.
    private func fg(_ s: ActStyle) -> Color { switch s { case .primary: return DK.goldText; case .danger: return DK.red; case .dark: return HK.text; case .ghost: return HK.textDim } }
    private func bg(_ s: ActStyle) -> Color { switch s { case .primary: return DK.gold; case .danger: return DK.redSoft; case .dark: return HK.cardHi; case .ghost: return .clear } }

    private var rail: Color {
        switch ex.type { case "ghost": return DK.purple; case "chronic_missed", "chronic": return DK.yellow
        case "pay_missing", "departed": return DK.red; default: return DK.mute }
    }
    // Status pill on the right (ghost has its pill on the name line instead → nil here).
    private var pill: (String, Color)? {
        switch ex.type {
        case "ghost": return nil
        case "chronic_missed", "chronic": return ("chronic", DK.yellow)
        case "pay_missing": return ("pay not set", DK.gold)
        case "never_punched": return ("no punches", DK.blue)
        case "departed": return (ex.tier == "certain" ? "gone 21d+" : ex.tier == "strong" ? "14d+" : "7d+",
                                 ex.tier == "certain" ? DK.red : ex.tier == "strong" ? DK.yellow : DK.mute)
        default: return (ex.type ?? "exception", DK.mute)
        }
    }
    // Type-specific evidence — multi-line / multi-colour, 1:1 with the PWA cardFor() copy.
    @ViewBuilder private var evidence: some View {
        switch ex.type {
        case "ghost":
            VStack(alignment: .leading, spacing: 1) {
                (
                    (ex.deviceName.map { Text("device says ").foregroundColor(HK.textDim) + Text($0).foregroundColor(HK.text).bold() + Text(" · ").foregroundColor(HK.textDim) } ?? Text(""))
                    + Text("\(ex.punches ?? 0)").foregroundColor(HK.text).bold() + Text(" punches over ").foregroundColor(HK.textDim)
                    + Text("\(ex.days ?? 0)").foregroundColor(HK.text).bold() + Text(" days").foregroundColor(HK.textDim)
                    + (ex.shape.map { Text(" · \($0)").foregroundColor(HK.textDim) } ?? Text(""))
                )
                if ex.active == true {
                    Text("working now").foregroundColor(DK.green).bold()
                } else if let s = ex.daysSilent {
                    Text("last seen \(s)d ago").foregroundColor(HK.textDim)
                }
            }
        case "chronic_missed", "chronic":
            Text("Forgot a punch on \(ex.oddDays ?? 0) of the last 7 days — needs a word, not another SMS.")
        case "pay_missing":
            Text("No pay set — the system can't show money facts for them. Their settlement line is held until you set it.")
        case "never_punched":
            Text("On roster (PIN \(ex.pin ?? "?")) but has never punched — enrolled on the device, or not really working?")
        case "departed":
            VStack(alignment: .leading, spacing: 1) {
                (Text("Silent ").foregroundColor(HK.textDim) + Text("\(ex.daysSilent ?? 0)d").foregroundColor(HK.text).bold()
                 + Text(" · still on payroll").foregroundColor(HK.textDim)
                 + (payLabel.map { Text(" at ").foregroundColor(HK.textDim) + Text($0).foregroundColor(HK.text).bold() } ?? Text("")))
                Text("last punch \(ex.lastPunch.map { String($0.prefix(10)) } ?? "never")").foregroundColor(HK.textDim)
            }
        default:
            Text("Exception: \(ex.type ?? "unknown")")
        }
    }
    private var payLabel: String? {
        if let m = ex.monthlySalary, m > 0 { return inrLabel(m) + "/mo" }
        if let d = ex.dailyRate, d > 0 { return inrLabel(d) + "/day" }
        return nil
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
            filterTile("Present", present, DK.green, "present")
            filterTile("⚠ Fix", incomplete, DK.yellow, "incomplete")
            filterTile("Absent", absent, DK.red, "absent")
            filterTile("Off", off, DK.purple, "off")
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
                    AttendRowCard(row: row, isLiveDay: model.attendLive, token: model.photoToken, model: model)
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

    // PWA .dstep order: ‹ / date / › / Today / Month — all neutral (--e2 bg, --text), none gold.
    private var dateStepper: some View {
        HStack(spacing: 8) {
            stepBtn("chevron.left") { shift(-1) }
            Text(model.attMode == "month" ? monthLabel(String(model.attendDate.prefix(7))) : prettyDate(model.attendDate))
                .font(.system(size: 14, weight: .semibold)).foregroundStyle(HK.text)
                .frame(maxWidth: .infinity).padding(.vertical, 9).background(HK.bgElev, in: RoundedRectangle(cornerRadius: 10))
            stepBtn("chevron.right") { shift(1) }
            Button("Today") { model.attendDate = DarbarClient.bizDayIST() }
                .font(.system(size: 13, weight: .semibold)).foregroundStyle(HK.text)
                .padding(.horizontal, 11).padding(.vertical, 9).background(HK.bgElev, in: RoundedRectangle(cornerRadius: 10))
            Button(model.attMode == "month" ? "Day" : "Month") {
                model.attMode = model.attMode == "month" ? "day" : "month"
            }
            .font(.system(size: 13, weight: .semibold)).foregroundStyle(HK.text)
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
                Text("\(p.worked)w").font(.system(size: 11, weight: .bold)).foregroundStyle(DK.green)
                if p.errs > 0 { Text("\(p.errs)!").font(.system(size: 10.5, weight: .bold)).foregroundStyle(DK.yellow) }
                Text("\(p.absent)a").font(.system(size: 10.5, weight: .bold)).foregroundStyle(DK.red)
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
        if pc == 0 { return DK.red }
        return pc % 2 == 1 ? DK.yellow : DK.green
    }
}

struct AttendRowCard: View {
    let row: AttendanceRow
    let isLiveDay: Bool
    let token: String?
    @ObservedObject var model: DarbarAppModel
    private var st: AttendanceRow.AttState { row.attState(isLiveDay: isLiveDay) }
    // Fix button only when there's a real missing punch on a CLOSED day (PWA: present && incomplete).
    private var showFix: Bool { st.kind == "present" && st.incomplete }
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                // PWA renders a circular CAMS-face photo (id+pin), initials fallback.
                DarbarFace(pin: row.pin, id: row.employeeId ?? row.id, name: row.displayName, token: token, size: 38)
                VStack(alignment: .leading, spacing: 1) {
                    HStack(spacing: 6) {
                        Circle().fill(dotColor).frame(width: 8, height: 8)
                        // legal name + nickname in grey parens, exactly like the PWA
                        darbarName(row.name, nick: row.knownAs, size: 14.5).lineLimit(1)
                        darbarBrandChip(row.brandLabel)
                    }
                    if let j = row.jobName, !j.isEmpty {
                        Text(j).font(.system(size: 12)).foregroundStyle(HK.textDim).lineLimit(1)
                    }
                    sessionLine
                }
                Spacer(minLength: 4)
                Text(st.label).font(.system(size: 9.5, weight: .heavy)).foregroundStyle(dotColor)
                    .padding(.horizontal, 7).padding(.vertical, 3).background(dotColor.opacity(0.16), in: Capsule())
            }
            if showFix {
                Button { Task { await model.fixPunch(employeeId: row.employeeId ?? row.id, date: model.attendDate) } } label: {
                    Text("Fix — impute missing punch").font(.system(size: 12.5, weight: .semibold)).foregroundStyle(DK.goldText)
                        .frame(maxWidth: .infinity).padding(.vertical, 8).background(DK.gold, in: RoundedRectangle(cornerRadius: 9))
                }.buttonStyle(.plain)
            }
        }
        .padding(12).background(HK.card, in: RoundedRectangle(cornerRadius: HK.radius))
        .overlay(RoundedRectangle(cornerRadius: HK.radius).stroke(HK.line, lineWidth: 1))
    }
    // PWA sessionLine: 0 punches → grey "no punches"; otherwise "HH:MM → HH:MM" with
    // "open" in blue when there's no out-punch, plus hours + tap-count.
    @ViewBuilder private var sessionLine: some View {
        if (row.punchCount ?? 0) == 0 {
            Text("no punches").font(.system(size: 12)).foregroundStyle(DK.mute)
        } else {
            let i = hm(row.firstInAt) ?? "—"
            let taps = row.punchCount ?? 0
            let hrs = (row.totalHours ?? 0) > 0 ? String(format: " · %.1fh", row.totalHours ?? 0) : ""
            let tapStr = " · \(taps) tap\(taps > 1 ? "s" : "")"
            (Text("\(i) → ").font(.system(size: 12)).foregroundColor(HK.textDim)
             + (row.lastOutAt != nil
                ? Text(hm(row.lastOutAt) ?? "—").font(.system(size: 12)).foregroundColor(HK.textDim)
                : Text("open").font(.system(size: 12)).foregroundColor(DK.blue))
             + Text("\(hrs)\(tapStr)").font(.system(size: 12)).foregroundColor(HK.textDim))
                .lineLimit(1)
        }
    }
    private func hm(_ s: String?) -> String? {
        guard let s, s.count >= 16 else { return nil }
        return String(s.dropFirst(11).prefix(5))   // "yyyy-MM-ddTHH:MM" → HH:MM
    }
    // PWA dot/pill colours: working→blue, present→green, incomplete→yellow, absent→red, off→purple.
    private var dotColor: Color {
        if st.working { return DK.blue }
        switch st.kind {
        case "present": return st.incomplete ? DK.yellow : DK.green
        case "absent": return DK.red
        default: return DK.purple   // off
        }
    }
}

// MARK: - Pay

struct DarbarPayTab: View {
    @ObservedObject var model: DarbarAppModel
    @Binding var sheet: DarbarSheet?
    private let accent = DarbarView.accent

    var body: some View {
        // PWA subtitle is the static tagline, not a stat line.
        DarbarScreen(title: "Pay", subtitle: "Settle or advance — anyone, any day", trailing: {
            Button { sheet = .advance(nil) } label: {
                Image(systemName: "plus.circle.fill").font(.system(size: 19, weight: .semibold)).foregroundStyle(accent)
            }.buttonStyle(.plain)
        }) {
            VStack(spacing: 10) {
                // PWA control order: month banner → brand chips → Settle/Pay-advance → Month board → section.
                settleBanner
                DarbarBrandSeg(sel: $model.payBrand)
                actionsRow
                ScrollView {
                    LazyVStack(spacing: 9) {
                        if !model.payPeople.isEmpty || model.loadingPay {
                            sectionLabel("PAYMENTS THIS MONTH", trailing: monthLabel(model.payMonth).uppercased(), trailingColor: accent).padding(.horizontal, 12)
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

    // Month navigator + active-period hint (PWA settleBanner). Arrows are outlined ghost
    // buttons (rounded-square chrome); the month label is white (the gold "JUNE 2026" lives
    // in the section header, not here).
    private var settleBanner: some View {
        HStack(spacing: 10) {
            monthNavBtn("◄") { model.changePayMonth(-1) }
            VStack(spacing: 2) {
                Text(monthLabel(model.payMonth)).font(.system(size: 17, weight: .heavy)).foregroundStyle(HK.text)
                Text(model.isActiveSettlementMonth ? "Salary period being cleared now — paid by the 10th" : "Browsing — ◄ ► to change month")
                    .font(.system(size: 10.5)).foregroundStyle(HK.textDim).lineLimit(1).minimumScaleFactor(0.7)
            }.frame(maxWidth: .infinity)
            monthNavBtn("►") { model.changePayMonth(1) }
        }
        .padding(.vertical, 10).padding(.horizontal, 10)
        .background(HK.card, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(HK.line, lineWidth: 1))
        .padding(.horizontal, 16)
    }
    private func monthNavBtn(_ s: String, _ act: @escaping () -> Void) -> some View {
        Button(action: act) {
            Text(s).font(.system(size: 16, weight: .bold)).foregroundStyle(HK.text)
                .frame(width: 48, height: 38)
                .background(HK.cardHi, in: RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(HK.line, lineWidth: 1))
        }.buttonStyle(.plain)
    }

    private var actionsRow: some View {
        VStack(spacing: 8) {
            HStack(spacing: 8) {
                Button { sheet = .advance(nil) } label: {
                    Text("Settle a person").font(.system(size: 14, weight: .bold)).foregroundStyle(DK.goldText)
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
                        // PWA: green "✓ SETTLED" pill (uppercased by .pill CSS).
                        Text("✓ SETTLED").font(.system(size: 8.5, weight: .heavy)).foregroundStyle(DK.green)
                            .padding(.horizontal, 6).padding(.vertical, 2).background(DK.greenSoft, in: Capsule())
                    } else {
                        // PWA: gold "ADVANCE ONLY" pill (uppercased by .pill CSS).
                        Text("ADVANCE ONLY").font(.system(size: 8.5, weight: .heavy)).foregroundStyle(DK.gold)
                            .padding(.horizontal, 6).padding(.vertical, 2).background(DK.goldSoft, in: Capsule())
                    }
                }
                breakdown.font(.system(size: 12))
            }
            Spacer()
            Text(inrLabel(p.total)).font(.system(size: 16, weight: .heavy, design: .rounded)).foregroundStyle(HK.text).monospacedDigit()
            Image(systemName: "chevron.right").font(.system(size: 12, weight: .bold)).foregroundStyle(HK.textFaint)
        }
        .padding(13).background(HK.card, in: RoundedRectangle(cornerRadius: HK.radius))
        .overlay(RoundedRectangle(cornerRadius: HK.radius).stroke(HK.line, lineWidth: 1))
    }
    // "advance ₹X + settlement ₹Y · month complete · tap for the trail" — settled rows include
    // the "· month complete" segment; "tap for the trail" is gold. 1:1 with the PWA.
    private var breakdown: Text {
        var parts: [String] = []
        if p.advTotal > 0 { parts.append("advance \(inrLabel(p.advTotal))") }
        if p.setTotal > 0 { parts.append("settlement \(inrLabel(p.setTotal))") }
        let amounts = parts.isEmpty ? "—" : parts.joined(separator: " + ")
        let mid = p.settled ? "\(amounts) · month complete · " : "\(amounts) · "
        return Text(mid).foregroundColor(HK.textDim) + Text("tap for the trail").foregroundColor(DK.gold)
    }
}

// MARK: - Roster

struct DarbarRosterTab: View {
    @ObservedObject var model: DarbarAppModel
    @Binding var sheet: DarbarSheet?
    var body: some View {
        DarbarScreen(title: "Roster", subtitle: "\(model.rosterFiltered.count) serving · tap a person for their month", trailing: {
            Button { Task { await model.loadRoster() } } label: {
                Image(systemName: "arrow.clockwise").font(.system(size: 16, weight: .bold)).foregroundStyle(HK.textDim)
            }.buttonStyle(.plain)
        }) {
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
    // PWA: sentence-case title with the gold amount inline on the RIGHT, then a descriptor line
    // where "N missing salary" is its own red token.
    private var costCard: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline) {
                Text("Monthly staffing cost").font(.system(size: 15, weight: .bold)).foregroundStyle(HK.text)
                Spacer()
                Text(inrLabel(model.rosterMonthlyCost)).font(.system(size: 19, weight: .heavy, design: .rounded)).foregroundStyle(DK.gold).monospacedDigit()
            }
            (
                Text("\(model.rosterBrand == "all" ? "all outlets" : model.rosterBrand) · \(model.rosterFiltered.count) staff · full attendance, before OT").foregroundColor(HK.textDim)
                + (model.rosterMissingPay > 0 ? Text(" · \(model.rosterMissingPay) missing salary").foregroundColor(DK.red) : Text(""))
            ).font(.system(size: 11))
        }
        .padding(14).frame(maxWidth: .infinity, alignment: .leading)
        .background(HK.card, in: RoundedRectangle(cornerRadius: HK.radius))
        .overlay(RoundedRectangle(cornerRadius: HK.radius).stroke(DK.goldSoft, lineWidth: 1))
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
                    if e.pin == nil { Text("no pin").font(.system(size: 9, weight: .heavy)).foregroundStyle(DK.yellow)
                        .padding(.horizontal, 6).padding(.vertical, 2).background(DK.yellowSoft, in: Capsule()) }
                }
                Text("\(e.jobName ?? "") \(e.pin.map { "· PIN \($0)" } ?? "") · \(e.payType ?? "")").font(.system(size: 12)).foregroundStyle(HK.textDim).lineLimit(1)
            }
            Spacer()
            if fin { Text(e.payLabel).font(.system(size: 13, weight: .bold)).foregroundStyle(e.hasPay ? HK.text : DK.yellow).monospacedDigit() }
        }
        .padding(12).background(HK.card, in: RoundedRectangle(cornerRadius: HK.radius))
        .overlay(RoundedRectangle(cornerRadius: HK.radius).stroke(HK.line, lineWidth: 1))
    }
}
