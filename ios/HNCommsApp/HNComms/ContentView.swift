import SwiftUI
import UniformTypeIdentifiers

struct ContentView: View {
    @State private var model = CommsAppModel()

    var body: some View {
        Group {
            if model.isConfigured {
                TabView {
                    InboxRootView(model: model)
                        .tabItem {
                            Label("Inbox", systemImage: "bubble.left.and.bubble.right")
                        }

                    AutomationView(model: model)
                        .tabItem {
                            Label("From Darbar", systemImage: "person.2.wave.2")
                        }
                }
            } else {
                SettingsView(model: model)
            }
        }
        .tint(.teal)
        .background(CommsBackdrop())
    }
}

struct InboxRootView: View {
    @Bindable var model: CommsAppModel

    var body: some View {
        NavigationSplitView {
            InboxListView(model: model)
                .navigationTitle("HN Comms")
        } detail: {
            if model.currentThread != nil {
                ThreadDetailView(model: model)
            } else {
                ContentUnavailableView("No Thread", systemImage: "bubble.left.and.bubble.right")
            }
        }
        .background(CommsBackdrop())
        .task(id: model.pollKey) {
            await model.pollLoop()
        }
        .onChange(of: model.selectedThreadID) { _, _ in
            Task { await model.loadSelectedThread(markRead: true) }
        }
        .alert("HN Comms", isPresented: Binding(
            get: { model.errorMessage != nil },
            set: { if !$0 { model.errorMessage = nil } }
        )) {
            Button("OK", role: .cancel) { model.errorMessage = nil }
        } message: {
            Text(model.errorMessage ?? "")
        }
    }
}

struct InboxListView: View {
    @Bindable var model: CommsAppModel

    var body: some View {
        VStack(spacing: 0) {
            filterBar
                .padding(.horizontal)
                .padding(.top, 6)
                .padding(.bottom, 10)

            if model.isLoading && model.threads.isEmpty {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                List(model.threads, selection: $model.selectedThreadID) { thread in
                    ThreadRow(thread: thread)
                        .tag(thread.threadId)
                        .listRowInsets(EdgeInsets(top: 6, leading: 12, bottom: 6, trailing: 12))
                        .listRowSeparator(.hidden)
                        .listRowBackground(Color.clear)
                }
                .listStyle(.plain)
                .scrollContentBackground(.hidden)
                .background(Color.clear)
                .refreshable {
                    await model.loadThreads()
                }
            }
        }
        .background(CommsBackdrop())
        .searchable(text: $model.query)
        .toolbar {
            #if os(macOS)
            ToolbarItem(placement: .automatic) {
                settingsLink
            }
            #else
            ToolbarItem(placement: .topBarTrailing) {
                settingsLink
            }
            #endif
        }
    }

    private var settingsLink: some View {
        NavigationLink {
            SettingsView(model: model)
        } label: {
            Image(systemName: "gearshape")
        }
        .accessibilityLabel("Settings")
    }

    private var filterBar: some View {
        VStack(spacing: 8) {
            Picker("Brand", selection: $model.selectedBrand) {
                ForEach(BrandFilter.allCases) { brand in
                    Text(brand.title).tag(brand)
                }
            }
            .pickerStyle(.segmented)

            Picker("Lane", selection: $model.selectedCategory) {
                ForEach(InboxCategory.allCases) { category in
                    Text(category == .fromDarbar ? "Darbar" : category.title).tag(category)
                }
            }
            .pickerStyle(.segmented)

            Picker("Lead", selection: $model.selectedLeadStatus) {
                ForEach(LeadStatusFilter.allCases) { status in
                    Text(status.title).tag(status)
                }
            }
            .pickerStyle(.menu)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(10)
        .commsGlass(cornerRadius: 22, tint: .teal, interactive: true)
    }
}

struct ThreadRow: View {
    let thread: CommsThread
    private var color: Color { brandColor(for: thread.brand) }
    private var initials: String { brandInitials(for: thread.brand) }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            ZStack {
                Circle()
                    .fill(color.opacity(0.18))
                Text(initials)
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(color)
            }
            .frame(width: 42, height: 42)

