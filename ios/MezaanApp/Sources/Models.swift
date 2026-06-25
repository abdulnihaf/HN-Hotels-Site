import Foundation

// Wire shapes — decoded leniently from the live Hukum bridge (every field optional so a
// shape change never blanks the board).

struct Lane: Decodable {
    let workflow_slot: Int?
    let title: String?
    let app: String?          // live engine (codex/claude/kimi)
    let workflow: String?
    let alias: String?
}
struct LanesResponse: Decodable { let lanes: [Lane]?; let active: String? }

struct JobTarget: Decodable { let app: String?; let title: String?; let session: String? }
struct Job: Decodable {
    let id: String?
    let status: String?
    let target: JobTarget?
    let prompt_preview: String?
    let health_state: String?
    let finished_at: Double?
    let created_at: Double?
}
struct JobsResponse: Decodable { let jobs: [Job]? }

struct Approval: Decodable {
    let id: String?
    let lane_title: String?
    let lane_id: String?
    let action: String?
    let details: String?
    let target: String?
    let risk: String?
}
struct ApprovalsResponse: Decodable { let approvals: [Approval]? }

// Composed board.
struct ChamberHealth: Identifiable {
    let id = UUID()
    let name: String
    let engine: String?
    let present: Bool
    let active: Bool
    let working: Bool
}

struct BoardState {
    var needsYou: [Approval] = []
    var inFlight: [Job] = []
    var doneToday: [Job] = []
    var chain: [ChamberHealth] = []
    var laneCount: Int = 0
    var updated: Date = .init()
}

enum Fmt {
    static func jobTitle(_ j: Job) -> String {
        (j.target?.title ?? j.prompt_preview ?? "job").trimmingCharacters(in: .whitespacesAndNewlines)
    }
    static func ago(_ epoch: Double?) -> String {
        guard let e = epoch, e > 0 else { return "" }
        let s = max(0, Date().timeIntervalSince1970 - e)
        if s < 90 { return "just now" }
        if s < 3600 { return "\(Int(s/60))m ago" }
        if s < 86400 { return "\(Int(s/3600))h ago" }
        return "\(Int(s/86400))d ago"
    }
}
