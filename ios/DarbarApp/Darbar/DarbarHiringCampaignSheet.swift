import SwiftUI

// Darbar — Hiring WhatsApp campaign sheet (flow #2).
// Reads the scored role registry, composes a brand-aware campaign, sends in batches,
// and shows the hiring-scoped reply inbox. Additive; nothing in the supplier list changes.

struct DarbarHiringCampaignSheet: View {
    @ObservedObject var model: DarbarAppModel
    @Environment(\.dismiss) private var dismiss
    @State private var tab = 0
    @State private var replySheet: HiringConversation?
    @State private var replyText = ""
    private let accent = DarbarView.accent

    var body: some View {
        NavigationStack {
            ZStack {
                HK.bg.ignoresSafeArea()
                VStack(spacing: 0) {
                    Picker("", selection: $tab) {
                        Text("Roles").tag(0)
                        Text("Compose").tag(1)
                        Text("Inbox").tag(2)
                    }
                    .pickerStyle(.segmented)
                    .padding(.horizontal, 16).padding(.top, 8)
                    .tint(accent)

                    TabView(selection: $tab) {
                        RolesPanel(model: model, onSelect: { tab = 1 }).tag(0)
                        ComposePanel(model: model).tag(1)
                        InboxPanel(model: model, onReply: { c in
                            replySheet = c
                            replyText = ""
                        }).tag(2)
                    }
                    .tabViewStyle(.page(indexDisplayMode: .never))
                }
            }
            .navigationTitle("WhatsApp Campaigns")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Done") { dismiss() }
                        .foregroundStyle(accent)
                }
            }
        }
        .task {
            await model.loadHiringRoles()
            await model.loadHiringInbox()
        }
        .sheet(item: $replySheet) { conv in
            ReplySheet(conv: conv, text: $replyText) {
                await model.replyToCandidate(phone: conv.phone, text: replyText)
            }
        }
    }
}

// MARK: - Roles panel

private struct RolesPanel: View {
    @ObservedObject var model: DarbarAppModel
    var onSelect: () -> Void
    private let accent = DarbarView.accent

    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                if !model.hiringRoleNudges.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        ForEach(model.hiringRoleNudges, id: \.self) { n in
                            HStack(alignment: .top, spacing: 6) {
                                Image(systemName: "lightbulb.fill")
                                    .font(.system(size: 10)).foregroundStyle(HK.running)
                                Text(n).font(.system(size: 12, weight: .medium)).foregroundStyle(HK.textDim)
                                    .fixedSize(horizontal: false, vertical: true)
                                Spacer()
                            }
                        }
                    }
                    .padding(12)
                    .background(HK.bgElev, in: RoundedRectangle(cornerRadius: HK.radiusSm))
                }

                if model.loadingHiringRoles && model.hiringRoles.isEmpty {
                    ProgressView().tint(accent).padding(.vertical, 60)
                } else if model.hiringRoles.isEmpty {
                    empty
                } else {
                    ForEach(model.hiringRoles) { role in
                        RoleRow(role: role, selected: model.selectedHiringRole?.id == role.id)
                            .onTapGesture {
                                model.selectedHiringRole = role
                                model.campaignPackage = role.defaultPackage ?? ""
                                model.audiencePreview = nil
                                model.composedCampaign = nil
                                model.campaignSendResult = nil
                                model.campaignStatus = nil
                                onSelect()
                            }
                    }
                }
            }
            .padding(.horizontal, 16).padding(.bottom, 24)
        }
        .refreshable { await model.loadHiringRoles() }
    }

    private var empty: some View {
        VStack(spacing: 10) {
            Image(systemName: "person.badge.plus").font(.system(size: 34)).foregroundStyle(accent)
            Text("No roles loaded").font(.system(size: 16, weight: .semibold)).foregroundStyle(HK.text)
            Text("Pull to refresh the hiring role registry.")
                .font(.system(size: 13)).foregroundStyle(HK.textDim)
        }
        .frame(maxWidth: .infinity).padding(.vertical, 60)
    }
}

