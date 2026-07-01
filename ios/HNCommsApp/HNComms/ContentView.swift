import SwiftUI

struct ContentView: View {
    @State private var model = CommsAppModel()

    var body: some View {
        Group {
            if model.isConfigured {
                InboxRootView(model: model)
            } else {
                SettingsView(model: model)
            }
        }
        .tint(.teal)
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
                .padding(.bottom, 8)

            if model.isLoading && model.threads.isEmpty {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                List(model.threads, selection: $model.selectedThreadID) { thread in
                    ThreadRow(thread: thread)
                        .tag(thread.threadId)
                }
                .listStyle(.plain)
                .refreshable {
                    await model.loadThreads()
                }
            }
        }
        .searchable(text: $model.query)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                NavigationLink {
                    SettingsView(model: model)
                } label: {
                    Image(systemName: "gearshape")
                }
                .accessibilityLabel("Settings")
            }
        }
    }

    private var filterBar: some View {
        VStack(spacing: 8) {
            Picker("Brand", selection: $model.selectedBrand) {
                ForEach(BrandFilter.allCases) { brand in
                    Text(brand.title).tag(brand)
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
    }
}

struct ThreadRow: View {
    let thread: CommsThread
    private var brandColor: Color {
        switch thread.brand {
        case "he": .indigo
        case "nch": .green
        case "sparksol": .orange
        default: .secondary
        }
    }
    private var brandInitials: String {
        switch thread.brand {
        case "he": "HE"
        case "nch": "NCH"
        case "sparksol": "SP"
        default: String(thread.brand.prefix(2)).uppercased()
        }
    }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            ZStack {
                Circle()
                    .fill(brandColor.opacity(0.18))
                Text(brandInitials)
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(brandColor)
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
                    Text(thread.leadStatus)
                        .foregroundStyle(.secondary)
                    Spacer()
                    Text(shortTime(thread.lastMessageAt))
                        .foregroundStyle(.secondary)
                }
                .font(.caption)
            }
        }
        .padding(.vertical, 6)
    }
}

struct ThreadDetailView: View {
    @Bindable var model: CommsAppModel

    var body: some View {
        VStack(spacing: 0) {
            if let thread = model.currentThread {
                ContactHeader(thread: thread)
                    .padding()
                    .background(.thinMaterial)

                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(spacing: 10) {
                            ForEach(model.messages) { message in
                                MessageBubble(message: message)
                                    .id(message.id)
                            }
                        }
                        .padding()
                    }
                    .onChange(of: model.messages.count) { _, _ in
                        if let last = model.messages.last {
                            withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
                        }
                    }
                }

                ComposerView(model: model, thread: thread)
                    .padding()
                    .background(.bar)
            }
        }
        .navigationTitle(model.currentThread?.title ?? "Thread")
        .navigationBarTitleDisplayMode(.inline)
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
                    Chip(text: thread.leadSource, color: .purple)
                }
                if !thread.assignedTo.isEmpty {
                    Chip(text: thread.assignedTo, color: .green)
                }
            }
        }
    }
}

struct ComposerView: View {
    @Bindable var model: CommsAppModel
    let thread: CommsThread

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if !model.quickReplies.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack {
                        ForEach(model.quickReplies) { reply in
                            Button(reply.title) {
                                model.replyDraft = reply.body
                            }
                            .buttonStyle(.bordered)
                            .controlSize(.small)
                        }
                    }
                }
            }

            HStack(alignment: .bottom, spacing: 10) {
                TextField(thread.serviceWindowOpen ? "Reply" : "Template required", text: $model.replyDraft, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .lineLimit(1...5)
                    .disabled(!thread.serviceWindowOpen)

                Menu {
                    if model.templates.isEmpty {
                        Text("No approved templates")
                    } else {
                        ForEach(model.templates, id: \.stableId) { template in
                            Button(template.name) {
                                Task { await model.sendTemplate(template) }
                            }
                        }
                    }
                } label: {
                    Image(systemName: "doc.text")
                        .frame(width: 36, height: 36)
                }
                .buttonStyle(.bordered)
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
                .buttonStyle(.borderedProminent)
                .disabled(model.isSending || model.replyDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !thread.serviceWindowOpen)
                .accessibilityLabel("Send")
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
            .background(message.isOutbound ? Color.teal.opacity(0.16) : Color(.secondarySystemGroupedBackground))
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            if !message.isOutbound { Spacer(minLength: 42) }
        }
    }
}

struct SettingsView: View {
    @Bindable var model: CommsAppModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section("Connection") {
                    TextField("Server", text: $model.baseURL)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.URL)
                    SecureField("API key", text: $model.apiKey)
                        .textInputAutocapitalization(.never)
                }
                Section {
                    Button("Save") {
                        model.saveSettings()
                        dismiss()
                        Task { await model.loadThreads() }
                    }
                    Button("Clear Key", role: .destructive) {
                        model.clearSettings()
                    }
                }
            }
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
            .background(Capsule().fill(color.opacity(0.14)))
            .foregroundStyle(color)
    }
}

func shortTime(_ raw: String?) -> String {
    guard let raw,
          let date = ISO8601DateFormatter().date(from: raw) else { return "" }
    let formatter = RelativeDateTimeFormatter()
    formatter.unitsStyle = .abbreviated
    return formatter.localizedString(for: date, relativeTo: Date())
}
