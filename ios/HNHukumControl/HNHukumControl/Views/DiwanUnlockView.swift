import SwiftUI

// The single unlock for the whole Diwan: Face ID (auto-prompted once set up) with the PIN keypad
// as the one-time setup + fallback.
struct DiwanUnlockView: View {
    @ObservedObject var session: DiwanSession
    @State private var pin = ""
    @State private var shake = false
    private let dots = 4

    private var setupMode: Bool { !session.isSetUp }

    var body: some View {
        ZStack {
            HK.bg.ignoresSafeArea()
            VStack(spacing: 0) {
                Spacer()
                ZStack {
                    Circle().fill(HK.accent.opacity(0.16)).frame(width: 84, height: 84)
                    Image(systemName: "building.columns.fill")
                        .font(.system(size: 36, weight: .semibold)).foregroundStyle(HK.accent)
                }
                Text("Diwan").font(.system(size: 30, weight: .heavy, design: .rounded))
                    .foregroundStyle(HK.text).padding(.top, 16)
                Text(setupMode
                     ? "Enter your PIN once — every chamber opens behind it."
                     : "Unlock to open the court.")
                    .font(.system(size: 13.5, weight: .medium)).foregroundStyle(HK.textDim)
                    .multilineTextAlignment(.center).padding(.horizontal, 40).padding(.top, 4)

                HStack(spacing: 18) {
                    ForEach(0..<dots, id: \.self) { i in
                        Circle()
                            .fill(i < pin.count ? HK.accent : Color.clear)
                            .frame(width: 14, height: 14)
                            .overlay(Circle().stroke(HK.accent.opacity(0.5), lineWidth: 1.5))
                    }
                }
                .padding(.top, 28)
                .offset(x: shake ? -10 : 0)
                .animation(.default, value: shake)

                // Face ID — primary unlock once set up
                if !setupMode && session.biometryAvailable {
                    Button { Task { await session.tryBiometric() } } label: {
                        HStack(spacing: 8) {
                            Image(systemName: session.biometryName == "Touch ID" ? "touchid" : "faceid")
                                .font(.system(size: 18, weight: .semibold))
                            Text("Unlock with \(session.biometryName)")
                                .font(.system(size: 15, weight: .semibold))
                        }
                        .foregroundStyle(HK.accent)
                        .padding(.horizontal, 18).padding(.vertical, 11)
                        .background(HK.accent.opacity(0.14), in: Capsule())
                    }
                    .buttonStyle(.plain)
                    .padding(.top, 22)
                }

                Spacer()
                keypad
                Text(setupMode ? "Sets up every chamber" : "or enter PIN")
                    .font(.system(size: 11.5, weight: .medium)).foregroundStyle(HK.textFaint)
                    .padding(.top, 4)
                Spacer()
            }
        }
        .task {
            // auto-offer Face ID the moment the lock screen appears
            if !setupMode { await session.tryBiometric() }
        }
    }

    private var keypad: some View {
        VStack(spacing: 16) {
            ForEach([["1","2","3"],["4","5","6"],["7","8","9"],["","0","⌫"]], id: \.self) { row in
                HStack(spacing: 22) {
                    ForEach(row, id: \.self) { key in keyButton(key) }
                }
            }
        }
    }

    @ViewBuilder private func keyButton(_ key: String) -> some View {
        if key.isEmpty {
            Color.clear.frame(width: 74, height: 74)
        } else {
            Button { tap(key) } label: {
                Text(key)
                    .font(.system(size: key == "⌫" ? 22 : 28, weight: .medium))
                    .foregroundStyle(HK.text)
                    .frame(width: 74, height: 74)
                    .background(HK.card, in: Circle())
                    .overlay(Circle().stroke(HK.line, lineWidth: 1))
            }
            .disabled(session.working)
        }
    }

    private func tap(_ key: String) {
        if key == "⌫" { if !pin.isEmpty { pin.removeLast() }; return }
        guard pin.count < dots else { return }
        pin += key
        if pin.count == dots {
            let entered = pin
            Task {
                await session.submitPin(entered)
                if !session.unlocked { shake.toggle(); pin = "" }
            }
        }
    }
}
