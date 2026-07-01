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
        .padding(14)
        .commsGlass(cornerRadius: 24, tint: brandColor(for: thread.brand))
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

            HStack(alignment: .bottom, spacing: 10) {
                TextField(thread.serviceWindowOpen ? "Reply" : "Template required", text: $model.replyDraft, axis: .vertical)
                    .textFieldStyle(.plain)
                    .lineLimit(1...5)
                    .disabled(!thread.serviceWindowOpen)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 10)
                    .commsGlass(cornerRadius: 18, tint: thread.serviceWindowOpen ? .teal : .orange, interactive: thread.serviceWindowOpen)

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

func shortTime(_ raw: String?) -> String {
    guard let raw,
          let date = ISO8601DateFormatter().date(from: raw) else { return "" }
    let formatter = RelativeDateTimeFormatter()
    formatter.unitsStyle = .abbreviated
    return formatter.localizedString(for: date, relativeTo: Date())
}
