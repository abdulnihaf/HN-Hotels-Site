import Foundation
import ActivityKit

@MainActor
final class HukumLiveActivityController {
    static let shared = HukumLiveActivityController()

    private var activity: Activity<HukumActivityAttributes>?
    private var activeLane = "hukum"
    private var runningCount = 0
    private var readyCount = 0
    private var lastEvent = "HN Hukum"
    private var nazarState: String?
    private var nazarEvent: String?

    func update(from response: HukumStateResponse) {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        runningCount = response.states.filter { $0.isRunning }.count
        readyCount = response.states.filter { $0.isFinalReadable }.count
        activeLane = response.active ?? "hukum"
        lastEvent = response.states.first(where: { $0.selected })?.displayTitle ?? "HN Hukum"
        push()
    }

    func updateNazar(state: String, event: String) {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        nazarState = state
        nazarEvent = event
        push()
    }

    private func push() {
        let state = HukumActivityAttributes.ContentState(
            activeLane: activeLane,
            runningCount: runningCount,
            readyCount: readyCount,
            lastEvent: lastEvent,
            nazarState: nazarState,
            nazarEvent: nazarEvent
        )

        Task { @MainActor in
            if let activity {
                await activity.update(ActivityContent(state: state, staleDate: Date().addingTimeInterval(60)))
            } else {
                let attributes = HukumActivityAttributes(title: "HN Hukum")
                activity = try? Activity.request(
                    attributes: attributes,
                    content: ActivityContent(state: state, staleDate: Date().addingTimeInterval(60)),
                    pushType: nil
                )
            }
        }
    }
}
