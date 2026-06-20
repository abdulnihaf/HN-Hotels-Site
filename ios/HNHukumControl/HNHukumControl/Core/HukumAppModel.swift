import Foundation
import Combine
import ActivityKit

@MainActor
final class HukumAppModel: ObservableObject {
    @Published var lanes: [HukumLaneState] = []
    @Published var sessions: [HukumSession] = []
    @Published var history: [HukumRouteHistory] = []
    @Published var activeAlias: String = ""
    @Published var selectedSession: String = ""
    @Published var statusLine: String = "Ready"
    @Published var isRefreshing = false

    private var pollTask: Task<Void, Never>?
    private var lastNotifiedHashBySession: [String: String] = UserDefaults.standard.dictionary(forKey: "hukum.lastNotifiedHash") as? [String: String] ?? [:]
    private var autoReadSeeded = false
    private var lastReadHashBySession: [String: String] = [:]

    func bootstrap() async {
        let demo = ProcessInfo.processInfo.arguments.contains("-hukumDemo")
            || ProcessInfo.processInfo.environment["HUKUM_DEMO"] == "1"
        if demo {
            lanes = HukumDemoData.lanes
            history = HukumDemoData.history
            activeAlias = "ambar"
            statusLine = "\(lanes.count) live lanes"
            return
        }
        await refresh()
        startPolling()
    }

    func refresh() async {
        isRefreshing = true
        defer { isRefreshing = false }
        do {
            let response = try await HukumClient.shared.state()
            lanes = response.states
            sessions = (try? await HukumClient.shared.sessions()) ?? sessions
            history = response.history ?? []
            activeAlias = response.active ?? ""
            selectedSession = response.selectedSession ?? ""
            statusLine = "\(lanes.count) live lanes"
            if !lanes.isEmpty { HukumNotificationController.shared.requestAuthorizationIfNeeded() }
            processAutoRead(response.states)
            processFinalAnswerNotifications(from: response.states)
            HukumLiveActivityController.shared.update(from: response)
        } catch {
            statusLine = "Bridge error: \(error.localizedDescription)"
            HukumLog.shared.add(statusLine)
        }
    }

    func select(_ lane: HukumLaneState) async {
        do {
            _ = try await HukumClient.shared.selectLane(alias: lane.alias ?? lane.displaySlot)
            statusLine = "\(lane.displaySlot) selected"
            await refresh()
        } catch {
            statusLine = "Select failed: \(error.localizedDescription)"
        }
    }

    func send(text: String, lane: HukumLaneState?) async {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        let command: String
        if let lane, let slot = lane.slot {
            command = "\(slot.lowercased()) \(trimmed)"
        } else {
            command = trimmed
        }
        do {
            let response = try await HukumClient.shared.sendPrompt(command)
            statusLine = response.route?.note ?? "Sent to Hukum"
            await refresh()
        } catch {
            statusLine = "Send failed: \(error.localizedDescription)"
        }
    }

    func read(_ lane: HukumLaneState) async {
        await HukumAudioQueue.shared.enqueue(session: lane.session, title: lane.displayTitle)
    }

    func stopAudio() {
        HukumAudioQueue.shared.stopCurrent()
    }

    private func startPolling() {
        pollTask?.cancel()
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 3_000_000_000)
                await self?.refresh()
            }
        }
    }

    // Auto-read: speak each NEW final answer aloud as it finishes. Seeds a baseline on the first
    // pass so the existing backlog is never read — only answers that complete while you're watching.
    private func processAutoRead(_ states: [HukumLaneState]) {
        let on = HukumSettings.shared.autoRead
        let firstPass = !autoReadSeeded
        autoReadSeeded = true
        for lane in states {
            guard let hash = lane.latest?.hash, !hash.isEmpty else { continue }
            let prev = lastReadHashBySession[lane.session]
            let isNewFinal = on && !firstPass
                && lane.latest?.meaningful == true && lane.latest?.finalized == true
                && prev != nil && prev != hash
            lastReadHashBySession[lane.session] = hash
            if isNewFinal {
                Task { await HukumAudioQueue.shared.enqueue(session: lane.session, title: lane.displayTitle) }
                if HukumSettings.shared.autoReadMode == "oneshot" {
                    HukumSettings.shared.autoRead = false
                }
            }
        }
    }

    private func processFinalAnswerNotifications(from states: [HukumLaneState]) {
        for lane in states {
            guard lane.latest?.meaningful == true, lane.latest?.finalized == true else { continue }
            guard let hash = lane.latest?.hash, !hash.isEmpty else { continue }
            if lastNotifiedHashBySession[lane.session] == hash { continue }
            lastNotifiedHashBySession[lane.session] = hash
            HukumNotificationController.shared.notifyFinalAnswer(lane: lane)
        }
        UserDefaults.standard.set(lastNotifiedHashBySession, forKey: "hukum.lastNotifiedHash")
    }
}

final class HukumLog: ObservableObject {
    static let shared = HukumLog()
    @Published private(set) var lines: [String] = []

    func add(_ line: String) {
        DispatchQueue.main.async {
            self.lines.insert(line, at: 0)
            self.lines = Array(self.lines.prefix(30))
        }
    }
}
