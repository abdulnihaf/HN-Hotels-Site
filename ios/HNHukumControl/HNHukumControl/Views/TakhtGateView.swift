import SwiftUI

// Takht PIN gate — auto-submits on the 4th digit (no enter button), mirroring the owner-witness page.
// The only write-shaped call in the whole chamber: verify-pin → mint the gate.
struct TakhtGateView: View {
    @ObservedObject var model: TakhtAppModel
    private let accent = Color(hex: 0xC8964A)
    @State private var buf = ""
    @State private var err = ""
    @State private var checking = false

    var body: some View {
        VStack(spacing: 0) {
            Spacer()
            ZStack {
                RoundedRectangle(cornerRadius: 18)
                    .fill(HK.bgElev)
                    .overlay(RoundedRectangle(cornerRadius: 18).stroke(accent.opacity(0.5), lineWidth: 1))
                    .frame(width: 76, height: 76)
                Text("t").font(.system(size: 40, weight: .heavy, design: .serif)).foregroundStyle(accent)
            }
            Text("Takht")
                .font(.system(size: 48, weight: .heavy, design: .serif)).foregroundStyle(HK.text)
                .padding(.top, 18)
            Text("the seat where revenue lands")
                .font(.system(size: 15, weight: .medium, design: .serif)).italic()
                .foregroundStyle(accent).padding(.top, 2)

            HStack(spacing: 16) {
                ForEach(0..<4, id: \.self) { i in
                    Circle()
                        .strokeBorder(accent.opacity(0.6), lineWidth: 1.5)
                        .background(Circle().fill(i < buf.count ? accent : .clear))
                        .frame(width: 12, height: 12)
                }
            }
            .padding(.top, 30).padding(.bottom, 28)

            Text(err.isEmpty ? " " : err)
                .font(.system(size: 13)).foregroundStyle(HK.error).frame(height: 16)

            keypad.padding(.top, 8)
            Spacer()
            Text("HN Hotels · since 1918")
                .font(.system(size: 11, weight: .medium, design: .serif)).italic()
                .foregroundStyle(accent.opacity(0.5)).padding(.bottom, 8)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(HK.bg.ignoresSafeArea())
    }

    private var keypad: some View {
        let keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"]
        return LazyVGrid(columns: Array(repeating: GridItem(.fixed(68), spacing: 22), count: 3), spacing: 22) {
            ForEach(keys, id: \.self) { k in
                if k.isEmpty {
                    Color.clear.frame(width: 68, height: 68)
                } else {
                    Button { tap(k) } label: {
                        Text(k)
                            .font(.system(size: k == "⌫" ? 22 : 26, weight: .regular))
                            .foregroundStyle(k == "⌫" ? HK.textDim : HK.text)
                            .frame(width: 68, height: 68)
                            .background(k == "⌫" ? Color.clear : HK.cardHi, in: Circle())
                    }
                    .disabled(checking)
                }
            }
        }
    }

    private func tap(_ k: String) {
        err = ""
        if k == "⌫" { if !buf.isEmpty { buf.removeLast() }; return }
        guard buf.count < 4 else { return }
        buf += k
        if buf.count == 4 { submit() }
    }

    private func submit() {
        let pin = buf
        checking = true
        Task {
            if let e = await model.unlock(pin: pin) {
                err = e; buf = ""; checking = false
            }
            // success path flips model.unlocked → parent swaps to the board
        }
    }
}