            VStack(alignment: .leading, spacing: 5) {
                HStack {
                    Text(thread.title)
                        .font(.headline)
                        .lineLimit(1)
                    Spacer()
                    if thread.unreadCount > 0 {
                        Text("\(thread.unreadCount)")
                            .font(.caption2.weight(.bold))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 7)
                            .padding(.vertical, 3)
                            .background(Capsule().fill(Color.teal))
                    }
                }

            Text(thread.lastBody.isEmpty ? thread.formattedPhone : thread.lastBody)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)

                HStack(spacing: 8) {
                    Label(thread.serviceWindowOpen ? "Open" : "Template", systemImage: thread.serviceWindowOpen ? "timer" : "doc.text")
                        .foregroundStyle(thread.serviceWindowOpen ? .teal : .orange)
                    if !sourceLabel.isEmpty {
                        Text(sourceLabel)
                            .foregroundStyle(.teal)
                    }
                    Text(thread.leadStatus)
                        .foregroundStyle(.secondary)
                    Spacer()
                    Text(shortTime(thread.lastMessageAt))
                        .foregroundStyle(.secondary)
                }
                .font(.caption)
            }
        }
        .padding(12)
        .commsGlass(cornerRadius: 22, tint: color, interactive: true)
    }

    private var sourceLabel: String {
        switch thread.leadSource {
        case "hiring": "Hiring"
        case "darbar_staff": "From Darbar"
        default: ""
        }
    }
}

struct ThreadDetailView: View {
    @Bindable var model: CommsAppModel

    var body: some View {
        VStack(spacing: 0) {
            if let thread = model.currentThread {
                ContactHeader(thread: thread)
                    .padding()
                    .padding(.horizontal)
                    .padding(.top, 6)

                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(spacing: 10) {
                            ForEach(model.messages) { message in
                                MessageBubble(message: message)
                                    .id(message.id)
                            }
                        }
                        .padding(.horizontal)
                        .padding(.vertical, 12)
                    }
                    .background(Color.clear)
                    .onChange(of: model.messages.count) { _, _ in
                        if let last = model.messages.last {
                            withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
                        }
                    }
                }

                ComposerView(model: model, thread: thread)
                    .padding(.horizontal)
                    .padding(.bottom, 10)
            }
        }
        .background(CommsBackdrop())
        .navigationTitle(model.currentThread?.title ?? "Thread")
        #if !os(macOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
    }
}

