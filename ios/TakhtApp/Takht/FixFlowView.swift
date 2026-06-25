import SwiftUI

// THE SOLVE FLOW. Each open error is shown in plain words with the one-tap fix
// beside it. Tap → the engine writes the correction at the source (Odoo) and the
// error leaves the list. Settling never waits on this — the day goes on.
struct FixFlowView: View {
    @ObservedObject var model: TakhtAppModel
    let accent: Color
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 0) {
            header
            ScrollView {
                VStack(spacing: 12) {
                    banner
                    switch model.fixState {
                    case .idle, .loading:
                        loading
                    case .denied(let msg):
                        notEnabled(msg)
                    case .failed(let msg):
                        notEnabled(msg)
                    case .ready:
                        if model.openErrors.isEmpty { allClean }
                        else { ForEach(model.openErrors) { e in FixErrorCard(model: model, accent: accent, error: e) } }
                    }
                }
                .padding(.horizontal, 16).padding(.vertical, 16)
            }
            .scrollIndicators(.hidden)
        }
        .background(TakhtTheme.bg.ignoresSafeArea())
        .navigationBarHidden(true)
        .task { await model.loadErrors() }
    }

    private var header: some View {
        HStack(spacing: 12) {
            Button { dismiss() } label: {
                Image(systemName: "chevron.left").font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(TakhtTheme.text).frame(width: 38, height: 38)
                    .background(TakhtTheme.card, in: Circle())
                    .overlay(Circle().stroke(TakhtTheme.line, lineWidth: 1))
            }
            VStack(alignment: .leading, spacing: 2) {
                Text("Fix what's wrong").font(.system(size: 20, weight: .heavy, design: .serif)).foregroundStyle(TakhtTheme.text)
                if case .ready = model.fixState {
                    Text(model.openErrors.isEmpty ? "all clean" : "\(model.openErrors.count) open · one tap each")
                        .font(.system(size: 12, weight: .medium)).foregroundStyle(TakhtTheme.textDim)
                }
            }
            Spacer()
        }
        .padding(16).background(TakhtTheme.bgElev)
    }

    private var banner: some View {
        HStack(spacing: 8) {
            Image(systemName: "bolt.shield.fill").font(.system(size: 12)).foregroundStyle(accent)
            Text("Settling never waits — fix what you can, the day goes on.")
                .font(.system(size: 12)).foregroundStyle(TakhtTheme.textDim)
            Spacer(minLength: 0)
        }
        .padding(11).frame(maxWidth: .infinity, alignment: .leading)
        .background(accent.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
    }

    private var loading: some View {
        VStack(spacing: 10) {
            ProgressView().tint(accent)
            Text("reading the leak map…").font(.system(size: 13)).foregroundStyle(TakhtTheme.textFaint)
        }.frame(maxWidth: .infinity).padding(.vertical, 50)
    }

    private var allClean: some View {
        VStack(spacing: 8) {
            Image(systemName: "checkmark.seal.fill").font(.system(size: 34)).foregroundStyle(TakhtTheme.green)
            Text("All clean").font(.system(size: 18, weight: .heavy)).foregroundStyle(TakhtTheme.text)
            Text("Every order maps to a destination. Settle when ready.")
                .font(.system(size: 13)).foregroundStyle(TakhtTheme.textDim).multilineTextAlignment(.center)
        }.frame(maxWidth: .infinity).padding(.vertical, 44)
    }

    private func notEnabled(_ msg: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: "lock.trianglebadge.exclamationmark.fill").font(.system(size: 15)).foregroundStyle(TakhtTheme.amber)
                Text("Can't load corrections").font(.system(size: 15, weight: .bold)).foregroundStyle(TakhtTheme.text)
            }
            Text(msg).font(.system(size: 13)).foregroundStyle(TakhtTheme.textDim).fixedSize(horizontal: false, vertical: true)
            Button { Task { await model.loadErrors() } } label: {
                Text("Try again").font(.system(size: 13, weight: .semibold)).foregroundStyle(accent)
            }.padding(.top, 4)
        }
        .frame(maxWidth: .infinity, alignment: .leading).padding(16)
        .background(TakhtTheme.card, in: RoundedRectangle(cornerRadius: TakhtTheme.radius))
        .overlay(RoundedRectangle(cornerRadius: TakhtTheme.radius).stroke(TakhtTheme.amber.opacity(0.3), lineWidth: 1))
    }
}

