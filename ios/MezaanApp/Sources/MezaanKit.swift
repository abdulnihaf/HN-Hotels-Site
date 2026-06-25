import SwiftUI

// Mezaan — the balance/scale that weighs and shows the state of everything.
// HN Hukum dark cockpit tokens, kept byte-faithful to the design system so the board
// reads like the rest of the court. Self-contained; no dependency on the Hukum app.

enum HK {
    static let bg        = Color(hex: 0x140A07)
    static let bgElev    = Color(hex: 0x1D0F0B)
    static let card      = Color(hex: 0x241310)
    static let line      = Color(hex: 0x3A201A)
    static let text      = Color(hex: 0xF4E9E2)
    static let textDim   = Color(hex: 0xB79A8D)
    static let textFaint = Color(hex: 0x836A5D)
    static let accent    = Color(hex: 0xC8642D)
    static let amber     = Color(hex: 0xE0A33C)
    static let ready     = Color(hex: 0x7FDC8A)
    static let danger    = Color(hex: 0xFFB4A0)

    static func engine(_ app: String?) -> Color {
        switch (app ?? "").lowercased() {
        case "claude": return Color(hex: 0xD97757)
        case "codex":  return Color(hex: 0x6AA9FF)
        case "kimi":   return Color(hex: 0x9DF29A)
        default:       return HK.textFaint
        }
    }
    static func engineLabel(_ app: String?) -> String {
        switch (app ?? "").lowercased() {
        case "claude": return "Claude"
        case "codex":  return "Codex"
        case "kimi":   return "Kimi"
        default:       return (app ?? "—").capitalized
        }
    }
}

extension Color {
    init(hex: UInt, alpha: Double = 1) {
        self.init(.sRGB,
                  red: Double((hex >> 16) & 0xff) / 255,
                  green: Double((hex >> 8) & 0xff) / 255,
                  blue: Double(hex & 0xff) / 255,
                  opacity: alpha)
    }
}

// A section heading with a leading SF symbol + a count chip.
struct SectionHead: View {
    let icon: String
    let title: String
    var count: Int? = nil
    var tint: Color = HK.text
    var body: some View {
        HStack(spacing: 7) {
            Image(systemName: icon).font(.system(size: 14, weight: .semibold)).foregroundStyle(tint)
            Text(title).font(.system(size: 13, weight: .heavy)).foregroundStyle(tint).textCase(nil)
            if let c = count {
                Text("\(c)").font(.system(size: 11, weight: .heavy)).foregroundStyle(HK.bg)
                    .padding(.horizontal, 6).padding(.vertical, 1)
                    .background(tint, in: Capsule())
            }
            Spacer()
        }
    }
}

// Small colored capsule.
struct Pill: View {
    let text: String
    var fg: Color = HK.textDim
    var bg: Color = HK.card
    var body: some View {
        Text(text).font(.system(size: 10.5, weight: .heavy))
            .foregroundStyle(fg)
            .padding(.horizontal, 7).padding(.vertical, 2)
            .background(bg, in: Capsule())
    }
}
