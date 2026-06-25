import SwiftUI
import LocalAuthentication

// The Meta-Paid DECISION GATE — the first COA loop in the Naam app.
//
// It sits BELOW the read-only Meta card; the glance above is never touched (no-regression). It
// frames today's Meta move from the LIVE feed, shows an HONEST proof block (spend/eyes/hands are
// facts ✓; food-creative proof is BLOCKED ✗ until QISSA reel-QA is wired; conversions are ignored
// because platform attribution is broken — the till is the judge), and records an Approve/Hold
// DECISION to naam_decisions. It NEVER launches or pauses a campaign — that routes to the Meta Ads
// child lane. Record-only, the owner's chosen boundary (2026-06-25). The owner confirms each
// decision with Face ID, falling back to the (non-secret) owner PIN.
struct NaamMetaGate: View {
    let ctwa: NaamCtwa?
    let periodLabel: String
    var accent: Color = Color(hex: 0xE0762D)

    @State private var decision: NaamDecision?
    @State private var loaded = false
    @State private var busy = false
    @State private var errorText: String?
    @State private var showPin = false
    @State private var pinEntry = ""
    @State private var pending: String?     // the decision awaiting auth: "approve" | "hold"

    private let brand = "HE"
    private let lane  = "Meta Ads"
    private let ownerPIN = "0305"            // non-secret: already ships in the public Naam web JS

    // ── derived facts (live feed, never fabricated) ──
    private var ad: NaamCtwaAd? { ctwa?.adMetrics }
    private var spend: Double { ad?.spend ?? ctwa?.overview?.totalSpend ?? 0 }
    private var clicks: Double { ad?.linkClicks ?? 0 }
    private var impressions: Double { ad?.impressions ?? 0 }
    private var reach: Double { ad?.reach ?? 0 }
    private var ctr: Double? { impressions > 0 ? clicks / impressions * 100 : nil }
    private var hasMotion: Bool { spend > 0 || impressions > 0 }

    // Stable per-day id so a re-tap UPDATEs the same ledger row (server idempotent per move+brand).
    private var moveID: String {
        let f = DateFormatter()
        f.timeZone = TimeZone(identifier: "Asia/Kolkata")
        f.dateFormat = "yyyy-MM-dd"
        return "meta_he_\(f.string(from: Date()))"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            titleRow
            Text(framing)
                .font(.system(size: 13))
                .foregroundStyle(HK.textDim)
                .fixedSize(horizontal: false, vertical: true)
            proofBlock
            Divider().overlay(HK.line)
            if decision != nil { recordedPill }
            choices
            if let e = errorText {
                Text(e).font(.system(size: 11.5)).foregroundStyle(HK.error)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Text("Records your call to the ledger. Launch / pause runs in the Meta Ads lane — never from this app.")
                .font(.system(size: 10.5)).foregroundStyle(HK.textFaint)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(16)
        .background(HK.card, in: RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(accent.opacity(0.30), lineWidth: 1))
        .task {
            if loaded { return }
            loaded = true
            await loadDecision()
        }
        .sheet(isPresented: $showPin) { pinSheet }
    }

    // ── title ──
    private var titleRow: some View {
        HStack(spacing: 8) {
            Text("Meta · today's move")
                .font(.system(size: 15, weight: .heavy)).foregroundStyle(HK.text)
            Spacer()
            Text("RECORD-ONLY")
                .font(.system(size: 9, weight: .heavy)).foregroundStyle(accent)
                .padding(.horizontal, 6).padding(.vertical, 2)
                .background(accent.opacity(0.16), in: Capsule())
        }
    }

    private var framing: String {
        if hasMotion {
            var s = "Live this \(periodLabel): \(rupee(spend))"
            if clicks > 0 { s += " · \(Int(clicks)) link clicks" }
            if let c = ctr { s += String(format: " · %.1f%% CTR", c) }
            return s + ". Keep it running, or hold?"
        }
        return "No live Meta spend in this window — the last flight has ended. Hold, or approve the next flight for the Meta Ads lane to launch?"
    }

    // ── honest proof block ──
    private var proofBlock: some View {
        VStack(alignment: .leading, spacing: 8) {
            proofRow("checkmark.seal.fill", HK.ready, "Spend · eyes · hands",
                     "\(rupee(spend)) spent · \(compact(reach > 0 ? reach : impressions)) seen · \(Int(clicks)) clicks — facts from the live feed")
            proofRow("xmark.seal.fill", HK.error, "Food / creative proof",
                     "Blocked until QISSA reel-QA is wired — shown as ✗, never faked green")
            proofRow("minus.circle", HK.textFaint, "Conversions",
                     "Ignored — platform attribution is broken; the till is the judge")
        }
    }

    private func proofRow(_ icon: String, _ color: Color, _ label: String, _ detail: String) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: icon)
                .font(.system(size: 12, weight: .bold)).foregroundStyle(color).frame(width: 16)
            VStack(alignment: .leading, spacing: 1) {
                Text(label).font(.system(size: 12.5, weight: .semibold)).foregroundStyle(HK.text)
                Text(detail).font(.system(size: 11)).foregroundStyle(HK.textFaint)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
    }

