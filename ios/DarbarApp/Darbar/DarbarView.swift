import SwiftUI

// Darbar — "the Court". FULLY NATIVE port of the deployed PWA: four tabs (Today / Attendance / Pay /
// Roster) with the real execution — pay advance, settle, set-pay, mark-exit, on-leave, onboard,
// dismiss-ghost, fix-punch — all wired to the live endpoints. Accent is the PWA's GOLD (--gold #D4A24C),
// matched 1:1 to the deployed web app; everything else is the shared HK kit. Read-glance first,
// one-tap to act, honest states.
struct DarbarView: View {
    @StateObject private var model = DarbarAppModel()
    static let accent = DK.gold
    private var accent: Color { Self.accent }
    @State private var tab = 0
    @State private var sheet: DarbarSheet?

    var body: some View {
        ZStack(alignment: .bottom) {
            TabView(selection: $tab) {
                DarbarTodayTab(model: model, sheet: $sheet).tag(0)
                    .tabItem { Label("Today", systemImage: "house.fill") }
                    .badge(model.exceptionCount)            // red "N to handle" count on Today (PWA todayDot)
                DarbarAttendanceTab(model: model, sheet: $sheet).tag(1)
                    .tabItem { Label("Attendance", systemImage: "calendar") }
                DarbarPayTab(model: model, sheet: $sheet).tag(2)
                    .tabItem { Label("Pay", systemImage: "indianrupeesign.circle.fill") }
                DarbarRosterTab(model: model, sheet: $sheet).tag(3)
                    .tabItem { Label("Roster", systemImage: "person.3.fill") }
            }
            .tint(accent)                                  // active tab = gold (PWA .tab.on)
            toast
        }
        .task { await model.bootstrap() }
        .sheet(item: $sheet) { s in DarbarSheetHost(sheet: s, model: model, sheetBinding: $sheet).presentationDragIndicator(.visible) }
    }

    @ViewBuilder private var toast: some View {
        if let t = model.toast {
            Text(t.text)
                .font(.system(size: 13.5, weight: .semibold)).foregroundStyle(t.ok ? .black : .white)
                .padding(.horizontal, 18).padding(.vertical, 11)
                .background(t.ok ? HK.ready : HK.error, in: Capsule())
                .shadow(color: .black.opacity(0.4), radius: 10, y: 4)
                .padding(.bottom, 96)
                .transition(.move(edge: .bottom).combined(with: .opacity))
                .task { try? await Task.sleep(nanoseconds: 2_200_000_000); model.toast = nil }
        }
    }
}

// MARK: - sheets (one host, enum-driven)

enum DarbarSheet: Identifiable {
    case advance(DarbarEmployee?)
    case setPay(id: Int, name: String)
    case exit(id: Int, name: String)
    case leave(id: Int, name: String)
    case onboard(pin: String, name: String)
    case settle(id: Int, name: String, mode: String)
    case editAdvance(AdvanceRow)
    case salaryOverride(id: Int, name: String)
    case monthBoard
    case account

    var id: String {
        switch self {
        case .advance(let e): return "adv-\(e?.id ?? 0)"
        case .setPay(let i, _): return "setpay-\(i)"
        case .exit(let i, _): return "exit-\(i)"
        case .leave(let i, _): return "leave-\(i)"
        case .onboard(let p, _): return "onb-\(p)"
        case .settle(let i, _, let m): return "settle-\(m)-\(i)"
        case .editAdvance(let r): return "edit-\(r.id)"
        case .salaryOverride(let i, _): return "override-\(i)"
        case .monthBoard: return "board"
        case .account: return "account"
        }
    }
}

struct DarbarSheetHost: View {
    let sheet: DarbarSheet
    @ObservedObject var model: DarbarAppModel
    @Binding var sheetBinding: DarbarSheet?
    var body: some View {
        switch sheet {
        case .advance(let e):              PayAdvanceSheet(model: model, preset: e)
        case .setPay(let id, let n):       SetPaySheet(model: model, id: id, name: n)
        case .exit(let id, let n):         MarkExitSheet(model: model, id: id, name: n)
        case .leave(let id, let n):        MarkLeaveSheet(model: model, id: id, name: n)
        case .onboard(let p, let n):       OnboardSheet(model: model, pin: p, deviceName: n)
        case .settle(let id, let n, let m):SettleSheet(model: model, id: id, name: n, mode: m, sheet: $sheetBinding)
        case .editAdvance(let r):          EditAdvanceSheet(model: model, row: r)
        case .salaryOverride(let id, let n):SalaryOverrideSheet(model: model, id: id, name: n)
        case .monthBoard:                  MonthBoardSheet(model: model, sheet: $sheetBinding)
        case .account:                     AccountSheet(model: model)
        }
    }
}

