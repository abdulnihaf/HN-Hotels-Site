import Foundation
import BackgroundTasks

enum HukumBackgroundRefresh {
    static let identifier = "com.hnhotels.hukum.refresh"

    static func register() {
        BGTaskScheduler.shared.register(forTaskWithIdentifier: identifier, using: nil) { task in
            handle(task: task as! BGAppRefreshTask)
        }
    }

    static func schedule() {
        let request = BGAppRefreshTaskRequest(identifier: identifier)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60)
        try? BGTaskScheduler.shared.submit(request)
    }

    private static func handle(task: BGAppRefreshTask) {
        schedule()
        let operation = Task {
            do {
                let state = try await HukumClient.shared.state()
                await MainActor.run {
                    HukumLiveActivityController.shared.update(from: state)
                }
                task.setTaskCompleted(success: true)
            } catch {
                task.setTaskCompleted(success: false)
            }
        }
        task.expirationHandler = { operation.cancel() }
    }
}

