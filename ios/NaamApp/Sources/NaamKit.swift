import SwiftUI

// NaamKit — the minimal shared kit the Naam chamber needs, extracted from the HN Hukum
// design system (HukumTheme + ChamberKit) so the Naam standalone app compiles with no
// dependency on the full Hukum Control app. Kept byte-faithful to the source tokens.

enum HK {
    // Surfaces — Hukum warm-brown identity (matches the PWA --bg #140a07 …)
    static let bg       = Color(hex: 0x140A07)
    static let bgElev   = Color(hex: 0x1D0F0B)
    static let card     = Color(hex: 0x241310)
    static let cardHi   = Color(hex: 0x2E1A14)
    static let line     = Color(hex: 0x3A201A)
    static let lineSoft = Color(hex: 0x2A1610)

    // Text
    static let text      = Color(hex: 0xF4E9E2)
    static let textDim   = Color(hex: 0xB79A8D)
    static let textFaint = Color(hex: 0x836A5D)

    // Signal accent — burnt orange (--acc #c8642d)
    static let accent     = Color(hex: 0xC8642D)
    static let accentSoft = Color(hex: 0xC8642D).opacity(0.16)
    static let accentLine = Color(hex: 0xC8642D).opacity(0.6)

    // Status
    static let running = Color(hex: 0xE0A33C)
    static let ready   = Color(hex: 0x7FDC8A)
    static let idle    = Color(hex: 0x836A5D)
    static let error   = Color(hex: 0xFFB4A0)

    static func engine(_ app: String?) -> Color {
        switch (app ?? "").lowercased() {
        case "claude": return Color(hex: 0xD97757)
        case "codex":  return Color(hex: 0x6AA9FF)
        case "kimi":   return Color(hex: 0x9DF29A)
        default:       return Color(hex: 0xB79A8D)
        }
    }

    static let radius: CGFloat = 18
    static let radiusSm: CGFloat = 12
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

// Shared chamber header (from ChamberKit).
struct ChamberHeader: View {
    let title: String
    let subtitle: String
    var accent: Color = HK.accent

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.system(size: 26, weight: .heavy, design: .rounded))
                    .foregroundStyle(HK.text)
                Text(subtitle)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(HK.textDim)
                    .lineLimit(1)
            }
            Spacer()
            Circle().fill(accent).frame(width: 10, height: 10)
        }
        .padding(.horizontal, 18).padding(.top, 8).padding(.bottom, 12)
    }
}

// Networking error the Naam clients throw (from HukumClient).
enum HukumError: LocalizedError {
    case badURL
    case server(String)

    var errorDescription: String? {
        switch self {
        case .badURL: return "Source URL is invalid."
        case .server(let message): return message
        }
    }
}
