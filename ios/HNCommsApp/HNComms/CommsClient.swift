import Foundation
import Observation
import Security
import UniformTypeIdentifiers
import UserNotifications

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

    func threads(brand: BrandFilter, leadStatus: LeadStatusFilter, category: InboxCategory, query: String) async throws -> [CommsThread] {
        var items: [URLQueryItem] = [
            URLQueryItem(name: "action", value: "threads"),
            URLQueryItem(name: "brand", value: brand.apiValue),
            URLQueryItem(name: "lead_status", value: leadStatus.rawValue),
            URLQueryItem(name: "source", value: category.sourceValue),
            URLQueryItem(name: "status", value: category.statusValue),
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

    func sendReply(
        brand: String,
        phone: String,
        text: String,
        templateName: String? = nil,
        templateVars: [String] = []
    ) async throws -> SendReplyResponse {
        var body: [String: Any] = [
            "brand": brand,
            "phone": phone,
            "actor": "ios",
        ]
        if let templateName, !templateName.isEmpty {
            body["template_name"] = templateName
            body["template_vars"] = templateVars
        } else {
            body["text"] = text
        }
        return try await request(
            method: "POST",
            query: [URLQueryItem(name: "action", value: "reply")],
            body: body
        )
    }

    func sendAttachment(
        brand: String,
        phone: String,
        fileName: String,
        mimeType: String,
        data: Data,
        caption: String
    ) async throws -> SendReplyResponse {
        guard var components = URLComponents(string: baseURL.trimmingCharacters(in: .whitespacesAndNewlines)) else {
            throw CommsClientError.badURL
        }
        components.path = "/api/comms-inbox"
        components.queryItems = [URLQueryItem(name: "action", value: "attachment")]
        guard let url = components.url else { throw CommsClientError.badURL }

        let boundary = "Boundary-\(UUID().uuidString)"
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue(apiKey, forHTTPHeaderField: "x-comms-key")
        request.setValue("application/json", forHTTPHeaderField: "accept")
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "content-type")

        var body = Data()
        body.appendMultipartField(name: "brand", value: brand, boundary: boundary)
        body.appendMultipartField(name: "phone", value: phone, boundary: boundary)
        body.appendMultipartField(name: "actor", value: "ios", boundary: boundary)
        body.appendMultipartField(name: "caption", value: caption, boundary: boundary)
        body.appendMultipartFile(name: "file", fileName: fileName, mimeType: mimeType, data: data, boundary: boundary)
        body.append("--\(boundary)--\r\n".data(using: .utf8)!)
        request.httpBody = body

        let (responseData, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        if status == 401 { throw CommsClientError.unauthorized }
        if !(200..<300).contains(status) {
            let bodyText = String(data: responseData, encoding: .utf8) ?? ""
            throw CommsClientError.http(status, bodyText)
        }
        return try decoder.decode(SendReplyResponse.self, from: responseData)
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
    var baseURL: String = "https://hnhotels.in"
    var apiKey: String = ""
    var selectedCategory: InboxCategory = .all
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
    var selectedReplyTemplate: WabaTemplate?
    var replyTemplateVarsDraft: String = ""
    var isLoading = false
    var isSending = false
    var isAttachmentSending = false
    var isCampaignSending = false
    var notificationsEnabled = false
    var errorMessage: String?
    @ObservationIgnored private var lastSeenThreadMessages: [String: String] = [:]

    init() {
        baseURL = KeychainStore.get("baseURL") ?? "https://hnhotels.in"
        apiKey = KeychainStore.get("apiKey") ?? Self.bundledAPIKey()
        notificationsEnabled = UserDefaults.standard.bool(forKey: "HNComms.notificationsEnabled")
        lastSeenThreadMessages = UserDefaults.standard.dictionary(forKey: "HNComms.lastSeenThreadMessages") as? [String: String] ?? [:]
    }

    var isConfigured: Bool {
        let trimmed = apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
        return !trimmed.isEmpty && !trimmed.contains("$(")
    }

    var pollKey: String {
        "\(isConfigured)-\(selectedCategory.rawValue)-\(selectedBrand.rawValue)-\(selectedLeadStatus.rawValue)-\(query)-\(selectedThreadID ?? "")"
    }

    var unreadTotal: Int {
        threads.reduce(0) { $0 + $1.unreadCount }
    }

    private var client: CommsClient {
        CommsClient(baseURL: baseURL, apiKey: apiKey)
    }

    private static func bundledAPIKey() -> String {
        let raw = Bundle.main.object(forInfoDictionaryKey: "HNCommsDefaultKey") as? String ?? ""
        return raw.contains("$(") ? "" : raw
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

    func requestNotifications() async {
        do {
            let granted = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])
            notificationsEnabled = granted
            UserDefaults.standard.set(granted, forKey: "HNComms.notificationsEnabled")
            if !granted {
                errorMessage = "Notifications were not enabled"
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func loadThreads(silent: Bool = false) async {
        guard isConfigured else { return }
        if !silent { isLoading = true }
        defer { if !silent { isLoading = false } }
        do {
            let rows = try await client.threads(brand: selectedBrand, leadStatus: selectedLeadStatus, category: selectedCategory, query: query)
            handleThreadNotifications(rows, silent: silent)
            threads = rows
            if selectedThreadID == nil {
                selectedThreadID = rows.first?.threadId
            }
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func handleThreadNotifications(_ rows: [CommsThread], silent: Bool) {
        let previous = lastSeenThreadMessages
        defer {
            lastSeenThreadMessages = Dictionary(uniqueKeysWithValues: rows.compactMap { thread in
                guard let last = thread.lastMessageAt else { return nil }
                return (thread.threadId, last)
            })
            UserDefaults.standard.set(lastSeenThreadMessages, forKey: "HNComms.lastSeenThreadMessages")
        }
        guard silent, notificationsEnabled, !previous.isEmpty else { return }
        let candidates = rows.filter { thread in
            guard thread.lastDirection == "inbound",
                  thread.unreadCount > 0,
                  let last = thread.lastMessageAt else { return false }
            return previous[thread.threadId] != last
        }
        for thread in candidates.prefix(3) {
            sendLocalNotification(for: thread)
        }
    }

    private func sendLocalNotification(for thread: CommsThread) {
        let content = UNMutableNotificationContent()
        content.title = "\(thread.brandLabel): \(thread.title)"
        content.body = thread.lastBody.isEmpty ? thread.formattedPhone : thread.lastBody
        content.sound = .default
        let rawId = "\(thread.threadId)-\(thread.lastMessageAt ?? UUID().uuidString)"
        let identifier = rawId.replacingOccurrences(of: "[^A-Za-z0-9_.-]", with: "-", options: .regularExpression)
        let request = UNNotificationRequest(identifier: identifier, content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request)
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

    func sendTemplate(_ template: WabaTemplate, vars: [String] = []) async {
        guard let thread = currentThread else { return }
        isSending = true
        defer { isSending = false }
        do {
            let result = try await client.sendReply(brand: thread.brand, phone: thread.phone, text: "", templateName: template.name, templateVars: vars)
            if !result.ok {
                errorMessage = result.error ?? "Template send failed"
            } else {
                selectedReplyTemplate = nil
                replyTemplateVarsDraft = ""
            }
            await loadSelectedThread(markRead: false)
            await loadThreads(silent: true)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func sendSelectedTemplate() async {
        guard let selectedReplyTemplate else { return }
        let vars = replyTemplateVarsDraft
            .split(separator: ",")
            .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        if vars.count < selectedReplyTemplate.variableCount {
            errorMessage = "Template needs \(selectedReplyTemplate.variableCount) variables"
            return
        }
        await sendTemplate(selectedReplyTemplate, vars: vars)
    }

    func sendAttachment(fileURL: URL) async {
        guard let thread = currentThread else { return }
        guard thread.serviceWindowOpen else {
            errorMessage = "Attachments need an open 24-hour window"
            return
        }
        isAttachmentSending = true
        defer { isAttachmentSending = false }
        let didStart = fileURL.startAccessingSecurityScopedResource()
        defer {
            if didStart { fileURL.stopAccessingSecurityScopedResource() }
        }
        do {
            let data = try Data(contentsOf: fileURL)
            let ext = fileURL.pathExtension
            let mimeType = UTType(filenameExtension: ext)?.preferredMIMEType ?? "application/octet-stream"
            let caption = replyDraft.trimmingCharacters(in: .whitespacesAndNewlines)
            let result = try await client.sendAttachment(
                brand: thread.brand,
                phone: thread.phone,
                fileName: fileURL.lastPathComponent,
                mimeType: mimeType,
                data: data,
                caption: caption
            )
            if result.ok {
                replyDraft = ""
            } else {
                errorMessage = result.error ?? "Attachment send failed"
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

private extension Data {
    mutating func appendMultipartField(name: String, value: String, boundary: String) {
        append("--\(boundary)\r\n".data(using: .utf8)!)
        append("Content-Disposition: form-data; name=\"\(name)\"\r\n\r\n".data(using: .utf8)!)
        append("\(value)\r\n".data(using: .utf8)!)
    }

    mutating func appendMultipartFile(name: String, fileName: String, mimeType: String, data: Data, boundary: String) {
        append("--\(boundary)\r\n".data(using: .utf8)!)
        append("Content-Disposition: form-data; name=\"\(name)\"; filename=\"\(fileName)\"\r\n".data(using: .utf8)!)
        append("Content-Type: \(mimeType)\r\n\r\n".data(using: .utf8)!)
        append(data)
        append("\r\n".data(using: .utf8)!)
    }
}