struct ContactHeader: View {
    let thread: CommsThread

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(thread.title)
                        .font(.title3.weight(.semibold))
                    Text(thread.formattedPhone)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 4) {
                    Text(thread.brandLabel)
                        .font(.caption.weight(.semibold))
                    Text(thread.serviceWindowOpen ? "\(thread.serviceWindowMinutesRemaining)m left" : "Template only")
                        .font(.caption)
                        .foregroundStyle(thread.serviceWindowOpen ? .teal : .orange)
                }
            }

            HStack {
                Chip(text: "Lead: \(thread.leadStatus)", color: .blue)
                if !thread.leadSource.isEmpty {
                    Chip(text: sourceTitle(thread.leadSource), color: .purple)
                }
                if !thread.assignedTo.isEmpty {
                    Chip(text: thread.assignedTo, color: .green)
                }
            }

            if let context = thread.leadContext,
               !context.primary.isEmpty || !context.secondary.isEmpty {
                VStack(alignment: .leading, spacing: 3) {
                    if !context.primary.isEmpty {
                        Text(context.primary)
                            .font(.subheadline.weight(.semibold))
                    }
                    if !context.secondary.isEmpty {
                        Text(context.secondary)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
        .padding(14)
        .commsGlass(cornerRadius: 24, tint: brandColor(for: thread.brand))
    }
}

struct ComposerView: View {
    @Bindable var model: CommsAppModel
    let thread: CommsThread
    @State private var showingFileImporter = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if !model.quickReplies.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack {
                        ForEach(model.quickReplies) { reply in
                            Button(reply.title) {
                                model.replyDraft = reply.body
                            }
                            .buttonStyle(.plain)
                            .controlSize(.small)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 7)
                            .commsGlass(cornerRadius: 16, tint: .teal, interactive: true)
                        }
                    }
                    .padding(.vertical, 2)
                }
            }

            if let template = model.selectedReplyTemplate {
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Label(template.name, systemImage: "doc.text")
                            .font(.caption.weight(.semibold))
                        Spacer()
                        Button {
                            model.selectedReplyTemplate = nil
                            model.replyTemplateVarsDraft = ""
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                        }
                        .buttonStyle(.plain)
                    }
                    if template.variableCount > 0 {
                        TextField("Variables, comma separated", text: $model.replyTemplateVarsDraft)
                            .textFieldStyle(.plain)
                            .padding(10)
                            .commsGlass(cornerRadius: 16, tint: .orange, interactive: true)
                    }
                    Button {
                        Task { await model.sendSelectedTemplate() }
                    } label: {
                        Label("Send Template", systemImage: "paperplane.fill")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.plain)
                    .padding(.vertical, 9)
                    .commsGlass(cornerRadius: 16, tint: .orange, interactive: true)
                    .disabled(model.isSending)
                }
                .padding(10)
                .commsGlass(cornerRadius: 18, tint: .orange)
            }

            HStack(alignment: .bottom, spacing: 10) {
                TextField(thread.serviceWindowOpen ? "Reply" : "Template required", text: $model.replyDraft, axis: .vertical)
                    .textFieldStyle(.plain)
                    .lineLimit(1...5)
                    .disabled(!thread.serviceWindowOpen)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 10)
                    .commsGlass(cornerRadius: 18, tint: thread.serviceWindowOpen ? .teal : .orange, interactive: thread.serviceWindowOpen)

                Button {
                    showingFileImporter = true
                } label: {
                    if model.isAttachmentSending {
                        ProgressView()
                    } else {
                        Image(systemName: "paperclip")
                    }
                }
                .frame(width: 36, height: 36)
                .buttonStyle(.plain)
                .commsGlass(cornerRadius: 18, tint: thread.serviceWindowOpen ? .teal : .secondary, interactive: thread.serviceWindowOpen)
                .disabled(!thread.serviceWindowOpen || model.isAttachmentSending)
                .accessibilityLabel("Attach")

                Menu {
                    if model.templates.isEmpty {
                        Text("No approved templates")
                    } else {
                        ForEach(model.templates, id: \.stableId) { template in
                            Button(template.name) {
                                if template.variableCount == 0 {
                                    Task { await model.sendTemplate(template) }
                                } else {
                                    model.selectedReplyTemplate = template
                                    model.replyTemplateVarsDraft = ""
                                }
                            }
                        }
                    }
                } label: {
                    Image(systemName: "doc.text")
                        .frame(width: 36, height: 36)
                }
                .buttonStyle(.plain)
                .commsGlass(cornerRadius: 18, tint: .orange, interactive: true)
                .accessibilityLabel("Templates")

                Button {
                    Task { await model.sendDraft() }
                } label: {
                    if model.isSending {
                        ProgressView()
                    } else {
                        Image(systemName: "paperplane.fill")
                    }
                }
                .frame(width: 38, height: 36)
                .buttonStyle(.plain)
                .commsGlass(cornerRadius: 18, tint: .teal, interactive: true)
                .disabled(model.isSending || model.replyDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !thread.serviceWindowOpen)
                .accessibilityLabel("Send")
            }
        }
        .padding(12)
        .commsGlass(cornerRadius: 26, tint: brandColor(for: thread.brand))
        .fileImporter(isPresented: $showingFileImporter, allowedContentTypes: [.item], allowsMultipleSelection: false) { result in
            switch result {
            case .success(let urls):
                if let url = urls.first {
                    Task { await model.sendAttachment(fileURL: url) }
                }
            case .failure(let error):
                model.errorMessage = error.localizedDescription
            }
        }
    }
}

struct MessageBubble: View {
    let message: CommsMessage