private struct RoleRow: View {
    let role: HiringRole
    let selected: Bool
    private let accent = DarbarView.accent

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(role.label).font(.system(size: 15, weight: .bold)).foregroundStyle(HK.text)
                Text(role.channelLabel)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(channelColor)
                if role.alwaysNeed {
                    Text("Always need · priority \(role.priorityScore ?? 0)")
                        .font(.system(size: 10)).foregroundStyle(HK.textFaint)
                }
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 4) {
                Text("\(role.supplyCount)")
                    .font(.system(size: 17, weight: .heavy, design: .rounded))
                    .foregroundStyle(role.supplyCount > 0 ? HK.ready : HK.textFaint)
                Text(role.supplyCount == 1 ? "candidate" : "candidates")
                    .font(.system(size: 9, weight: .semibold)).foregroundStyle(HK.textFaint)
            }
            Image(systemName: selected ? "checkmark.circle.fill" : "chevron.right")
                .font(.system(size: 16, weight: .bold))
                .foregroundStyle(selected ? accent : HK.textFaint)
        }
        .padding(13)
        .background(selected ? accent.opacity(0.12) : HK.card, in: RoundedRectangle(cornerRadius: HK.radius))
        .overlay(RoundedRectangle(cornerRadius: HK.radius).stroke(selected ? accent.opacity(0.5) : HK.line, lineWidth: 1))
    }

    private var channelColor: Color {
        switch role.channel {
        case "db+referral", "db-on-demand": return HK.ready
        case "suppliers+referral": return HK.running
        case "suppliers+referral+fb": return HK.error
        default: return HK.textDim
        }
    }
}

// MARK: - Compose panel

private struct ComposePanel: View {
    @ObservedObject var model: DarbarAppModel
    private let accent = DarbarView.accent

    var body: some View {
        ScrollView {
            VStack(spacing: 14) {
                if let role = model.selectedHiringRole {
                    selectedRoleHeader(role)
                    brandPicker
                    TextField("Commission / referral bonus", text: $model.campaignCommission)
                        .textFieldStyle(DarbarFieldStyle())
                    TextEditor(text: $model.campaignPackage)
                        .frame(minHeight: 60)
                        .font(.system(size: 14))
                        .foregroundStyle(HK.text)
                        .padding(10)
                        .background(HK.bgElev, in: RoundedRectangle(cornerRadius: HK.radiusSm))
                        .overlay(alignment: .topLeading) {
                            if model.campaignPackage.isEmpty {
                                Text("Package text").font(.system(size: 14))
                                    .foregroundStyle(HK.textFaint).padding(14)
                            }
                        }
                    TextField("City filter (optional)", text: $model.campaignCity)
                        .textFieldStyle(DarbarFieldStyle())
                    audiencePicker

                    previewCard

                    HStack(spacing: 10) {
                        Button { Task { await model.loadAudiencePreview(role: role.label) } } label: {
                            Label("Preview", systemImage: "person.2")
                                .font(.system(size: 13, weight: .bold)).foregroundStyle(HK.text)
                                .frame(maxWidth: .infinity).padding(.vertical, 10)
                                .background(HK.bgElev, in: RoundedRectangle(cornerRadius: HK.radiusSm))
                        }
                        .disabled(model.loadingAudience)

                        Button { Task { await model.composeCampaign() } } label: {
                            Label("Compose", systemImage: "wand.and.stars")
                                .font(.system(size: 13, weight: .bold)).foregroundStyle(.black)
                                .frame(maxWidth: .infinity).padding(.vertical, 10)
                                .background(accent, in: RoundedRectangle(cornerRadius: HK.radiusSm))
                        }
                        .disabled(model.campaignCommission.isEmpty)
                    }

                    if let cmp = model.composedCampaign {
                        composeResult(cmp)
                    }
                    if let status = model.campaignStatus {
                        statusCard(status)
                    }
                } else {
                    VStack(spacing: 10) {
                        Image(systemName: "arrow.left.circle").font(.system(size: 34)).foregroundStyle(accent)
                        Text("Choose a role first").font(.system(size: 16, weight: .semibold)).foregroundStyle(HK.text)
                        Text("Tap the Roles tab and select a position to compose a campaign.")
                            .font(.system(size: 13)).foregroundStyle(HK.textDim).multilineTextAlignment(.center)
                    }
                    .frame(maxWidth: .infinity).padding(.vertical, 60)
                }
            }
            .padding(.horizontal, 16).padding(.bottom, 24)
        }
    }

