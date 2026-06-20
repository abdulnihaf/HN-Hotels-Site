import Foundation
import ActivityKit

struct HukumActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var activeLane: String
        var runningCount: Int
        var readyCount: Int
        var lastEvent: String
        var nazarState: String?
        var nazarEvent: String?
    }

    var title: String
}
