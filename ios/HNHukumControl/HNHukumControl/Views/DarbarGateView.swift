import SwiftUI

// The court gate. Darbar is the only PIN-minted-token chamber, so the entry has its own shell:
// 4 PIN dots + a 3×4 keypad, auto-submit on the 4th digit, shake on a wrong PIN.
// On success it stores the minted token via DiwanAuth and calls onUnlock.
struct DarbarGateView: View {
    var onUnlock: () async -> Void
    private let accent = Color(hex: 0x9E3B4D)   // court hue

    @State private var pin = ""
    @State private var busy = false
    @State private var error: String?
    @State private var shake = false

    private let keys: [[String]] = [
        ["1", "2", "3"],
        ["4", "5", "6"],
        ["7", "8", "9"],
        ["", "0", "⌫"],
    ]

    var body: some View {
        ZStack {
            HK.bg.ignoresSafeArea()
            VStack(spacing: 0) {
                ChamberHeader(title: "Darbar", subtitle: "Enter PIN to hold court", accent: accent)
                Spacer(minLength: 8)

                // Court seal + dots
                VStack(spacing: 26) {
                    ZStack {
                        Circle().fill(accent.opacity(0.14)).frame(width: 76, height: 76)
                        Image(systemName: "person.2.badge.gearshape.fill")
                            .font(.system(size: 30, weight: .semibold))
                            .foregroundStyle(accent)
                    }
                    dots
                    if let error {
                        Text(error.uppercased())
                            .font(.system(size: 11, weight: .heavy)).tracking(0.4)
                            .foregroundStyle(HK.error)
                    } else {
                        Text(busy ? "VERIFYING…" : "4-DIGIT PIN")
                            .font(.system(size: 11, weight: .heavy)).tracking(0.6)
                            .foregroundStyle(HK.textFaint)
                    }
                }
                .offset(x: shake ? -10 : 0)

                Spacer(minLength: 16)
                keypad
                Spacer(minLength: 24)
            }
        }
        .navigationTitle("Darbar").navigationBarTitleDisplayMode(.inline)
    }

    private var dots: some View {
        HStack(spacing: 18) {
            ForEach(0..<4, id: \.self) { i in
                Circle()
                    .fill(i < pin.count ? accent : Color.clear)
                    .frame(width: 15, height: 15)
                    .overlay(Circle().stroke(i < pin.count ? accent : HK.line, lineWidth: 1.6))
            }
        }
    }

    private var keypad: some View {
        VStack(spacing: 16) {
            ForEach(keys, id: \.self) { row in
                HStack(spacing: 24) {
                    ForEach(row, id: \.self) { key in
                        keyButton(key)
                    }
                }
            }
        }
        .padding(.horizontal, 28)
    }

    @ViewBuilder
    private func keyButton(_ key: String) -> some View {
        if key.isEmpty {
            Color.clear.frame(width: 72, height: 72)
        } else {
            Button {
                tap(key)
            } label: {
                Text(key)
                    .font(.system(size: key == "⌫" ? 24 : 30, weight: .semibold, design: .rounded))
                    .foregroundStyle(key == "⌫" ? HK.textDim : HK.text)
                    .frame(width: 72, height: 72)
                    .background(HK.card, in: Circle())
                    .overlay(Circle().stroke(HK.line, lineWidth: 1))
            }
            .buttonStyle(.plain)
            .disabled(busy)
        }
    }

    private func tap(_ key: String) {
        error = nil
        if key == "⌫" {
            if !pin.isEmpty { pin.removeLast() }
            return
        }
        guard pin.count < 4, key.allSatisfy(\.isNumber) else { return }
        pin.append(key)
        if pin.count == 4 { submit() }
    }

    private func submit() {
        let entered = pin
        busy = true
        Task {
            do {
                let res = try await DarbarClient.shared.auth(pin: entered)
                DiwanAuth.setCredential(res.token, chamber: "darbar")
                busy = false
                await onUnlock()
            } catch {
                busy = false
                failShake((error as? DarbarError)?.errorDescription ?? "Wrong PIN")
            }
        }
    }

    private func failShake(_ msg: String) {
        self.error = msg
        withAnimation(.default.repeatCount(4, autoreverses: true).speed(6)) { shake = true }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
            shake = false
            pin = ""
        }
    }
}