    // ── recorded state ──
    private var recordedPill: some View {
        let isApprove = decision?.decision == "approve"
        return HStack(spacing: 8) {
            Image(systemName: isApprove ? "checkmark.circle.fill" : "pause.circle.fill")
                .foregroundStyle(isApprove ? HK.ready : HK.running)
            Text((isApprove ? "Approved" : "Held") + (decidedAtShort.map { " · \($0)" } ?? ""))
                .font(.system(size: 13, weight: .heavy)).foregroundStyle(HK.text)
            Spacer()
            Text("tap to change")
                .font(.system(size: 10.5, weight: .semibold)).foregroundStyle(HK.textFaint)
        }
        .padding(.vertical, 8).padding(.horizontal, 10)
        .background(HK.bgElev, in: RoundedRectangle(cornerRadius: 10))
    }

    // ── the gate: Approve / Hold ──
    private var choices: some View {
        HStack(spacing: 10) {
            choiceButton("approve", "Approve", "checkmark", HK.ready)
            choiceButton("hold", "Hold", "pause.fill", HK.running)
        }
    }

    private func choiceButton(_ value: String, _ title: String, _ icon: String, _ tint: Color) -> some View {
        let on = decision?.decision == value
        return Button {
            authenticate(value)
        } label: {
            HStack(spacing: 6) {
                if busy && pending == value {
                    ProgressView().controlSize(.small)
                } else {
                    Image(systemName: icon).font(.system(size: 13, weight: .bold))
                }
                Text(title).font(.system(size: 14, weight: .heavy))
            }
            .frame(maxWidth: .infinity).frame(minHeight: 44)
            .foregroundStyle(on ? .black : tint)
            .background(on ? tint : tint.opacity(0.14), in: RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
        .disabled(busy)
    }

    // ── auth + submit ──
    private func authenticate(_ value: String) {
        errorText = nil
        pending = value
        let ctx = LAContext()
        ctx.localizedFallbackTitle = "Enter PIN"
        var err: NSError?
        if ctx.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &err) {
            ctx.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics,
                               localizedReason: "Confirm your Meta marketing decision") { ok, _ in
                Task { @MainActor in
                    if ok { await submit(value, pin: ownerPIN) }
                    else { showPin = true }
                }
            }
        } else {
            showPin = true
        }
    }

    @MainActor private func submit(_ value: String, pin: String) async {
        busy = true
        defer { busy = false }
        errorText = nil
        let proof: [String: String] = [
            "spend": String(Int(spend)),
            "link_clicks": String(Int(clicks)),
            "ctr": ctr.map { String(format: "%.1f", $0) } ?? "n/a",
            "food_creative": "blocked_qissa",
            "conversions": "ignored_broken_attribution",
        ]
        do {
            let saved = try await NaamDecisionClient.shared.request(
                moveID: moveID, brand: brand, lane: lane, decision: value,
                title: "Meta — daily run/hold (\(periodLabel))",
                proof: proof, proofVerified: false, pin: pin)
            decision = saved
            pending = nil
        } catch {
            errorText = (error as? LocalizedError)?.errorDescription ?? "Could not record — \(error.localizedDescription)"
        }
    }

    private func loadDecision() async {
        if let rows = try? await NaamDecisionClient.shared.list(brand: brand) {
            decision = rows.first { $0.move_id == moveID }
        }
    }

    // ── PIN fallback (biometrics unavailable / declined) ──
    private var pinSheet: some View {
        VStack(spacing: 16) {
            Text("Owner PIN").font(.system(size: 17, weight: .heavy)).foregroundStyle(HK.text)
            Text("Confirm your \(pending == "hold" ? "hold" : "approve") decision")
                .font(.system(size: 13)).foregroundStyle(HK.textDim)
            SecureField("••••", text: $pinEntry)
                .keyboardType(.numberPad)
                .multilineTextAlignment(.center)
                .font(.system(size: 28, weight: .heavy, design: .rounded))
                .foregroundStyle(HK.text)
                .padding()
                .background(HK.card, in: RoundedRectangle(cornerRadius: 12))
            Button {
                let p = pinEntry; pinEntry = ""; showPin = false
                if let value = pending { Task { await submit(value, pin: p) } }
            } label: {
                Text("Confirm").font(.system(size: 15, weight: .heavy)).foregroundStyle(.black)
                    .frame(maxWidth: .infinity).frame(minHeight: 46)
                    .background(accent, in: RoundedRectangle(cornerRadius: 12))
            }
            .buttonStyle(.plain)
            .disabled(pinEntry.count < 4)
            Button("Cancel") { showPin = false; pinEntry = ""; pending = nil }
                .font(.system(size: 13, weight: .bold)).foregroundStyle(HK.textDim)
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(HK.bg.ignoresSafeArea())
        .presentationDetents([.height(320)])
    }

    // ── tiny self-contained formatters (no cross-file dependency) ──
    private func rupee(_ v: Double) -> String { "₹" + Int(v.rounded()).formatted(.number.grouping(.automatic)) }
    private func compact(_ v: Double) -> String {
        if v >= 1000 { return String(format: "%.1fk", v / 1000) }
        return String(Int(v))
    }
    private var decidedAtShort: String? {
        guard let s = decision?.decided_at else { return nil }
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let d = iso.date(from: s) ?? {
            let iso2 = ISO8601DateFormatter(); iso2.formatOptions = [.withInternetDateTime]; return iso2.date(from: s)
        }()
        guard let date = d else { return nil }
        let f = DateFormatter()
        f.timeZone = TimeZone(identifier: "Asia/Kolkata")
        f.dateFormat = "HH:mm"
        return f.string(from: date)
    }
}
