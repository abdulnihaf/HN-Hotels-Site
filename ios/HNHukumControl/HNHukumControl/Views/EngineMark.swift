import SwiftUI

// Engine identity. Distinct, brand-coloured marks for Codex / Claude / Kimi so you read the
// engine at a glance, not just a word. (Recognisable glyphs now; drop official logo SVGs into
// an asset catalog and switch `symbol` to `Image("codex-logo")` etc. for pixel-exact marks.)
struct EngineMark: View {
    let app: String?
    var size: CGFloat = 13

    var body: some View {
        Image(systemName: symbol)
            .font(.system(size: size, weight: .bold))
            .foregroundStyle(HK.engine(app))
    }

    private var symbol: String {
        switch (app ?? "codex").lowercased() {
        case "claude": return "sparkle"                 // Anthropic burst
        case "kimi":   return "moon.stars.fill"          // Moonshot
        default:       return "circle.hexagongrid.fill"  // OpenAI / Codex
        }
    }
}

// The engine tag used across lane cards, session rows and run rows.
struct EngineChip: View {
    let app: String?

    var body: some View {
        HStack(spacing: 5) {
            EngineMark(app: app, size: 11)
            Text((app ?? "codex").uppercased())
                .font(.system(size: 11, weight: .heavy))
        }
        .foregroundStyle(HK.engine(app))
        .padding(.horizontal, 8).padding(.vertical, 4)
        .background(HK.engine(app).opacity(0.15), in: Capsule())
    }
}
