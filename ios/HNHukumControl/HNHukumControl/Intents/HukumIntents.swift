import Foundation
import AppIntents

enum HukumLaneOption: String, AppEnum {
    case selected
    case newChat
    case chat1
    case chat2
    case chat3
    case chat4
    case chat5
    case chat6
    case chat7
    case chat8
    case chat9

    static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "Hukum Lane")
    static var caseDisplayRepresentations: [HukumLaneOption: DisplayRepresentation] = [
        .selected: "Selected lane",
        .newChat: "New chat",
        .chat1: "Chat One",
        .chat2: "Chat Two",
        .chat3: "Chat Three",
        .chat4: "Chat Four",
        .chat5: "Chat Five",
        .chat6: "Chat Six",
        .chat7: "Chat Seven",
        .chat8: "Chat Eight",
        .chat9: "Chat Nine"
    ]

    var spokenPrefix: String {
        switch self {
        case .selected: return ""
        case .newChat: return "new chat"
        case .chat1: return "chat one"
        case .chat2: return "chat two"
        case .chat3: return "chat three"
        case .chat4: return "chat four"
        case .chat5: return "chat five"
        case .chat6: return "chat six"
        case .chat7: return "chat seven"
        case .chat8: return "chat eight"
        case .chat9: return "chat nine"
        }
    }

    var alias: String {
        switch self {
        case .selected: return HukumSettings.shared.selectedLanePhrase
        case .newChat: return "new chat"
        default: return spokenPrefix.replacingOccurrences(of: " ", with: "")
        }
    }
}

struct HukumSelectLaneIntent: AppIntent {
    static var title: LocalizedStringResource = "Select Hukum Lane"
    static var description = IntentDescription("Select the active Hukum lane.")
    static var openAppWhenRun = false

    @Parameter(title: "Lane") var lane: HukumLaneOption

    func perform() async throws -> some IntentResult & ProvidesDialog {
        if lane == .newChat {
            return .result(dialog: "New chat does not need selecting. Say send Hukum to new chat.")
        }
        _ = try await HukumClient.shared.selectLane(alias: lane.alias)
        return .result(dialog: "\(lane.spokenPrefix.isEmpty ? "Selected lane" : lane.spokenPrefix) selected.")
    }
}

struct HukumSendPromptIntent: AppIntent {
    static var title: LocalizedStringResource = "Send Hukum Prompt"
    static var description = IntentDescription("Send a spoken prompt to Hukum.")
    static var openAppWhenRun = false

    @Parameter(title: "Prompt") var prompt: String
    @Parameter(title: "Lane", default: .selected) var lane: HukumLaneOption

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let trimmed = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return .result(dialog: "No prompt found.")
        }
        let text = lane.spokenPrefix.isEmpty ? trimmed : "\(lane.spokenPrefix) \(trimmed)"
        let response = try await HukumClient.shared.sendPrompt(text)
        let line = response.route?.note ?? "Prompt sent to Hukum."
        return .result(dialog: IntentDialog(stringLiteral: line))
    }
}

struct HukumReadLatestIntent: AppIntent {
    static var title: LocalizedStringResource = "Read Hukum Latest"
    static var description = IntentDescription("Read the latest final answer for a Hukum lane.")
    static var openAppWhenRun = false

    @Parameter(title: "Lane", default: .selected) var lane: HukumLaneOption

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let response = try await HukumClient.shared.latest(for: lane.spokenPrefix)
        let text = response.text?.trimmingCharacters(in: .whitespacesAndNewlines)
        let note = response.note?.trimmingCharacters(in: .whitespacesAndNewlines)
        let spoken = !(text?.isEmpty ?? true) ? text! : (note?.isEmpty == false ? note! : "No final answer is ready yet.")
        return .result(dialog: IntentDialog(stringLiteral: spoken))
    }
}

