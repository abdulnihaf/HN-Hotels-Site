import SwiftUI

// Light PIN gate for Sauda. The handshake is a read-only GET with the candidate PIN;
// on ok:true the PIN is stored via DiwanAuth(chamber:"sauda") and the board opens.
struct SaudaGateView: View {
    @ObservedObject var model: SaudaAppModel
    private let accent = Color(hex: 0xC85A8E)
    @State private var pin = ""
    @FocusState private var focused: Bool

    var body: some View {
        VStack(spacing: 18) {
            Spacer()
            ZStack {
                Circle().fill(accent.opacity(0.16)).frame(width: 76, height: 76)
                Image(systemName: "cart.fill")
                    .font(.system(size: 32, weight: .semibold))
                    .foregroundStyle(accent)
            }
            Text("Sauda")
                .font(.system(size: 26, weight: .heavy, design: .rounded))
                .foregroundStyle(HK.text)
            Text("Enter the buy-board PIN to view today's purchases.")
                .font(.system(size: 13.5))
                .foregroundStyle(HK.textDim)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 36)

            SecureField("PIN", text: $pin)
                .keyboardType(.numberPad)
                .textContentType(.password)
                .multilineTextAlignment(.center)
                .font(.system(size: 20, weight: .bold, design: .rounded))
                .foregroundStyle(HK.text)
                .focused($focused)
                .padding(.vertical, 14)
                .frame(maxWidth: 220)
                .background(HK.card, in: RoundedRectangle(cornerRadius: HK.radiusSm))
                .overlay(RoundedRectangle(cornerRadius: HK.radiusSm).stroke(HK.line, lineWidth: 1))

            if let err = model.gateError {
                Text(err)
                    .font(.system(size: 12.5, weight: .semibold))
                    .foregroundStyle(HK.error)
            }

            Button {
                focused = false
                Task { await model.unlock(pin: pin) }
            } label: {
                HStack(spacing: 8) {
                    if model.isAuthing { ProgressView().tint(.black) }
                    Text(model.isAuthing ? "Checking…" : "Unlock")
                        .font(.system(size: 16, weight: .heavy))
                }
                .foregroundStyle(.black)
                .frame(maxWidth: 220)
                .padding(.vertical, 13)
                .background(accent, in: RoundedRectangle(cornerRadius: HK.radiusSm))
            }
            .disabled(model.isAuthing || pin.isEmpty)
            .opacity(model.isAuthing || pin.isEmpty ? 0.6 : 1)

            Spacer(); Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(HK.bg.ignoresSafeArea())
        .onAppear { focused = true }
    }
}