// MARK: - shared bits

struct DarbarScreen<Content: View, Trailing: View>: View {
    let title: String
    let subtitle: String
    var dateSuffix: String = ""
    var subtitleDanger: Bool = false
    @ViewBuilder var trailing: () -> Trailing
    @ViewBuilder var content: () -> Content
    var body: some View {
        ZStack {
            HK.bg.ignoresSafeArea()
            VStack(spacing: 0) {
                ZStack(alignment: .trailing) {
                    ChamberHeader(title: title, subtitle: subtitle, accent: DarbarView.accent,
                                  dateSuffix: dateSuffix, subtitleDanger: subtitleDanger)
                    trailing().padding(.trailing, 40)   // sit left of the kit's accent dot
                }
                content()
            }
        }
    }
}
extension DarbarScreen where Trailing == EmptyView {
    init(title: String, subtitle: String, dateSuffix: String = "", subtitleDanger: Bool = false,
         @ViewBuilder content: @escaping () -> Content) {
        self.init(title: title, subtitle: subtitle, dateSuffix: dateSuffix, subtitleDanger: subtitleDanger,
                  trailing: { EmptyView() }, content: content)
    }
}

// Brand badge — PWA color-codes per brand (.pill.he=purple, .pill.nch=green, .pill.hq=blue).
func darbarBrandChip(_ b: String?) -> some View {
    Group {
        if let b, !b.isEmpty {
            let c = DK.brandColor(b)
            Text(b.uppercased()).font(.system(size: 9, weight: .heavy)).tracking(0.3)
                .foregroundStyle(c).padding(.horizontal, 6).padding(.vertical, 2)
                .background(c.opacity(0.16), in: Capsule())
        }
    }
}

// Active filter chip = subtle grey pill (--e3 bg, --text), NOT gold — matches PWA .seg button.on.
struct DarbarBrandSeg: View {
    @Binding var sel: String
    var body: some View {
        HStack(spacing: 2) {
            ForEach(["all", "HE", "NCH", "HQ"], id: \.self) { b in
                let on = sel == b
                Text(b == "all" ? "All" : b)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(on ? HK.text : DK.dim)
                    .frame(maxWidth: .infinity).padding(.vertical, 7)
                    .background(on ? DK.segOn : Color.clear, in: RoundedRectangle(cornerRadius: 9))
                    .shadow(color: on ? .black.opacity(0.4) : .clear, radius: 1, y: 1)
                    .onTapGesture { sel = b }
            }
        }
        .padding(3).background(HK.bgElev, in: RoundedRectangle(cornerRadius: 11))
        .padding(.horizontal, 16)
    }
}

struct DarbarFace: View {
    var pin: String?; var id: Int?; var name: String; var token: String?
    var size: CGFloat = 46
    var body: some View {
        Group {
            if let token, let url = DarbarClient.photoURL(pin: pin, id: id, token: token) {
                AsyncImage(url: url) { p in
                    if case .success(let img) = p { img.resizable().scaledToFill() } else { initials }
                }
            } else { initials }
        }
        .frame(width: size, height: size).clipShape(Circle())
        .overlay(Circle().stroke(HK.line, lineWidth: 1))
    }
    private var initials: some View {
        ZStack {
            Circle().fill(DK.gold.opacity(0.16))
            Text(initialsText).font(.system(size: size * 0.34, weight: .heavy, design: .rounded)).foregroundStyle(DK.gold)
        }
    }
    private var initialsText: String {
        let p = name.split(separator: " ").prefix(2).compactMap { $0.first }.map(String.init).joined()
        return p.isEmpty ? "?" : p.uppercased()
    }
}

// Legal name + nickname in grey parens, exactly like the PWA attendance row:
//   known_as && known_as !== name  ->  "Abdul Sabir Khan (Sabir Khan)"  else  "name"
func darbarName(_ legal: String?, nick: String?, size: CGFloat = 14.5, weight: Font.Weight = .semibold) -> Text {
    let name = legal ?? "—"
    var t = Text(name).font(.system(size: size, weight: weight)).foregroundColor(HK.text)
    if let n = nick, !n.isEmpty, n != name {
        t = t + Text(" (\(n))").font(.system(size: size, weight: weight)).foregroundColor(DK.mute)
    }
    return t
}

func inrLabel(_ v: Double?) -> String {
    let f = NumberFormatter(); f.numberStyle = .decimal; f.maximumFractionDigits = 0; f.locale = Locale(identifier: "en_IN")
    return "₹" + (f.string(from: NSNumber(value: (v ?? 0).rounded())) ?? "0")
}
