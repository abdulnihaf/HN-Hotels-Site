import UIKit
import UserNotifications

final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        HukumNotificationController.shared.registerCategories()
        HukumBackgroundRefresh.register()
        HukumBackgroundRefresh.schedule()
        application.registerForRemoteNotifications()
        // sim/test hook: seed the per-chamber vault so the silent flow is verifiable off-device
        if let seed = ProcessInfo.processInfo.environment["HUKUM_SEED_PIN"], !seed.isEmpty {
            for c in ["sauda", "hisab", "takht", "darbar", "owner"] { DiwanAuth.setCredential(seed, chamber: c) }
        }
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let token = deviceToken.map { String(format: "%02.2hhx", $0) }.joined()
        Task { await HukumClient.shared.registerNativePushToken(token) }
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        HukumLog.shared.add("APNs registration failed: \(error.localizedDescription)")
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .sound, .list]
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        let userInfo = response.notification.request.content.userInfo
        let session = userInfo["session"] as? String
        let title = userInfo["title"] as? String
        let slot = userInfo["slot"] as? String
        switch response.actionIdentifier {
        case HukumNotificationAction.listen.rawValue, UNNotificationDefaultActionIdentifier:
            if let session {
                await HukumAudioQueue.shared.enqueue(session: session, title: title ?? slot ?? "Hukum")
            }
        case HukumNotificationAction.queue.rawValue:
            if let session {
                await HukumAudioQueue.shared.enqueue(session: session, title: title ?? slot ?? "Hukum")
            }
            HukumLog.shared.add("Queued \(title ?? slot ?? "lane") for reading.")
        case HukumNotificationAction.open.rawValue:
            HukumLog.shared.add("Opened \(title ?? slot ?? "Hukum") from notification.")
        case HukumNotificationAction.stop.rawValue:
            await MainActor.run { HukumAudioQueue.shared.stopCurrent() }
        default:
            break
        }
    }
}

