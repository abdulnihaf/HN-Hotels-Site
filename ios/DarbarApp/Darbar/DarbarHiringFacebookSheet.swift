import SwiftUI

// Darbar — Hiring Facebook posting sheet (flow #3).
// Lists creatives, posts the selected one to groups, and shows recent session history.
// Styling matches the WhatsApp campaign sheet: HK bg/card/line, Darbar accent, rounded cards.

struct DarbarHiringFacebookSheet: View {
    @ObservedObject var model: DarbarAppModel
    @Environment(\.dismiss) private var dismiss
    @State private var showingPostsFor: FbSession?
    private let accent = DarbarView.accent

    var body: some View {
        NavigationStack {
            ZStack {
                HK.bg.ignoresSafeArea()
                ScrollView {
                    VStack(spacing: 14) {
                        overviewPills

                        sectionHeader("Creatives")
                        if model.fbCreatives.isEmpty {
                            emptyState(icon: "photo.stack", title: "No creatives loaded", subtitle: "Pull to refresh the Facebook creative library.")
                        } else {
                            ForEach(model.fbCreatives) { creative in
                                CreativeCard(creative: creative, selected: model.selectedFbCreative?.id == creative.id,
                                             composing: model.fbComposing && model.selectedFbCreative?.id == creative.id) {
                                    model.selectedFbCreative = creative
                                    Task { await model.createFbSession() }
                                }
                            }
                        }

                        sectionHeader("Sessions")
                        if model.fbSessions.isEmpty {
                            emptyState(icon: "clock.arrow.circlepath", title: "No sessions yet", subtitle: "Post a creative and the session log will appear here.")
                        } else {
                            ForEach(model.fbSessions) { session in
                                SessionCard(session: session) {
                                    showingPostsFor = session
                                }
                            }
                        }

                        if let result = model.fbComposeResult {
                            composeResultCard(result)
                        }
                    }
                    .padding(.horizontal, 16).padding(.bottom, 24)
                }
                .scrollIndicators(.hidden)
                .refreshable {
                    await model.loadFbOverview()
                    await model.loadFbCreatives()
                    await model.loadFbSessions()
                }
            }
            .navigationTitle("Facebook Posting")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Done") { dismiss() }
                        .foregroundStyle(accent)
                }
            }
        }
        .task {
            await model.loadFbOverview()
            await model.loadFbCreatives()
            await model.loadFbSessions()
        }
        .sheet(item: $showingPostsFor) { session in
            FbSessionPostsSheet(session: session, model: model)
        }
    }

    private var overviewPills: some View {
        let o = model.fbOverview
        return HStack(spacing: 10) {
            OverviewPill(label: "Creatives", value: o?.creativesCount ?? 0, color: accent)
            OverviewPill(label: "Groups", value: o?.eligibleGroups ?? 0, color: HK.ready)
            OverviewPill(label: "Sessions", value: o?.sessionsCount ?? 0, color: HK.running)
        }
    }

    private func sectionHeader(_ title: String) -> some View {
        HStack {
            Text(title.uppercased())
                .font(.system(size: 11, weight: .heavy)).tracking(0.6)
                .foregroundStyle(HK.textDim)
            Spacer()
        }
    }

    private func emptyState(icon: String, title: String, subtitle: String) -> some View {
        VStack(spacing: 10) {
            Image(systemName: icon).font(.system(size: 34)).foregroundStyle(accent)
            Text(title).font(.system(size: 16, weight: .semibold)).foregroundStyle(HK.text)
            Text(subtitle).font(.system(size: 13)).foregroundStyle(HK.textDim).multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity).padding(.vertical, 44)
    }

    private func composeResultCard(_ result: FbComposeResponse) -> some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(result.ok == true ? "Session #\(result.sessionId ?? 0)" : "Post failed")
                    .font(.system(size: 15, weight: .bold)).foregroundStyle(HK.text)
                if let err = result.error, !err.isEmpty {
                    Text(err).font(.system(size: 12)).foregroundStyle(HK.error).lineLimit(2)
                } else {
                    Text("Queued for \(result.totalGroups ?? 0) groups")
                        .font(.system(size: 12)).foregroundStyle(HK.textDim)
                }
            }
            Spacer()
        }
        .padding(12)
        .background(result.ok == true ? HK.card : HK.error.opacity(0.10), in: RoundedRectangle(cornerRadius: HK.radius))
        .overlay(RoundedRectangle(cornerRadius: HK.radius).stroke(result.ok == true ? HK.line : HK.error.opacity(0.35), lineWidth: 1))
    }
}

