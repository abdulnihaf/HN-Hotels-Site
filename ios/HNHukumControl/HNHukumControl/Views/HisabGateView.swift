import SwiftUI

// PIN gate for Hisab — uses Hisaab's OWN PIN (X-Ops-Pin), stored via DiwanAuth chamber:"hisab".
// The only POST-shaped act here is the auth read that mints the unlocked session; no mutation.
struct HisabGateView: View {
    @ObservedObject var model: HisabAppModel
    @State private var pin = ""
    @State private var checking = false
    @State private var localError: String?
    private let accent = Color(hex: 0x7FA86A)

    var body: some View {
        ZStack {
            HK.bg.ignoresSafeArea()
            VStack(spacing: 18) {
                Spacer()
                VStack(alignment: .leading, spacing: 6) {
                    Text("Hisaab")
                        .font(.system(size: 28, weight: .heavy, design: .rounded))
                        .foregroundStyle(HK.text)
                    Text("Daily Profit & Loss · owner access")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(HK.textDim)
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                SecureField("", text: $pin, prompt: Text("Enter PIN").foregroundColor(HK.textFaint))
                    .keyboardType(.numberPad)
                    .textContentType(.password)
                    .font(.system(size: 20, weight: .semibold, design: .rounded))
                    .foregroundStyle(HK.text)
                    .padding(14)
                    .background(HK.bgElev, in: RoundedRectangle(cornerRadius: HK.radiusSm))
                    .overlay(RoundedRectangle(cornerRadius: HK.radiusSm).stroke(HK.line, lineWidth: 1))

                if let err = localError ?? model.authError {
                    Text(err)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(HK.error)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }

                Button {
                    Task { await unlock() }
                } label: {
                    HStack {
                        if checking { ProgressView().tint(.black) }
                        Text(checking ? "Checking…" : "Unlock")
                            .font(.system(size: 16, weight: .heavy))
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(pin.isEmpty ? HK.idle : accent, in: RoundedRectangle(cornerRadius: HK.radiusSm))
                    .foregroundStyle(.black)
                }
                .disabled(pin.isEmpty || checking)
                Spacer()
            }
            .padding(.horizontal, 22)
        }
    }

    // Verify the PIN by doing the gated read; only persist on success.
    private func unlock() async {
        checking = true
        localError = nil
        defer { checking = false }
        do {
            _ = try await HisabClient.shared.summary(brand: model.brand, date: model.date, pin: pin)
            await model.unlock(with: pin)   // persists + refreshes
        } catch let e as HukumError {
            if case .server(let msg) = e, msg == "unauthorized" {
                localError = "PIN rejected"
            } else {
                localError = e.localizedDescription
            }
        } catch {
            localError = error.localizedDescription
        }
    }
}
