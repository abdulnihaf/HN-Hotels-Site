import Foundation
import Observation
import Security

enum CommsClientError: LocalizedError {
    case badURL
    case unauthorized
    case server(String)
    case http(Int, String)

    var errorDescription: String? {
        switch self {
        case .badURL: "Invalid server URL"
        case .unauthorized: "Unauthorized"
        case .server(let message): message
        case .http(let code, let body): "HTTP \(code): \(body)"
        }
    }
}

enum KeychainStore {
    private static let service = "HN-Comms"

    static func set(_ value: String, for account: String) {
        let data = Data(value.utf8)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
        var add = query
        add[kSecValueData as String] = data
        let status = SecItemAdd(add as CFDictionary, nil)
        if status == errSecMissingEntitlement || status == -34018 {
            UserDefaults.standard.set(value, forKey: "\(service).\(account)")
        }
    }

    static func get(_ account: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var out: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &out)
        if status == errSecSuccess,
           let data = out as? Data,
           let value = String(data: data, encoding: .utf8) {
            return value
        }
        return UserDefaults.standard.string(forKey: "\(service).\(account)")
    }

    static func clear(_ account: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
        UserDefaults.standard.removeObject(forKey: "\(service).\(account)")
    }
}

struct CommsClient {
    var baseURL: String
    var apiKey: String

    private var decoder: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return decoder
    }

    func threads(brand: BrandFilter, leadStatus: LeadStatusFilter, query: String) async throws -> [CommsThread] {
        var items: [URLQueryItem] = [
            URLQueryItem(name: "action", value: "threads"),
            URLQueryItem(name: "brand", value: brand.apiValue),
            URLQueryItem(name: "lead_status", value: leadStatus.rawValue),
        ]
        if !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            items.append(URLQueryItem(name: "q", value: query))
        }
        let response: ThreadsResponse = try await request(query: items)
        return response.threads
    }

    func thread(id: String) async throws -> ThreadResponse {
        try await request(query: [
            URLQueryItem(name: "action", value: "thread"),
            URLQueryItem(name: "thread_id", value: id),
        ])
    }

    func quickReplies(brand: String) async throws -> [QuickReply] {
        let response: QuickRepliesResponse = try await request(query: [
            URLQueryItem(name: "action", value: "quick-replies"),
            URLQueryItem(name: "brand", value: brand),
        ])
        return response.quickReplies
    }

    func templates(brand: String) async throws -> [WabaTemplate] {
        let response: TemplatesResponse = try await request(query: [
            URLQueryItem(name: "action", value: "templates"),
            URLQueryItem(name: "brand", value: brand),
        ])
        return response.templates
    }

    func staff() async throws -> [StaffMember] {
        let response: StaffResponse = try await request(query: [
            URLQueryItem(name: "action", value: "staff"),
        ])
        return response.staff
    }

    func staffTemplates() async throws -> [CampaignTemplate] {
        let response: CampaignTemplatesResponse = try await request(query: [
            URLQueryItem(name: "action", value: "staff-templates"),
        ])
        return response.templates
    }

    func automationTrail() async throws -> [AutomationTrailItem] {
        let response: AutomationTrailResponse = try await request(query: [
            URLQueryItem(name: "action", value: "automation-trail"),
            URLQueryItem(name: "brand", value: "all"),
            URLQueryItem(name: "limit", value: "120"),
        ])
        return response.trail
    }

    func sendReply(brand: String, phone: String, text: String, templateName: String? = nil) async throws -> SendReplyResponse {
        var body: [String: Any] = [
            "brand": brand,
            "phone": phone,
            "actor": "ios",
        ]
        if let templateName, !templateName.isEmpty {
            body["template_name"] = templateName
            body["template_vars"] = []
        } else {
            body["text"] = text
        }
        return try await request(
            method: "POST",
            query: [URLQueryItem(name: "action", value: "reply")],
            body: body
        )
    }

    func sendStaffCampaign(template: String, recipients: [String], vars: [String]) async throws -> StaffCampaignResponse {
        try await request(
            method: "POST",
            query: [URLQueryItem(name: "action", value: "staff-campaign")],
            body: [
                "template": template,
                "recipients": recipients,
                "vars": vars,
                "actor": "ios",
            ]
        )
    }

    func markRead(threadId: String) async throws {
        let _: EmptyResponse = try await request(
            method: "POST",
            query: [URLQueryItem(name: "action", value: "mark-read")],
            body: ["thread_id": threadId]
        )
    }

    private func request<T: Decodable>(
        method: String = "GET",
        query: [URLQueryItem],
        body: [String: Any]? = nil
    ) async throws -> T {
        guard var components = URLComponents(string: baseURL.trimmingCharacters(in: .whitespacesAndNewlines)) else {
            throw CommsClientError.badURL
        }
        components.path = "/api/comms-inbox"
        components.queryItems = query
        guard let url = components.url else { throw CommsClientError.badURL }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue(apiKey, forHTTPHeaderField: "x-comms-key")
        request.setValue("application/json", forHTTPHeaderField: "accept")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "content-type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }

        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        if status == 401 { throw CommsClientError.unauthorized }
        if !(200..<300).contains(status) {
            let bodyText = String(data: data, encoding: .utf8) ?? ""
            throw CommsClientError.http(status, bodyText)
        }
        return try decoder.decode(T.self, from: data)
    }
}

struct EmptyResponse: Decodable {
    let ok: Bool?
}

