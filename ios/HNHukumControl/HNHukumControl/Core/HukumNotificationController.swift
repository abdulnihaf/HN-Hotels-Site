import Foundation
import UserNotifications

enum HukumNotificationAction: String {
    case listen = "HUKUM_LISTEN"
    case queue = "HUKUM_QUEUE"
    case open = "HUKUM_OPEN"
    case stop = "HUKUM_STOP"
}

final class HukumNotificationController {
    static let shared = HukumNotificationController()

    // Ask once, contextually (after the app has connected) — not on cold launch.
    func requestAuthorizationIfNeeded() {
        let key = "hukum.askedNotif"
        guard !UserDefaults.standard.bool(forKey: key) else { return }
        UserDefaults.standard.set(true, forKey: key)
        requestAuthorization()
    }

    func requestAuthorization() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, error in
            if let error {
                HukumLog.shared.add("Notification permission error: \(error.localizedDescription)")
            } else {
                HukumLog.shared.add(granted ? "Notifications ready." : "Notifications not allowed.")
            }
        }
    }

    func registerCategories() {
        let listen = UNNotificationAction(identifier: HukumNotificationAction.listen.rawValue, title: "Listen", options: [.foreground])
        let queue = UNNotificationAction(identifier: HukumNotificationAction.queue.rawValue, title: "Queue", options: [])
        let open = UNNotificationAction(identifier: HukumNotificationAction.open.rawValue, title: "Open Hukum", options: [.foreground])
        let stop = UNNotificationAction(identifier: HukumNotificationAction.stop.rawValue, title: "Stop", options: [])
        let category = UNNotificationCategory(
            identifier: "HUKUM_FINAL_READY",
            actions: [listen, queue, open, stop],
            intentIdentifiers: [],
            options: [.customDismissAction]
        )
        UNUserNotificationCenter.current().setNotificationCategories([category])
    }

    func notifyFinalAnswer(lane: HukumLaneState) {
        let content = UNMutableNotificationContent()
        content.title = "HN Hukum: \(lane.displaySlot) ready"
        content.body = "\(lane.displayTitle) has a final answer. Tap Listen."
        content.sound = .default
        content.categoryIdentifier = "HUKUM_FINAL_READY"
        content.threadIdentifier = lane.session
        content.userInfo = [
            "session": lane.session,
            "slot": lane.displaySlot,
            "title": lane.displayTitle,
            "hash": lane.latest?.hash ?? ""
        ]
        let request = UNNotificationRequest(
            identifier: "hukum-\(lane.session)-\(lane.latest?.hash ?? UUID().uuidString)",
            content: content,
            trigger: nil
        )
        UNUserNotificationCenter.current().add(request)
    }

    func notifyNazarDegraded(title: String, body: String, key: String) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body.isEmpty ? "Open Nazar for camera health." : body
        content.sound = .default
        content.threadIdentifier = "nazar"
        let request = UNNotificationRequest(
            identifier: "nazar-\(key)",
            content: content,
            trigger: nil
        )
        UNUserNotificationCenter.current().add(request)
    }
}