    private func selectedRoleHeader(_ role: HiringRole) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(role.label).font(.system(size: 18, weight: .heavy)).foregroundStyle(HK.text)
                Spacer()
                darbarBrandChip(role.brand.uppercased())
            }
            Text("Template: \(role.templateName ?? "hn_hiring_v1")")
                .font(.system(size: 11)).foregroundStyle(HK.textFaint)
        }
        .padding(13)
        .background(HK.card, in: RoundedRectangle(cornerRadius: HK.radius))
        .overlay(RoundedRectangle(cornerRadius: HK.radius).stroke(HK.line, lineWidth: 1))
    }

    private var brandPicker: some View {
        HStack(spacing: 2) {
            ForEach(["he", "nch"], id: \.self) { b in
                let on = model.campaignBrand == b
                Text(b.uppercased())
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(on ? .black : HK.textDim)
                    .frame(maxWidth: .infinity).padding(.vertical, 8)
                    .background(on ? accent : Color.clear, in: RoundedRectangle(cornerRadius: 9))
                    .onTapGesture { model.campaignBrand = b }
            }
        }
        .padding(3).background(HK.bgElev, in: RoundedRectangle(cornerRadius: 11))
    }

    private var audiencePicker: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Audience").font(.system(size: 12, weight: .semibold)).foregroundStyle(HK.textDim)
            Picker("", selection: $model.campaignAudience) {
                Text("Not contacted yet").tag("available")
                Text("Not this template").tag("not_this_template")
                Text("All").tag("all")
            }
            .pickerStyle(.segmented)
            .tint(accent)
        }
    }

    private var previewCard: some View {
        Group {
            if model.loadingAudience {
                HStack { Spacer(); ProgressView().tint(accent); Spacer() }.padding(.vertical, 14)
            } else if let p = model.audiencePreview {
                HStack(spacing: 14) {
                    VStack(spacing: 2) {
                        Text("\(p.afterExclusion)").font(.system(size: 20, weight: .heavy, design: .rounded)).foregroundStyle(HK.ready)
                        Text("reachable").font(.system(size: 9, weight: .semibold)).foregroundStyle(HK.textFaint)
                    }
                    Divider().background(HK.line)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Total: \(p.totalCandidates) · Staff excluded: \(p.excludedStaff)")
                            .font(.system(size: 12, weight: .medium)).foregroundStyle(HK.textDim)
                        Text("Roster exclusion is always applied")
                            .font(.system(size: 10)).foregroundStyle(HK.textFaint)
                    }
                    Spacer()
                }
                .padding(12)
                .background(HK.bgElev, in: RoundedRectangle(cornerRadius: HK.radiusSm))
            }
        }
    }

    private func composeResult(_ cmp: ComposeResponse) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Campaign #\(cmp.campaignId ?? 0)").font(.system(size: 15, weight: .bold)).foregroundStyle(HK.text)
                    Text("Queued \(cmp.queued ?? 0) for \(cmp.brand?.uppercased() ?? "HE")")
                        .font(.system(size: 12)).foregroundStyle(HK.textDim)
                }
                Spacer()
                if model.sendingCampaign {
                    ProgressView().tint(accent)
                }
            }
            Button { Task { await model.sendCampaign() } } label: {
                Label("Send batch (20 at a time)", systemImage: "paperplane.fill")
                    .font(.system(size: 13, weight: .bold)).foregroundStyle(.black)
                    .frame(maxWidth: .infinity).padding(.vertical, 10)
                    .background(HK.ready, in: RoundedRectangle(cornerRadius: HK.radiusSm))
            }
            .disabled(model.sendingCampaign)
        }
        .padding(13)
        .background(HK.card, in: RoundedRectangle(cornerRadius: HK.radius))
        .overlay(RoundedRectangle(cornerRadius: HK.radius).stroke(accent.opacity(0.4), lineWidth: 1))
    }

    private func statusCard(_ status: CampaignStatusResponse) -> some View {
        let c = status.counts ?? CampaignCounts()
        return HStack(spacing: 16) {
            StatusPill(label: "Queued", value: c.queued ?? 0, color: HK.textDim)
            StatusPill(label: "Sent", value: c.sent ?? 0, color: HK.ready)
            StatusPill(label: "Failed", value: c.failed ?? 0, color: HK.error)
            StatusPill(label: "Replies", value: c.replies ?? 0, color: HK.running)
        }
        .padding(12)
        .background(HK.bgElev, in: RoundedRectangle(cornerRadius: HK.radiusSm))
    }
}