    var body: some View {
        HStack {
            if message.isOutbound { Spacer(minLength: 42) }
            VStack(alignment: .leading, spacing: 6) {
                if !message.templateName.isEmpty {
                    Label(message.templateName, systemImage: "doc.text")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Text(message.body)
                    .font(.body)
                    .textSelection(.enabled)
                HStack(spacing: 8) {
                    Text(shortTime(message.createdAt))
                    if message.isOutbound {
                        Text(message.status)
                            .foregroundStyle(message.status == "failed" ? .red : .secondary)
                    }
                }
                .font(.caption2)
                .foregroundStyle(.secondary)
                if !message.errorText.isEmpty {
                    Text(message.errorText)
                        .font(.caption)
                        .foregroundStyle(.red)
                }
            }
            .padding(12)
            .commsGlass(cornerRadius: 18, tint: message.isOutbound ? .teal : .secondary, interactive: false)
            if !message.isOutbound { Spacer(minLength: 42) }
        }
    }
}

struct AutomationView: View {
    @Bindable var model: CommsAppModel

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    campaignPanel
                    trailPanel
                }
                .padding()
            }
            .background(CommsBackdrop())
            .navigationTitle("From Darbar")
            .toolbar {
                ToolbarItem(placement: .automatic) {
                    Button {
                        Task { await model.loadAutomation() }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                    .accessibilityLabel("Refresh automation")
                }
            }
        }
        .task {
            await model.loadAutomation()
        }
    }

    private var campaignPanel: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("From Darbar")
                        .font(.title3.weight(.semibold))
                    Text("SparkSol WABA · template only")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Text("\(model.selectedStaffPhones.count) selected")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.teal)
            }

            Picker("Template", selection: $model.selectedCampaignTemplate) {
                if model.campaignTemplates.isEmpty {
                    Text("No approved templates").tag("")
                } else {
                    ForEach(model.campaignTemplates) { template in
                        Text(template.name).tag(template.name)
                    }
                }
            }
            .pickerStyle(.menu)

            TextField("Template variables, comma separated", text: $model.campaignVarsDraft)
                .textFieldStyle(.plain)
                .padding(12)
                .commsGlass(cornerRadius: 18, tint: .teal, interactive: true)

            LazyVStack(spacing: 8) {
                ForEach(model.staffMembers) { staff in
                    StaffSelectionRow(
                        staff: staff,
                        isSelected: model.selectedStaffPhones.contains(staff.e164)
                    ) {
                        if model.selectedStaffPhones.contains(staff.e164) {
                            model.selectedStaffPhones.remove(staff.e164)
                        } else {
                            model.selectedStaffPhones.insert(staff.e164)
                        }
                    }
                }
            }

            Button {
                Task { await model.sendStaffCampaign() }
            } label: {
                HStack {
                    if model.isCampaignSending {
                        ProgressView()
                    }
                    Text("Send Selected")
                        .font(.headline)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
            }
            .buttonStyle(.plain)
            .commsGlass(cornerRadius: 20, tint: .teal, interactive: true)
            .disabled(model.isCampaignSending || model.selectedStaffPhones.isEmpty || model.selectedCampaignTemplate.isEmpty)
        }
        .padding(14)
        .commsGlass(cornerRadius: 26, tint: .teal)
    }

    private var trailPanel: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("WhatsApp Trail")
                .font(.title3.weight(.semibold))
            if model.automationTrail.isEmpty {
                ContentUnavailableView("No WABA trail yet", systemImage: "clock.badge.questionmark")
                    .frame(maxWidth: .infinity)
            } else {
                LazyVStack(spacing: 8) {
                    ForEach(model.automationTrail) { item in
                        AutomationTrailRow(item: item)
                    }
                }
            }
        }
        .padding(14)
        .commsGlass(cornerRadius: 26, tint: .indigo)
    }
}

struct StaffSelectionRow: View {
    let staff: StaffMember
    let isSelected: Bool
    let onToggle: () -> Void

