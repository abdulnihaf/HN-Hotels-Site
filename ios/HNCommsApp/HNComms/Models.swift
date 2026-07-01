import Foundation

enum BrandFilter: String, CaseIterable, Identifiable {
    case all
    case he
    case nch
    case sparksol

    var id: String { rawValue }

    var title: String {
        switch self {
        case .all: "All"
        case .he: "HE"
        case .nch: "NCH"
        case .sparksol: "Spark"
        }
    }

    var apiValue: String { rawValue }
}

enum LeadStatusFilter: String, CaseIterable, Identifiable {
    case all
    case unknown
    case new
    case warm
    case active
    case converted
    case lost

    var id: String { rawValue }
    var title: String { rawValue.capitalized }
}

struct CommsThread: Identifiable, Decodable, Hashable {
    let threadId: String
    let brand: String
    let brandLabel: String
    let phone: String
    let waId: String?
    let displayName: String
    let leadStatus: String
    let leadSource: String
    let assignedTo: String
    let status: String
    let lastMessageAt: String?
    let lastInboundAt: String?
    let lastOutboundAt: String?
    let lastBody: String
    let lastDirection: String
    let lastMsgType: String
    let unreadCount: Int
    let serviceWindowExpiresAt: String?
    let serviceWindowOpen: Bool
    let serviceWindowMinutesRemaining: Int
    let updatedAt: String?

    var id: String { threadId }
    var title: String { displayName.isEmpty ? formattedPhone : displayName }
    var formattedPhone: String { phone.replacingOccurrences(of: "91", with: "+91 ", options: [.anchored]) }
}

struct CommsMessage: Identifiable, Decodable, Hashable {
    let id: Int
    let threadId: String
    let brand: String
    let phone: String
    let direction: String
    let msgType: String
    let body: String
    let templateName: String
    let wamid: String
    let status: String
    let errorText: String
    let mediaId: String
    let outboxId: Int?
    let actor: String
    let createdAt: String

    var isOutbound: Bool { direction == "outbound" }
}

struct QuickReply: Identifiable, Decodable, Hashable {
    let id: Int
    let brand: String
    let title: String
    let body: String
    let sortOrder: Int
}

struct WabaTemplate: Identifiable, Decodable, Hashable {
    let id: String?
    let name: String
    let status: String
    let category: String?
    let language: String?
    let components: [TemplateComponent]?

    var stableId: String { id ?? "\(name):\(language ?? "en")" }
}

struct TemplateComponent: Decodable, Hashable {
    let type: String?
    let text: String?
    let format: String?
}

struct ThreadsResponse: Decodable {
    let ok: Bool
    let threads: [CommsThread]
    let total: Int?
}

struct ThreadResponse: Decodable {
    let ok: Bool
    let thread: CommsThread
    let messages: [CommsMessage]
}

struct QuickRepliesResponse: Decodable {
    let ok: Bool
    let quickReplies: [QuickReply]
}

struct TemplatesResponse: Decodable {
    let ok: Bool
    let brand: String
    let templates: [WabaTemplate]
}

struct SendReplyResponse: Decodable {
    let ok: Bool
    let sendMode: String?
    let providerMsgId: String?
    let outboxId: Int?
    let messageId: Int?
    let error: String?
    let metaStatus: Int?
}