private struct StatusPill: View {
    let label: String
    let value: Int
    let color: Color
    var body: some View {
        VStack(spacing: 2) {
            Text("\(value)").font(.system(size: 16, weight: .heavy, design: .rounded)).foregroundStyle(color)
            Text(label).font(.system(size: 9, weight: .semibold)).foregroundStyle(HK.textFaint)
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Inbox panel

private struct InboxPanel: View {
    @ObservedObject var model: DarbarAppModel
    var onReply: (HiringConversation) -> Void
    private let accent = DarbarView.accent

    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                HStack(spacing: 2) {
                    ForEach([("all", "All"), ("unread", "Unread")], id: \.0) { k, l in
                        let on = model.hiringInboxStatus == k
                        Text(l).font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(on ? .black : HK.textDim)
                            .frame(maxWidth: .infinity).padding(.vertical, 7)
                            .background(on ? accent : Color.clear, in: RoundedRectangle(cornerRadius: 9))
                            .onTapGesture {
                                model.hiringInboxStatus = k
                                Task { await model.loadHiringInbox() }
                            }
                    }
                }
                .padding(3).background(HK.bgElev, in: RoundedRectangle(cornerRadius: 11))

                if model.loadingHiringInbox && model.hiringInbox.isEmpty {
                    ProgressView().tint(accent).padding(.vertical, 60)
                } else if model.hiringInbox.isEmpty {
                    VStack(spacing: 10) {
                        Image(systemName: "tray").font(.system(size: 34)).foregroundStyle(accent)
                        Text("No replies yet").font(.system(size: 16, weight: .semibold)).foregroundStyle(HK.text)
                    }
                    .frame(maxWidth: .infinity).padding(.vertical, 60)
                } else {
                    ForEach(model.hiringInbox) { conv in
                        ConversationRow(conv: conv)
                            .onTapGesture { onReply(conv) }
                    }
                }
            }
            .padding(.horizontal, 16).padding(.bottom, 24)
        }
        .refreshable { await model.loadHiringInbox() }
    }
}

private struct ConversationRow: View {
    let conv: HiringConversation
    private let accent = DarbarView.accent

    var body: some View {
        HStack(spacing: 12) {
            ZStack {
                Circle().fill(accent.opacity(0.16)).frame(width: 42, height: 42)
                Text(String(conv.displayName.prefix(1).uppercased()))
                    .font(.system(size: 17, weight: .heavy)).foregroundStyle(accent)
            }
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(conv.displayName).font(.system(size: 15, weight: .bold)).foregroundStyle(HK.text)
                    Spacer()
                    if conv.isUnread {
                        Circle().fill(HK.ready).frame(width: 8, height: 8)
                    }
                }
                Text(conv.lastMessage ?? "—")
                    .font(.system(size: 12)).foregroundStyle(HK.textDim)
                    .lineLimit(2)
                HStack(spacing: 6) {
                    Text(conv.campaignRole ?? "").font(.system(size: 9, weight: .heavy))
                        .foregroundStyle(HK.textFaint).padding(.horizontal, 5).padding(.vertical, 2)
                        .background(HK.bgElev, in: Capsule())
                    Text(conv.lastDirection == "inbound" ? "Reply" : "You")
                        .font(.system(size: 9, weight: .semibold)).foregroundStyle(HK.textFaint)
                    Spacer()
                    Text("\(conv.totalMessages) msg").font(.system(size: 9)).foregroundStyle(HK.textFaint)
                }
            }
        }
        .padding(12)
        .background(conv.isUnread ? HK.cardHi : HK.card, in: RoundedRectangle(cornerRadius: HK.radius))
        .overlay(RoundedRectangle(cornerRadius: HK.radius).stroke(HK.line, lineWidth: 1))
    }
}

// MARK: - Reply sheet

private struct ReplySheet: View {
    let conv: HiringConversation
    @Binding var text: String
    var onSend: () async -> Void
    @Environment(\.dismiss) private var dismiss
    private let accent = DarbarView.accent

    var body: some View {
        NavigationStack {
            ZStack {
                HK.bg.ignoresSafeArea()
                VStack(spacing: 12) {
                    Text("Reply to \(conv.displayName)")
                        .font(.system(size: 14, weight: .semibold)).foregroundStyle(HK.textDim)
                    TextEditor(text: $text)
                        .frame(minHeight: 120)
                        .font(.system(size: 15))
                        .foregroundStyle(HK.text)
                        .padding(10)
                        .background(HK.bgElev, in: RoundedRectangle(cornerRadius: HK.radiusSm))
                    Spacer()
                }
                .padding(16)
            }
            .navigationTitle("Reply")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }.foregroundStyle(HK.textDim)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Send") {
                        Task {
                            await onSend()
                            dismiss()
                        }
                    }
                    .foregroundStyle(text.isEmpty ? HK.textFaint : accent)
                    .disabled(text.isEmpty)
                }
            }
        }
    }
}

// MARK: - shared field style

private struct DarbarFieldStyle: TextFieldStyle {
    func _body(configuration: TextField<Self._Label>) -> some View {
        configuration
            .font(.system(size: 14))
            .foregroundStyle(HK.text)
            .padding(11)
            .background(HK.bgElev, in: RoundedRectangle(cornerRadius: HK.radiusSm))
    }
}
