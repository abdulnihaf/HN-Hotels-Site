import SwiftUI

// Shared chrome every chamber module reuses, so they're consistent + a new one is a small file.
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

// Anbar inventory state → colour.
func anbarStateColor(_ s: String?) -> Color {
    switch (s ?? "").lowercased() {
    case "ok": return HK.ready
    case "low", "recount", "uncounted": return HK.running
    case "out": return HK.error
    case "received": return HK.engine("codex")
    default: return HK.idle
    }
}

struct ChamberTile: View {
    let title: String
    let subtitle: String
    let icon: String
    let accent: Color
    var live: Bool = false
    var badge: Int = 0

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top) {
                ZStack {
                    Circle().fill((live ? accent : HK.textFaint).opacity(0.16)).frame(width: 46, height: 46)
                    Image(systemName: icon)
                        .font(.system(size: 22, weight: .semibold))
                        .foregroundStyle(live ? accent : HK.textFaint)
                }
                Spacer()
                if live && badge > 0 {
                    Text("\(badge)")
                        .font(.system(size: 12, weight: .heavy)).foregroundStyle(.black)
                        .padding(.horizontal, 8).padding(.vertical, 3)
                        .background(HK.accent, in: Capsule())
                } else if live {
                    Circle().fill(HK.ready).frame(width: 8, height: 8)
                } else {
                    Text("soon")
                        .font(.system(size: 10, weight: .bold)).foregroundStyle(HK.textFaint)
                        .padding(.horizontal, 7).padding(.vertical, 3)
                        .background(HK.bgElev, in: Capsule())
                }
            }
            Spacer()
            Text(title).font(.system(size: 20, weight: .bold)).foregroundStyle(HK.text)
            Text(subtitle).font(.system(size: 12.5)).foregroundStyle(HK.textDim).lineLimit(2)
        }
        .padding(16)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(HK.card, in: RoundedRectangle(cornerRadius: 20))
        .overlay(RoundedRectangle(cornerRadius: 20).stroke(live ? accent.opacity(0.5) : HK.line, lineWidth: 1.2))
        .opacity(live ? 1 : 0.62)
    }
}
