import WidgetKit
import SwiftUI
import ActivityKit

private enum HKW {
    static let amber  = Color(red: 0.941, green: 0.706, blue: 0.235)
    static let green  = Color(red: 0.224, green: 0.851, blue: 0.541)
    static let dim    = Color(white: 0.62)
    static let bg     = Color(red: 0.043, green: 0.043, blue: 0.051)
}

struct HukumActivityLiveView: View {
    let context: ActivityViewContext<HukumActivityAttributes>

    var body: some View {
        HStack(alignment: .center, spacing: 14) {
            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 6) {
                    Image(systemName: "command")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(HKW.amber)
                    Text("HUKUM")
                        .font(.system(size: 12, weight: .heavy))
                        .tracking(1.5)
                        .foregroundStyle(.white)
                }
                Text(context.state.lastEvent)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(.white)
                    .lineLimit(1)
                if let nazar = context.state.nazarEvent ?? context.state.nazarState {
                    Text(nazar)
                        .font(.system(size: 12))
                        .foregroundStyle(HKW.dim)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 6)
            HStack(spacing: 14) {
                countPill(context.state.runningCount, "working", HKW.amber)
                countPill(context.state.readyCount, "ready", HKW.green)
            }
        }
        .padding(16)
        .activityBackgroundTint(HKW.bg)
        .activitySystemActionForegroundColor(HKW.amber)
    }

    private func countPill(_ n: Int, _ label: String, _ color: Color) -> some View {
        VStack(spacing: 2) {
            Text("\(n)")
                .font(.system(size: 22, weight: .heavy, design: .rounded))
                .foregroundStyle(color)
            Text(label)
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(HKW.dim)
        }
    }
}

@main
struct HNHukumActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: HukumActivityAttributes.self) { context in
            HukumActivityLiveView(context: context)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Text(context.state.activeLane.uppercased())
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(context.state.nazarState ?? "\(context.state.readyCount) ready")
                }
                DynamicIslandExpandedRegion(.bottom) {
                    Text(context.state.nazarEvent ?? context.state.lastEvent)
                        .lineLimit(1)
                }
            } compactLeading: {
                Text("HN")
            } compactTrailing: {
                Text(context.state.nazarState.map { String($0.prefix(1)) } ?? "\(context.state.readyCount)")
            } minimal: {
                Text("H")
            }
        }
    }
}
