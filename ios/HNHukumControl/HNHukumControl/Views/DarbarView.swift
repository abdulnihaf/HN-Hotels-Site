import SwiftUI

// Darbar entry. Gated: if no token (or token expired) show the court gate, else the TODAY inbox.
// READ-ONLY — shows the exception inbox; resolve / exit / pay are execution (out of scope here).
struct DarbarView: View {
    @StateObject private var model = DarbarAppModel()
    private let accent = Color(hex: 0x9E3B4D)   // court hue

    var body: some View {
        Group {
            if model.needsAuth {
                DarbarGateView { await model.onAuthenticated() }
            } else {
                DarbarTodayView(model: model, accent: accent)
            }
        }
        .task { await model.bootstrap() }
    }
}

struct DarbarTodayView: View {
    @ObservedObject var model: DarbarAppModel
    let accent: Color

    var body: some View {
        ZStack {
            HK.bg.ignoresSafeArea()
            VStack(spacing: 0) {
                ChamberHeader(title: "Darbar", subtitle: model.statusLine, accent: accent)
                ScrollView {
                    VStack(spacing: 14) {
                        heroBand
                        camsHealth
                        inbox
                    }
                    .padding(.horizontal, 16).padding(.bottom, 18)
                }
                .scrollIndicators(.hidden)
                .refreshable { await model.refresh() }
            }
        }
        .navigationTitle("Darbar").navigationBarTitleDisplayMode(.inline)
    }

    // 4-stat hero band: Present / In-progress / Missing-punch / Absent.
    private var heroBand: some View {
        let s = model.stats
        return HStack(spacing: 10) {
            statCell("Present", s?.present, HK.ready)
            statCell("In progress", s?.inProgress, HK.running)
            statCell("Missing", s?.missingPunch, accent)
            statCell("Absent", s?.absent, HK.error)
        }
    }

    private func statCell(_ label: String, _ value: Int?, _ tint: Color) -> some View {
        VStack(spacing: 5) {
            Text(value.map(String.init) ?? "–")
                .font(.system(size: 26, weight: .heavy, design: .rounded))
                .foregroundStyle(value == nil ? HK.textFaint : tint)
            Text(label.uppercased())
                .font(.system(size: 9.5, weight: .heavy)).tracking(0.3)
                .foregroundStyle(HK.textFaint)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 14)
        .background(HK.card, in: RoundedRectangle(cornerRadius: HK.radiusSm))
        .overlay(RoundedRectangle(cornerRadius: HK.radiusSm).stroke(HK.line, lineWidth: 1))
    }

    // CAMS device health strip — honest when the device is quiet/stale.
    @ViewBuilder
    private var camsHealth: some View {
        if let h = model.home?.health {
            let ok = h.camsOk ?? false
            HStack(spacing: 8) {
                Circle().fill(ok ? HK.ready : HK.error).frame(width: 8, height: 8)
                Text(ok ? "CAMS live" : "CAMS attention")
                    .font(.system(size: 12, weight: .bold)).foregroundStyle(HK.text)
                if let age = h.camsLastPunchAgeMin {
                    Text("· last punch \(age)m ago")
                        .font(.system(size: 12)).foregroundStyle(HK.textDim)
                }
                if h.camsQuietHours == true {
                    Text("· quiet hours").font(.system(size: 12)).foregroundStyle(HK.textFaint)
                }
                Spacer()
                if let g = h.ghostCount, g > 0 {
                    Text("\(g) ghost").font(.system(size: 11, weight: .heavy))
                        .foregroundStyle(accent)
                        .padding(.horizontal, 8).padding(.vertical, 3)
                        .background(accent.opacity(0.16), in: Capsule())
                }
            }
            .padding(.horizontal, 13).padding(.vertical, 11)
            .background(HK.bgElev, in: RoundedRectangle(cornerRadius: HK.radiusSm))
            .overlay(RoundedRectangle(cornerRadius: HK.radiusSm).stroke(HK.lineSoft, lineWidth: 1))
        }
    }

    // The exception inbox, grouped by type.
    @ViewBuilder
    private var inbox: some View {
        if model.exceptions.isEmpty {
            VStack(spacing: 8) {
                Image(systemName: "checkmark.seal.fill").font(.system(size: 30)).foregroundStyle(HK.ready)
                Text("No exceptions today").font(.system(size: 15, weight: .semibold)).foregroundStyle(HK.textDim)
                Text(model.statusLine).font(.system(size: 12)).foregroundStyle(HK.textFaint)
            }
            .frame(maxWidth: .infinity).padding(.top, 40)
        } else {
            VStack(alignment: .leading, spacing: 14) {
                exceptionGroup("Ghost identities", "Punching with no roster match",
                               model.ghosts, "questionmark.circle.fill")
                exceptionGroup("Chronic missed punches", "Repeated odd days",
                               model.chronicMissed, "exclamationmark.arrow.triangle.2.circlepath")
                exceptionGroup("Pay missing", "No pay record",
                               model.payMissing, "indianrupeesign.circle.fill")
            }
        }
    }