struct HukumStopReadingIntent: AppIntent {
    static var title: LocalizedStringResource = "Stop Hukum Reading"
    static var description = IntentDescription("Stop current Hukum audio without clearing queued reads.")
    static var openAppWhenRun = false

    func perform() async throws -> some IntentResult & ProvidesDialog {
        await MainActor.run {
            HukumAudioQueue.shared.stopCurrent()
        }
        return .result(dialog: "Stopped current Hukum audio. Queued reads are still saved.")
    }
}

struct HukumLaneStatusIntent: AppIntent {
    static var title: LocalizedStringResource = "Show Hukum Lane Status"
    static var description = IntentDescription("Speak the current Hukum lane status.")
    static var openAppWhenRun = false

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let state = try await HukumClient.shared.state()
        let lines = state.states.map { lane in
            "\(lane.displaySlot) \(lane.displayTitle): \(lane.healthState ?? "unknown")"
        }
        return .result(dialog: IntentDialog(stringLiteral: lines.joined(separator: ". ")))
    }
}

struct HukumNewChatIntent: AppIntent {
    static var title: LocalizedStringResource = "New Hukum Chat"
    static var description = IntentDescription("Start a new Hukum chat, optionally with a first prompt.")
    static var openAppWhenRun = false

    @Parameter(title: "First prompt", default: "") var prompt: String

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let trimmed = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        let text = trimmed.isEmpty ? "new chat" : "new chat \(trimmed)"
        let response = try await HukumClient.shared.sendPrompt(text)
        let line = response.route?.note ?? "Started a new Hukum chat."
        return .result(dialog: IntentDialog(stringLiteral: line))
    }
}

struct HukumShortcutsProvider: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: HukumReadLatestIntent(),
            phrases: [
                "Read \(.applicationName)",
                "Read latest in \(.applicationName)",
                "Read \(.applicationName) \(\.$lane)"
            ],
            shortTitle: "Read Latest",
            systemImageName: "speaker.wave.2"
        )
        AppShortcut(
            intent: HukumSendPromptIntent(),
            phrases: [
                "Send \(.applicationName)",
                "Send to \(.applicationName)",
                "Send prompt in \(.applicationName)"
            ],
            shortTitle: "Send Prompt",
            systemImageName: "paperplane"
        )
        AppShortcut(
            intent: HukumSelectLaneIntent(),
            phrases: [
                "\(.applicationName) \(\.$lane)",
                "Select \(.applicationName) lane",
                "Select lane in \(.applicationName)"
            ],
            shortTitle: "Select Lane",
            systemImageName: "point.3.connected.trianglepath.dotted"
        )
        AppShortcut(
            intent: HukumNewChatIntent(),
            phrases: [
                "New \(.applicationName) Chat",
                "New chat in \(.applicationName)",
                "Start a new \(.applicationName) chat"
            ],
            shortTitle: "New Chat",
            systemImageName: "plus.bubble"
        )
        AppShortcut(
            intent: HukumStopReadingIntent(),
            phrases: [
                "Stop \(.applicationName)",
                "Stop reading in \(.applicationName)"
            ],
            shortTitle: "Stop Reading",
            systemImageName: "stop.fill"
        )
        AppShortcut(
            intent: HukumLaneStatusIntent(),
            phrases: [
                "\(.applicationName) status",
                "Show \(.applicationName) status",
                "Lane status in \(.applicationName)"
            ],
            shortTitle: "Lane Status",
            systemImageName: "list.bullet.rectangle"
        )
        AppShortcut(
            intent: NazarStatusIntent(),
            phrases: [
                "Read Nazar status in \(.applicationName)",
                "Nazar status in \(.applicationName)"
            ],
            shortTitle: "Nazar Status",
            systemImageName: "eye"
        )
        AppShortcut(
            intent: NazarOpenCameraIntent(),
            phrases: [
                "Open \(\.$camera) in \(.applicationName)",
                "Open Nazar camera in \(.applicationName)"
            ],
            shortTitle: "Open Camera",
            systemImageName: "video"
        )
    }
}