@MainActor
@Observable
final class CommsAppModel {
    var baseURL: String = KeychainStore.get("baseURL") ?? "https://hnhotels.in"
    var apiKey: String = KeychainStore.get("apiKey") ?? (Bundle.main.object(forInfoDictionaryKey: "HNCommsDefaultKey") as? String ?? "")
    var selectedBrand: BrandFilter = .all
    var selectedLeadStatus: LeadStatusFilter = .all
    var query: String = ""
    var threads: [CommsThread] = []
    var selectedThreadID: String?
    var currentThread: CommsThread?
    var messages: [CommsMessage] = []
    var quickReplies: [QuickReply] = []
    var templates: [WabaTemplate] = []
    var staffMembers: [StaffMember] = []
    var campaignTemplates: [CampaignTemplate] = []
    var automationTrail: [AutomationTrailItem] = []
    var selectedStaffPhones: Set<String> = []
    var selectedCampaignTemplate: String = ""
    var campaignVarsDraft: String = ""
    var replyDraft: String = ""
    var isLoading = false
    var isSending = false
    var isCampaignSending = false
    var errorMessage: String?

    var isConfigured: Bool {
        !apiKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var pollKey: String {
        "\(isConfigured)-\(selectedBrand.rawValue)-\(selectedLeadStatus.rawValue)-\(query)-\(selectedThreadID ?? "")"
    }

    private var client: CommsClient {
        CommsClient(baseURL: baseURL, apiKey: apiKey)
    }

    func saveSettings() {
        KeychainStore.set(baseURL, for: "baseURL")
        KeychainStore.set(apiKey, for: "apiKey")
    }

    func clearSettings() {
        KeychainStore.clear("apiKey")
        apiKey = ""
        threads = []
        selectedThreadID = nil
        currentThread = nil
        messages = []
        staffMembers = []
        campaignTemplates = []
        automationTrail = []
        selectedStaffPhones = []
    }

    func loadThreads(silent: Bool = false) async {
        guard isConfigured else { return }
        if !silent { isLoading = true }
        defer { if !silent { isLoading = false } }
        do {
            let rows = try await client.threads(brand: selectedBrand, leadStatus: selectedLeadStatus, query: query)
            threads = rows
            if selectedThreadID == nil {
                selectedThreadID = rows.first?.threadId
            }
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func loadSelectedThread(markRead: Bool = false) async {
        guard let selectedThreadID else { return }
        do {
            let response = try await client.thread(id: selectedThreadID)
            currentThread = response.thread
            messages = response.messages
            if markRead {
                try await client.markRead(threadId: selectedThreadID)
                await loadThreads(silent: true)
            }
            async let replies = client.quickReplies(brand: response.thread.brand)
            async let templateRows = client.templates(brand: response.thread.brand)
            quickReplies = (try? await replies) ?? []
            templates = ((try? await templateRows) ?? []).filter { $0.status == "APPROVED" }
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func sendDraft() async {
        let trimmed = replyDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let thread = currentThread, !trimmed.isEmpty else { return }
        isSending = true
        defer { isSending = false }
        do {
            let result = try await client.sendReply(brand: thread.brand, phone: thread.phone, text: trimmed)
            if result.ok {
                replyDraft = ""
            } else {
                errorMessage = result.error ?? "Send failed"
            }
            await loadSelectedThread(markRead: false)
            await loadThreads(silent: true)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func sendTemplate(_ template: WabaTemplate) async {
        guard let thread = currentThread else { return }
        isSending = true
        defer { isSending = false }
        do {
            let result = try await client.sendReply(brand: thread.brand, phone: thread.phone, text: "", templateName: template.name)
            if !result.ok {
                errorMessage = result.error ?? "Template send failed"
            }
            await loadSelectedThread(markRead: false)
            await loadThreads(silent: true)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func loadAutomation() async {
        guard isConfigured else { return }
        do {
            async let staffRows = client.staff()
            async let templateRows = client.staffTemplates()
            async let trailRows = client.automationTrail()
            staffMembers = (try await staffRows)
            campaignTemplates = (try await templateRows)
            automationTrail = (try await trailRows)
            if selectedCampaignTemplate.isEmpty {
                selectedCampaignTemplate = campaignTemplates.first?.name ?? ""
            }
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func sendStaffCampaign() async {
        let recipients = staffMembers
            .filter { selectedStaffPhones.contains($0.e164) }
            .map(\.e164)
        guard !selectedCampaignTemplate.isEmpty, !recipients.isEmpty else {
            errorMessage = "Select a template and at least one staff member"
            return
        }
        let vars = campaignVarsDraft
            .split(separator: ",")
            .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        isCampaignSending = true
        defer { isCampaignSending = false }
        do {
            let result = try await client.sendStaffCampaign(
                template: selectedCampaignTemplate,
                recipients: recipients,
                vars: vars
            )
            if !result.ok {
                errorMessage = "Campaign sent \(result.sent), failed \(result.failed)"
            }
            selectedStaffPhones = []
            await loadAutomation()
        } catch {
            errorMessage = error.localizedDescription
            await loadAutomation()
        }
    }

    func pollLoop() async {
        guard isConfigured else { return }
        await loadThreads(silent: false)
        await loadSelectedThread(markRead: true)
        while !Task.isCancelled {
            do {
                try await Task.sleep(for: .seconds(15))
                await loadThreads(silent: true)
                await loadSelectedThread(markRead: false)
            } catch {
                return
            }
        }
    }
}
