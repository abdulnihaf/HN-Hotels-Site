import Foundation

struct HukumStateResponse: Codable {
    var ok: Bool
    var active: String?
    var selectedSession: String?
    var states: [HukumLaneState]
    var history: [HukumRouteHistory]?

    enum CodingKeys: String, CodingKey {
        case ok, active, states, history
        case selectedSession = "selected_session"
    }
}

struct HukumLaneState: Codable, Identifiable, Hashable {
    var slot: String?
    var alias: String?
    var title: String?
    var app: String?
    var session: String
    var selected: Bool
    var available: Bool
    var healthState: String?
    var healthNote: String?
    var latest: HukumLatestInfo?
    var transcript: HukumTranscriptInfo?
    var activeJob: HukumJobSummary?
    var latestHukumJob: HukumJobSummary?

    var id: String { session }
    var displaySlot: String { slot ?? alias ?? "Chat" }
    var displayTitle: String { title ?? alias ?? "Hukum lane" }
    var isFinalReadable: Bool { (latest?.meaningful ?? false) && (latest?.finalized ?? false) }
    var isRunning: Bool { ["running", "working", "quiet", "finishing"].contains((healthState ?? "").lowercased()) }

    enum CodingKeys: String, CodingKey {
        case slot, alias, title, app, session, selected, available, latest, transcript
        case healthState = "health_state"
        case healthNote = "health_note"
        case activeJob = "active_job"
        case latestHukumJob = "latest_hukum_job"
    }
}

struct HukumLatestInfo: Codable, Hashable {
    var source: String?
    var hash: String?
    var jobId: String?
    var meaningful: Bool
    var note: String?
    var preview: String?
    var finalized: Bool

    enum CodingKeys: String, CodingKey {
        case source, hash, meaningful, note, preview, finalized
        case jobId = "job_id"
    }
}

struct HukumTranscriptInfo: Codable, Hashable {
    var mtime: Int?
    var ageSeconds: Int?
    var pending: Bool?
    var finalized: Bool?
    var finalHash: String?
    var liveHash: String?
    var lastUserPreview: String?

    enum CodingKeys: String, CodingKey {
        case mtime, pending, finalized
        case ageSeconds = "age_seconds"
        case finalHash = "final_hash"
        case liveHash = "live_hash"
        case lastUserPreview = "last_user_preview"
    }
}

struct HukumRouteHistory: Codable, Identifiable, Hashable {
    var id: String
    var ts: Int?
    var source: String?
    var rawText: String?
    var routedText: String?
    var target: String?
    var mode: String?
    var alias: String?
    var title: String?
    var session: String?
    var routeNote: String?
    var jobId: String?
    var status: String?
    var healthState: String?

    enum CodingKeys: String, CodingKey {
        case id, ts, source, target, mode, alias, title, session, status
        case rawText = "raw_text"
        case routedText = "routed_text"
        case routeNote = "route_note"
        case jobId = "job_id"
        case healthState = "health_state"
    }
}

struct HukumJobEnvelope: Codable {
    var ok: Bool
    var job: HukumJobSummary?
    var route: HukumRoute?
    var error: String?
}

struct HukumJobSummary: Codable, Hashable {
    var id: String?
    var status: String?
    var healthState: String?
    var promptPreview: String?
    var answerHash: String?
    var answerText: String?

    enum CodingKeys: String, CodingKey {
        case id, status
        case healthState = "health_state"
        case promptPreview = "prompt_preview"
        case answerHash = "answer_hash"
        case answerText = "answer_text"
    }
}

struct HukumRoute: Codable, Hashable {
    var target: String?
    var app: String?
    var mode: String?
    var session: String?
    var alias: String?
    var title: String?
    var text: String?
    var note: String?
}

// A chat the bridge knows about (from /api/sessions) — ALL engines, lane or not.
struct HukumSession: Codable, Identifiable, Hashable {
    var id: String
    var app: String?
    var title: String?
    var clock: String?
    var ago: String?
    var snippet: String?
    var selected: Bool?
    var pinned: Bool?
    var project: String?

    enum CodingKeys: String, CodingKey {
        case id, app, title, clock, ago, snippet, selected, pinned, project
    }
    var isHot: Bool { (clock ?? "").lowercased() == "hot" }
}

struct HukumSessionsResponse: Codable { var sessions: [HukumSession] }

struct HukumLatestResponse: Codable {
    var ok: Bool
    var lane: HukumLaneState?
    var text: String?
    var note: String?
    var source: String?
    var hash: String?
    var meaningful: Bool?
    var finalized: Bool?
    var jobId: String?

    enum CodingKeys: String, CodingKey {
        case ok, lane, text, note, source, hash, meaningful, finalized
        case jobId = "job_id"
    }
}

