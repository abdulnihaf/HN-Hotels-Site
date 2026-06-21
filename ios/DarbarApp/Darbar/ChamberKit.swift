import SwiftUI

// Shared chamber header (from the Hukum kit) — chamber name + a one-line live status + accent dot.
struct ChamberHeader: View {
    let title: String
    let subtitle: String
    var accent: Color = HK.accent
    var dateSuffix: String = ""          // e.g. "Sun, 21 Jun" beside the title (PWA todayDate)
    var subtitleDanger: Bool = false     // PWA renders the device-silent status fragment in red

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(title)
                        .font(.system(size: 26, weight: .heavy, design: .rounded))
                        .foregroundStyle(HK.text)
                    if !dateSuffix.isEmpty {
                        Text(dateSuffix)
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(accent)
                    }
                }
                Text(subtitle)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(subtitleDanger ? DK.red : HK.textDim)
                    .lineLimit(1)
            }
            Spacer()
            Circle().fill(accent).frame(width: 10, height: 10)
        }
        .padding(.horizontal, 18).padding(.top, 8).padding(.bottom, 12)
    }
}
