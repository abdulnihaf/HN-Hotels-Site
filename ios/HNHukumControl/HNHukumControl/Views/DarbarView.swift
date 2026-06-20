import SwiftUI

// Darbar — "the Court". FULLY NATIVE port of the deployed PWA: four tabs (Today / Attendance / Pay /
// Roster) with the real execution — pay advance, settle, set-pay, mark-exit, on-leave, onboard,
// dismiss-ghost, fix-punch — all wired to the live endpoints. Accent 0x5B86C9 is the only per-chamber
// colour; everything else is the shared HK kit. Read-glance first, one-tap to act, honest states.
struct DarbarView: View {
    @StateObject private var model = DarbarAppModel()
    static let accent = Color(hex: 0x5B86C9)
    private var accent: Color { Self.accent }
    @State private var tab = 0
    @State private var sheet: DarbarSheet?

    var body: some View {
        ZStack(alignment: .bottom) {
            TabView(selection: $tab) {
                DarbarTodayTab(model: model, sheet: $sheet).tag(0)
                    .tabItem { Label("Today", systemImage: "house.fill") }
                DarbarAttendanceTab(model: model).tag(1)
                    .tabItem { Label("Attendance", systemImage: "calendar") }
                DarbarPayTab(model: model, sheet: $sheet).tag(2)
                    .tabItem { Label("Pay", systemImage: "indianrupeesign.circle.fill") }
                DarbarRosterTab(model: model, sheet: $sheet).tag(3)
                    .tabItem { Label("Roster", systemImage: "person.3.fill") }
            }
            .tint(accent)
            toast
        }
        .task { await model.bootstrap() }
        .sheet(item: $sheet) { s in DarbarSheetHost(sheet: s, model: model).presentationDragIndicator(.visible) }
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
    case settle(id: Int, name: String)
    case editAdvance(AdvanceRow)

    var id: String {
        switch self {
        case .advance(let e): return "adv-\(e?.id ?? 0)"
        case .setPay(let i, _): return "setpay-\(i)"
        case .exit(let i, _): return "exit-\(i)"
        case .leave(let i, _): return "leave-\(i)"
        case .onboard(let p, _): return "onb-\(p)"
        case .settle(let i, _): return "settle-\(i)"
        case .editAdvance(let r): return "edit-\(r.id)"
        }
    }
}

struct DarbarSheetHost: View {
    let sheet: DarbarSheet
    @ObservedObject var model: DarbarAppModel
    var body: some View {
        switch sheet {
        case .advance(let e):           PayAdvanceSheet(model: model, preset: e)
        case .setPay(let id, let n):    SetPaySheet(model: model, id: id, name: n)
        case .exit(let id, let n):      MarkExitSheet(model: model, id: id, name: n)
        case .leave(let id, let n):     MarkLeaveSheet(model: model, id: id, name: n)
        case .onboard(let p, let n):    OnboardSheet(model: model, pin: p, deviceName: n)
        case .settle(let id, let n):    SettleSheet(model: model, id: id, name: n)
        case .editAdvance(let r):       EditAdvanceSheet(model: model, row: r)
        }
    }
}

// MARK: - shared bits

struct DarbarScreen<Content: View>: View {
    let title: String
    let subtitle: String
    @ViewBuilder var content: () -> Content
    var body: some View {
        ZStack {
            HK.bg.ignoresSafeArea()
            VStack(spacing: 0) {
                ChamberHeader(title: title, subtitle: subtitle, accent: DarbarView.accent)
                content()
            }
        }
    }
}

func darbarBrandChip(_ b: String?, accent: Color = DarbarView.accent) -> some View {
    Group {
        if let b, !b.isEmpty {
            Text(b.uppercased()).font(.system(size: 9, weight: .heavy)).tracking(0.3)
                .foregroundStyle(accent).padding(.horizontal, 6).padding(.vertical, 2)
                .background(accent.opacity(0.16), in: Capsule())
        }
    }
}

struct DarbarBrandSeg: View {
    @Binding var sel: String
    var body: some View {
        HStack(spacing: 2) {
            ForEach(["all", "HE", "NCH", "HQ"], id: \.self) { b in
                let on = sel == b
                Text(b == "all" ? "All" : b)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(on ? .black : HK.textDim)
                    .frame(maxWidth: .infinity).padding(.vertical, 7)
                    .background(on ? DarbarView.accent : Color.clear, in: RoundedRectangle(cornerRadius: 9))
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
        .overlay(Circle().stroke(DarbarView.accent.opacity(0.4), lineWidth: 1.4))
    }
    private var initials: some View {
        ZStack {
            Circle().fill(DarbarView.accent.opacity(0.18))
            Text(initialsText).font(.system(size: size * 0.34, weight: .heavy, design: .rounded)).foregroundStyle(DarbarView.accent)
        }
    }
    private var initialsText: String {
        let p = name.split(separator: " ").prefix(2).compactMap { $0.first }.map(String.init).joined()
        return p.isEmpty ? "?" : p.uppercased()
    }
}

func inrLabel(_ v: Double?) -> String {
    let f = NumberFormatter(); f.numberStyle = .decimal; f.maximumFractionDigits = 0; f.locale = Locale(identifier: "en_IN")
    return "₹" + (f.string(from: NSNumber(value: (v ?? 0).rounded())) ?? "0")
}