// MARK: - Creative row

private struct CreativeCard: View {
    let creative: FbCreative
    let selected: Bool
    let composing: Bool
    let onPost: () -> Void
    private let accent = DarbarView.accent

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 12) {
                ZStack {
                    RoundedRectangle(cornerRadius: HK.radiusSm)
                        .fill(HK.bgElev)
                        .frame(width: 56, height: 56)
                    Image(systemName: "photo")
                        .font(.system(size: 22)).foregroundStyle(HK.textFaint)
                }
                VStack(alignment: .leading, spacing: 4) {
                    Text(creative.name).font(.system(size: 15.5, weight: .bold)).foregroundStyle(HK.text)
                    if let brand = creative.brand, !brand.isEmpty {
                        Text(brand.uppercased())
                            .font(.system(size: 9, weight: .heavy)).tracking(0.3)
                            .foregroundStyle(accent).padding(.horizontal, 6).padding(.vertical, 2)
                            .background(accent.opacity(0.16), in: Capsule())
                    }
                    if let filename = creative.imageFilename, !filename.isEmpty {
                        Text(filename).font(.system(size: 11)).foregroundStyle(HK.textFaint).lineLimit(1)
                    }
                }
                Spacer()
                if selected {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 18, weight: .bold)).foregroundStyle(accent)
                }
            }

            if let text = creative.postText, !text.isEmpty {
                Text(text)
                    .font(.system(size: 12)).foregroundStyle(HK.textDim)
                    .lineLimit(3)
                    .fixedSize(horizontal: false, vertical: true)
            }

            HStack(spacing: 8) {
                HStack(spacing: 4) {
                    Image(systemName: "repeat").font(.system(size: 10)).foregroundStyle(HK.textFaint)
                    Text("Used \(creative.timesUsed ?? 0)×")
                        .font(.system(size: 10, weight: .semibold)).foregroundStyle(HK.textFaint)
                }
                .padding(.horizontal, 8).padding(.vertical, 4)
                .background(HK.bgElev, in: Capsule())

                Spacer()

                Button(action: onPost) {
                    HStack(spacing: 4) {
                        if composing {
                            ProgressView().tint(.black).scaleEffect(0.7)
                        } else {
                            Image(systemName: "square.and.arrow.up.on.square")
                        }
                        Text("Post to groups")
                            .font(.system(size: 13, weight: .bold))
                    }
                    .foregroundStyle(.black)
                    .padding(.horizontal, 14).padding(.vertical, 9)
                    .background(accent, in: RoundedRectangle(cornerRadius: HK.radiusSm))
                }
                .disabled(composing)
            }
        }
        .padding(13)
        .background(HK.card, in: RoundedRectangle(cornerRadius: HK.radius))
        .overlay(RoundedRectangle(cornerRadius: HK.radius).stroke(selected ? accent.opacity(0.5) : HK.line, lineWidth: 1))
    }
}

// MARK: - Session row

private struct SessionCard: View {
    let session: FbSession
    let onTap: () -> Void
    private let accent = DarbarView.accent

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(session.creativeName ?? "Creative #\(session.creativeId ?? 0)")
                        .font(.system(size: 15, weight: .bold)).foregroundStyle(HK.text)
                    if let account = session.accountName, !account.isEmpty {
                        Text("@\(account)").font(.system(size: 11)).foregroundStyle(HK.textDim)
                    }
                }
                Spacer()
                statusPill(session.status)
            }

            HStack(spacing: 10) {
                sessionPill(label: "Total", value: session.totalGroups ?? 0, color: HK.textDim)
                sessionPill(label: "Posted", value: session.postedCount ?? 0, color: HK.ready)
                sessionPill(label: "Failed", value: session.failedCount ?? 0, color: HK.error)
            }

            Button(action: onTap) {
                HStack {
                    Spacer()
                    Text("View posts")
                        .font(.system(size: 13, weight: .bold)).foregroundStyle(accent)
                    Spacer()
                }
                .padding(.vertical, 9)
                .background(accent.opacity(0.12), in: RoundedRectangle(cornerRadius: HK.radiusSm))
            }
        }
        .padding(13)
        .background(HK.card, in: RoundedRectangle(cornerRadius: HK.radius))
        .overlay(RoundedRectangle(cornerRadius: HK.radius).stroke(HK.line, lineWidth: 1))
        .onTapGesture(perform: onTap)
    }

    private func statusPill(_ status: String?) -> some View {
        let s = status ?? "unknown"
        let color: Color = s == "completed" ? HK.ready : (s == "running" ? HK.running : HK.textDim)
        return Text(s.replacingOccurrences(of: "_", with: " ").capitalized)
            .font(.system(size: 9, weight: .heavy))
            .foregroundStyle(color).padding(.horizontal, 7).padding(.vertical, 3)
            .background(color.opacity(0.16), in: Capsule())
    }

    private func sessionPill(label: String, value: Int, color: Color) -> some View {
        VStack(spacing: 2) {
            Text("\(value)").font(.system(size: 16, weight: .heavy, design: .rounded)).foregroundStyle(color)
            Text(label).font(.system(size: 9, weight: .semibold)).foregroundStyle(HK.textFaint)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
        .background(HK.bgElev, in: RoundedRectangle(cornerRadius: HK.radiusSm))
    }
}