// One open error + its one-tap resolutions.
private struct FixErrorCard: View {
    @ObservedObject var model: TakhtAppModel
    let accent: Color
    let error: TakhtOpenError
    @State private var applying = false
    @State private var reject = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 3) {
                Text(error.plainTitle).font(.system(size: 15, weight: .bold)).foregroundStyle(TakhtTheme.text)
                    .fixedSize(horizontal: false, vertical: true)
                HStack(spacing: 6) {
                    if let ref = error.orderRef {
                        Text(ref).font(.system(size: 11.5, weight: .semibold)).foregroundStyle(TakhtTheme.textDim)
                        Text("·").foregroundStyle(TakhtTheme.textFaint)
                    }
                    Text(error.currentState).font(.system(size: 11.5)).foregroundStyle(TakhtTheme.textFaint)
                    if let amt = error.amount, amt > 0 {
                        Text("·").foregroundStyle(TakhtTheme.textFaint)
                        Text(TakhtFmt.rupee(amt)).font(.system(size: 11.5, weight: .semibold)).foregroundStyle(TakhtTheme.textDim)
                    }
                }
            }

            if applying {
                HStack(spacing: 8) { ProgressView().tint(accent).scaleEffect(0.8); Text("fixing at the source…").font(.system(size: 12)).foregroundStyle(TakhtTheme.textFaint) }
            } else {
                // Resolutions — the engine validates each, so we offer the full set.
                FlowWrap(spacing: 8) {
                    Menu {
                        ForEach(TakhtRunner.slots, id: \.self) { s in
                            Button(s) { fix(.assignRunner(slot: s)) }
                        }
                    } label: { chip("Assign runner", "person.fill") }

                    Button { fix(.removeRunner) } label: { chip("No runner", "person.fill.xmark") }

                    Menu {
                        ForEach(TakhtPM.choices, id: \.id) { pm in
                            Button(pm.name) { fix(.changeMethod(id: pm.id)) }
                        }
                    } label: { chip("Change method", "indianrupeesign") }
                }
            }

            if !reject.isEmpty {
                Text(reject).font(.system(size: 12)).foregroundStyle(TakhtTheme.red).fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(14).frame(maxWidth: .infinity, alignment: .leading)
        .background(TakhtTheme.card, in: RoundedRectangle(cornerRadius: TakhtTheme.radius))
        .overlay(RoundedRectangle(cornerRadius: TakhtTheme.radius).stroke(TakhtTheme.line, lineWidth: 1))
    }

    private func chip(_ t: String, _ icon: String) -> some View {
        HStack(spacing: 5) {
            Image(systemName: icon).font(.system(size: 11, weight: .semibold))
            Text(t).font(.system(size: 12.5, weight: .semibold))
        }
        .foregroundStyle(accent)
        .padding(.horizontal, 11).padding(.vertical, 8)
        .background(accent.opacity(0.12), in: Capsule())
        .overlay(Capsule().stroke(accent.opacity(0.3), lineWidth: 1))
    }

    private func fix(_ f: TakhtFix) {
        reject = ""; applying = true
        Task {
            let err = await model.applyFix(error, f)
            applying = false
            if let err { reject = err }   // engine's plain-language reason; card stays for another try
        }
    }
}

// Minimal wrap layout so the action chips flow onto multiple lines.
private struct FlowWrap: Layout {
    var spacing: CGFloat = 8
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxW = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, rowH: CGFloat = 0
        for v in subviews {
            let s = v.sizeThatFits(.unspecified)
            if x + s.width > maxW { x = 0; y += rowH + spacing; rowH = 0 }
            x += s.width + spacing; rowH = max(rowH, s.height)
        }
        return CGSize(width: maxW == .infinity ? x : maxW, height: y + rowH)
    }
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let maxW = bounds.width
        var x: CGFloat = bounds.minX, y: CGFloat = bounds.minY, rowH: CGFloat = 0
        for v in subviews {
            let s = v.sizeThatFits(.unspecified)
            if x - bounds.minX + s.width > maxW { x = bounds.minX; y += rowH + spacing; rowH = 0 }
            v.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(s))
            x += s.width + spacing; rowH = max(rowH, s.height)
        }
    }
}