    var body: some View {
        Button(action: onToggle) {
            HStack(spacing: 10) {
                Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(isSelected ? .teal : .secondary)
                VStack(alignment: .leading, spacing: 2) {
                    Text(staff.name.isEmpty ? staff.e164 : staff.name)
                        .font(.subheadline.weight(.semibold))
                    Text([staff.brand, staff.role, staff.e164].filter { !$0.isEmpty }.joined(separator: " · "))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Spacer()
                Text(staff.wabaStatus)
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(staff.wabaStatus == "opted_in" ? .green : .orange)
            }
            .padding(10)
            .commsGlass(cornerRadius: 18, tint: isSelected ? .teal : .secondary, interactive: true)
        }
        .buttonStyle(.plain)
    }
}

struct AutomationTrailRow: View {
    let item: AutomationTrailItem

    private var statusColor: Color {
        switch item.status {
        case "sent", "delivered", "read": .green
        case "failed": .red
        case "skipped": .orange
        default: .secondary
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(item.templateName.isEmpty ? item.bodyText : item.templateName)
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(1)
                Spacer()
                Text(item.status)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(statusColor)
            }
            HStack(spacing: 8) {
                Text(item.brand)
                Text(item.tier)
                Text(item.recipientPhone)
                Spacer()
                Text(shortTime(item.sentAt.isEmpty ? item.createdAt : item.sentAt))
            }
            .font(.caption)
            .foregroundStyle(.secondary)
            if !item.errorText.isEmpty {
                Text(item.errorText)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .lineLimit(2)
            }
        }
        .padding(10)
        .commsGlass(cornerRadius: 18, tint: statusColor)
    }
}

struct SettingsView: View {
    @Bindable var model: CommsAppModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    Text("Connection")
                        .font(.headline)
                        .foregroundStyle(.secondary)

                    #if os(macOS)
                    TextField("Server", text: $model.baseURL)
                        .textFieldStyle(.plain)
                        .padding(12)
                        .commsGlass(cornerRadius: 18, tint: .teal, interactive: true)

                    SecureField("API key", text: $model.apiKey)
                        .textFieldStyle(.plain)
                        .padding(12)
                        .commsGlass(cornerRadius: 18, tint: .teal, interactive: true)
                    #else
                    TextField("Server", text: $model.baseURL)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.URL)
                        .textFieldStyle(.plain)
                        .padding(12)
                        .commsGlass(cornerRadius: 18, tint: .teal, interactive: true)

                    SecureField("API key", text: $model.apiKey)
                        .textInputAutocapitalization(.never)
                        .textFieldStyle(.plain)
                        .padding(12)
                        .commsGlass(cornerRadius: 18, tint: .teal, interactive: true)
                    #endif

                    Button("Save") {
                        model.saveSettings()
                        dismiss()
                        Task { await model.loadThreads() }
                    }
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                    .commsGlass(cornerRadius: 20, tint: .teal, interactive: true)

                    Button("Clear Key", role: .destructive) {
                        model.clearSettings()
                    }
                    .font(.subheadline.weight(.semibold))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                    .commsGlass(cornerRadius: 18, tint: .red, interactive: true)

                    if model.isConfigured {
                        Button {
                            Task { await model.requestNotifications() }
                        } label: {
                            Label(model.notificationsEnabled ? "Notifications On" : "Enable Notifications",
                                  systemImage: model.notificationsEnabled ? "bell.badge.fill" : "bell")
                                .frame(maxWidth: .infinity)
                        }
                        .font(.subheadline.weight(.semibold))
                        .padding(.vertical, 10)
                        .commsGlass(cornerRadius: 18, tint: .indigo, interactive: true)
                    }
                }
                .padding()
            }
            .background(CommsBackdrop())
            .navigationTitle("Settings")
        }
    }
}

struct Chip: View {
    let text: String
    let color: Color

    var body: some View {
        Text(text)
            .font(.caption.weight(.medium))
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .commsGlass(cornerRadius: 14, tint: color)
            .foregroundStyle(color)
    }
}

func sourceTitle(_ raw: String) -> String {
    switch raw {
    case "hiring": "Hiring"
    case "darbar_staff": "From Darbar"
    default: raw
    }
}

func shortTime(_ raw: String?) -> String {
    guard let raw,
          let date = ISO8601DateFormatter().date(from: raw) else { return "" }
    let formatter = RelativeDateTimeFormatter()
    formatter.unitsStyle = .abbreviated
    return formatter.localizedString(for: date, relativeTo: Date())
}