// MARK: - Overview pill

private struct OverviewPill: View {
    let label: String
    let value: Int
    let color: Color

    var body: some View {
        VStack(spacing: 2) {
            Text("\(value)").font(.system(size: 18, weight: .heavy, design: .rounded)).foregroundStyle(color)
            Text(label).font(.system(size: 9, weight: .semibold)).foregroundStyle(HK.textFaint)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 10)
        .background(HK.card, in: RoundedRectangle(cornerRadius: HK.radius))
        .overlay(RoundedRectangle(cornerRadius: HK.radius).stroke(HK.line, lineWidth: 1))
    }
}

// MARK: - Session posts drill-down

private struct FbSessionPostsSheet: View {
    let session: FbSession
    @ObservedObject var model: DarbarAppModel
    @Environment(\.dismiss) private var dismiss
    @State private var posts: [FbPost] = []
    @State private var loading = false
    private let accent = DarbarView.accent

    var body: some View {
        NavigationStack {
            ZStack {
                HK.bg.ignoresSafeArea()
                ScrollView {
                    VStack(spacing: 12) {
                        if loading && posts.isEmpty {
                            ProgressView().tint(accent).padding(.vertical, 60)
                        } else if posts.isEmpty {
                            Text("No post details loaded")
                                .font(.system(size: 14)).foregroundStyle(HK.textDim)
                                .frame(maxWidth: .infinity).padding(.vertical, 60)
                        } else {
                            ForEach(posts) { post in
                                PostRow(post: post)
                            }
                        }
                    }
                    .padding(.horizontal, 16).padding(.bottom, 24)
                }
                .scrollIndicators(.hidden)
                .refreshable { await load() }
            }
            .navigationTitle("Session #\(session.id)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Done") { dismiss() }
                        .foregroundStyle(accent)
                }
            }
        }
        .task { await load() }
    }

    private func load() async {
        loading = true; defer { loading = false }
        posts = await model.fbPosts(sessionId: session.id)
    }
}

private struct PostRow: View {
    let post: FbPost
    @Environment(\.openURL) private var openURL

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(post.groupName ?? "Group #\(post.groupId.map(String.init) ?? "—")")
                    .font(.system(size: 14, weight: .bold)).foregroundStyle(HK.text)
                Text(post.status?.capitalized ?? "Unknown")
                    .font(.system(size: 10, weight: .heavy))
                    .foregroundStyle(statusColor).padding(.horizontal, 6).padding(.vertical, 2)
                    .background(statusColor.opacity(0.16), in: Capsule())
                if let err = post.errorMessage, !err.isEmpty {
                    Text(err).font(.system(size: 11)).foregroundStyle(HK.error).lineLimit(2)
                }
            }
            Spacer()
            if let url = post.groupUrl.flatMap({ URL(string: $0) }) {
                Button { openURL(url) } label: {
                    Image(systemName: "arrow.up.right.square")
                        .font(.system(size: 18)).foregroundStyle(DarbarView.accent)
                }
            }
        }
        .padding(12)
        .background(HK.card, in: RoundedRectangle(cornerRadius: HK.radius))
        .overlay(RoundedRectangle(cornerRadius: HK.radius).stroke(HK.line, lineWidth: 1))
    }

    private var statusColor: Color {
        switch post.status {
        case "success", "posted": return HK.ready
        case "failed", "error": return HK.error
        case "skipped": return HK.running
        default: return HK.textDim
        }
    }
}