    @ViewBuilder
    private func exceptionGroup(_ title: String, _ subtitle: String,
                                _ rows: [DarbarException], _ icon: String) -> some View {
        if !rows.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 8) {
                    Image(systemName: icon).font(.system(size: 13, weight: .bold)).foregroundStyle(accent)
                    Text(title.uppercased()).font(.system(size: 11.5, weight: .heavy)).tracking(0.4)
                        .foregroundStyle(HK.textDim)
                    Text("\(rows.count)").font(.system(size: 11, weight: .heavy)).foregroundStyle(HK.textFaint)
                    Spacer()
                }
                ForEach(rows) { DarbarExceptionRow(ex: $0, token: model.token, accent: accent) }
            }
        }
    }
}

// One exception card: CAMS face (AsyncImage, initials fallback) + identity + the type-specific evidence.
struct DarbarExceptionRow: View {
    let ex: DarbarException
    let token: String?
    let accent: Color

    var body: some View {
        HStack(spacing: 12) {
            face
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(ex.displayName)
                        .font(.system(size: 15.5, weight: .bold)).foregroundStyle(HK.text)
                        .lineLimit(1)
                    if let b = ex.brand, !b.isEmpty {
                        Text(b).font(.system(size: 9.5, weight: .heavy))
                            .foregroundStyle(HK.textFaint)
                            .padding(.horizontal, 6).padding(.vertical, 2)
                            .background(HK.bgElev, in: Capsule())
                    }
                }
                Text(evidence).font(.system(size: 12)).foregroundStyle(HK.textDim).lineLimit(2)
            }
            Spacer(minLength: 4)
            // READ-ONLY: a disabled placeholder where the resolve action will live (execution, out of scope).
            Image(systemName: "chevron.right")
                .font(.system(size: 13, weight: .bold)).foregroundStyle(HK.textFaint.opacity(0.5))
        }
        .padding(13)
        .background(HK.card, in: RoundedRectangle(cornerRadius: HK.radius))
        .overlay(RoundedRectangle(cornerRadius: HK.radius).stroke(HK.line, lineWidth: 1))
    }

    // CAMS face by pin; initials circle when there's no pin or the image fails.
    @ViewBuilder
    private var face: some View {
        let size: CGFloat = 46
        if let pin = ex.pin, let token, let url = DarbarClient.photoURL(pin: pin, token: token) {
            AsyncImage(url: url) { phase in
                switch phase {
                case .success(let img):
                    img.resizable().scaledToFill()
                default:
                    initials
                }
            }
            .frame(width: size, height: size)
            .clipShape(Circle())
            .overlay(Circle().stroke(accent.opacity(0.4), lineWidth: 1.4))
        } else {
            initials
                .frame(width: size, height: size)
                .overlay(Circle().stroke(accent.opacity(0.4), lineWidth: 1.4))
        }
    }

    private var initials: some View {
        ZStack {
            Circle().fill(accent.opacity(0.18))
            Text(initialsText)
                .font(.system(size: 16, weight: .heavy, design: .rounded))
                .foregroundStyle(accent)
        }
    }

    private var initialsText: String {
        let parts = ex.displayName.split(separator: " ").prefix(2)
        let s = parts.compactMap { $0.first }.map(String.init).joined()
        return s.isEmpty ? "?" : s.uppercased()
    }

    // Type-specific one-liner of evidence (honest, no fabricated numbers).
    private var evidence: String {
        switch ex.type {
        case "ghost":
            var bits: [String] = []
            if let p = ex.punches, let d = ex.days { bits.append("\(p) punches / \(d)d") }
            if let s = ex.shape { bits.append(s) }
            if let ls = ex.daysSilent, ls > 0 { bits.append("silent \(ls)d") }
            else if let last = ex.lastPunch { bits.append("last \(last)") }
            return bits.isEmpty ? "Ghost — no roster match" : bits.joined(separator: " · ")
        case "chronic_missed":
            if let o = ex.oddDays { return "\(o) odd days · PIN \(ex.pin ?? "?")" }
            return "Repeated missed punches"
        case "pay_missing":
            return ex.pin.map { "No pay record · PIN \($0)" } ?? "No pay record"
        default:
            return ex.type ?? "Exception"
        }
    }
}
