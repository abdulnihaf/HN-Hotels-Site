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

enum InboxCategory: String, CaseIterable, Identifiable {
    case all
    case unread
    case hiring
    case fromDarbar
    case customers

    var id: String { rawValue }

    var title: String {
        switch self {
        case .all: "All"
        case .unread: "Unread"
        case .hiring: "Hiring"
        case .fromDarbar: "From Darbar"
        case .customers: "Customers"
        }
    }

    var sourceValue: String {
        switch self {
        case .all, .unread: "all"
        case .hiring: "hiring"
        case .fromDarbar: "darbar_staff"
        case .customers: "customer"
        }
    }

    var statusValue: String {
        switch self {
        case .unread: "unread"
        default: "all"
        }
    }
}

struct LeadContext: Decodable, Hashable {
    let source: String?
    let campaignName: String?
    let campaignRole: String?
    let campaignBrand: String?
    let candidateName: String?
    let staffName: String?
    let staffBrand: String?
    let staffRole: String?
    let totalMessages: String?

    var primary: String {
        campaignRole?.nilIfEmpty ?? staffRole?.nilIfEmpty ?? source?.nilIfEmpty ?? ""
    }

    var secondary: String {
        [candidateName, campaignName, staffName, staffBrand]
            .compactMap { $0?.nilIfEmpty }
            .joined(separator: " · ")
    }
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
    let leadContext: LeadContext?
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
    var bodyText: String { components?.first { ($0.type ?? "").uppercased() == "BODY" }?.text ?? "" }
    var variableCount: Int {
        guard !bodyText.isEmpty else { return 0 }
        return (1...20).filter { bodyText.contains("{{\($0)}}") }.count
    }
}

struct StaffMember: Identifiable, Decodable, Hashable {
    let id: Int
    let name: String
    let phone: String
    let e164: String
    let brand: String
    let role: String
    let wabaStatus: String
    let wabaConsentedAt: String?
}

struct CampaignTemplate: Identifiable, Decodable, Hashable {
    let id: String
    let name: String
    let status: String
    let category: String
    let language: String
    let bodyText: String
    let varCount: Int
}

struct AutomationTrailItem: Identifiable, Decodable, Hashable {
    let id: Int
    let alertId: String
    let tier: String
    let brand: String
    let channel: String
    let recipientPhone: String
    let templateName: String
    let templateVars: [String]
    let bodyText: String
    let status: String
    let providerMsgId: String
    let errorText: String
    let sentAt: String
    let deliveredAt: String
    let readAt: String
    let ackedAt: String
    let ackAction: String
    let createdAt: String
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

struct StaffResponse: Decodable {
    let ok: Bool
    let staff: [StaffMember]
}

struct CampaignTemplatesResponse: Decodable {
    let ok: Bool
    let brand: String
    let templates: [CampaignTemplate]
}

struct AutomationTrailResponse: Decodable {
    let ok: Bool
    let trail: [AutomationTrailItem]
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

struct StaffCampaignResponse: Decodable {
    let ok: Bool
    let total: Int
    let sent: Int
    let failed: Int
    let results: [StaffCampaignResult]
}

struct StaffCampaignResult: Decodable, Hashable {
    let phone: String
    let ok: Bool
    let status: Int?
    let providerMsgId: String?
    let outboxId: Int?
    let error: String?
}

extension String {
    var nilIfEmpty: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
