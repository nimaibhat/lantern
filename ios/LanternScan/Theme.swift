import CoreText
import SwiftUI
import UIKit

// Lantern's look, matching the website: warm stone by day, dark walnut by night, amber accent,
// Tomorrow for headings, Geist for text and Geist Mono for codes. Fonts are bundled in Fonts/ (SIL OFL).

enum Theme {
    static let bg = Color(light: 0xEBE6DE, dark: 0x1A1714)
    static let surface = Color(light: 0xF5F2ED, dark: 0x24201C)
    static let border = Color(light: 0xD9D2C7, dark: 0x3A332C)
    static let text = Color(light: 0x3B342D, dark: 0xEBE6DE)
    static let muted = Color(light: 0x7A7067, dark: 0x9A8F84)
    static let accent = Color(light: 0xC9772A, dark: 0xF5A54A)
    static let alert = Color(light: 0xB5452F, dark: 0xE0664D)
    static let ok = Color(light: 0x4F7A52, dark: 0x7FB083)
    static let glow = Color(hex: 0xF5A54A)
    static let onAccent = Color(light: 0xFFFFFF, dark: 0x1A1714) // text on amber: white by day, walnut on the brighter night amber

    static func heading(_ size: CGFloat, light: Bool = false) -> Font {
        .custom(light ? "Tomorrow-Light" : "Tomorrow-Regular", size: size, relativeTo: .title)
    }
    static func body(_ size: CGFloat = 16, weight: Font.Weight = .regular) -> Font {
        .custom("Geist-Regular", size: size, relativeTo: .body).weight(weight)
    }
    static func mono(_ size: CGFloat = 13) -> Font {
        .custom("GeistMono-Regular", size: size, relativeTo: .caption)
    }

    // Fonts ship inside the app; register them once at launch so no Info.plist entry is needed.
    static func registerFonts() {
        for url in Bundle.main.urls(forResourcesWithExtension: "ttf", subdirectory: nil) ?? [] {
            CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
        }
    }
}

extension Color {
    init(hex: UInt32) {
        self.init(red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255, blue: Double(hex & 0xFF) / 255)
    }

    // One color for light mode and one for dark mode.
    init(light: UInt32, dark: UInt32) {
        self.init(UIColor { traits in UIColor(Color(hex: traits.userInterfaceStyle == .dark ? dark : light)) })
    }
}

// MARK: Building blocks

struct Card<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 14) { content }
            .padding(18)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(Theme.border, lineWidth: 1))
    }
}

struct Eyebrow: View {
    let text: String
    var body: some View {
        Text(text.uppercased()).font(Theme.mono(11)).tracking(1.2).foregroundStyle(Theme.muted)
    }
}

struct PrimaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var enabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Theme.body(17, weight: .medium))
            .foregroundStyle(Theme.onAccent)
            .frame(maxWidth: .infinity, minHeight: 54)
            .background(Theme.accent.opacity(enabled ? 1 : 0.4), in: Capsule())
            .shadow(color: Theme.glow.opacity(enabled ? 0.35 : 0), radius: configuration.isPressed ? 6 : 14, y: 4)
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.easeOut(duration: 0.15), value: configuration.isPressed)
    }
}

struct GhostButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Theme.body(15))
            .foregroundStyle(Theme.text)
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .background(Capsule().stroke(Theme.border, lineWidth: 1))
            .opacity(configuration.isPressed ? 0.6 : 1)
    }
}

struct Chip: View {
    let label: String
    var selected = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(label)
                .font(Theme.body(14))
                .foregroundStyle(selected ? .white : Theme.text)
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .background(selected ? Theme.accent : Theme.bg, in: Capsule())
                .overlay(Capsule().stroke(selected ? Theme.accent : Theme.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }
}

struct ThemedField: View {
    let title: String
    @Binding var text: String
    var placeholder = ""
    var mono = false
    var big = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if !title.isEmpty { Eyebrow(text: title) }
            TextField("", text: $text, prompt: Text(placeholder).foregroundStyle(Theme.muted.opacity(0.5)))
                .font(mono ? Theme.mono(big ? 28 : 16) : Theme.body(17))
                .tracking(big ? 6 : 0)
                .foregroundStyle(Theme.text)
                .padding(.horizontal, 14)
                .padding(.vertical, big ? 14 : 12)
                .background(Theme.bg, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Theme.border, lineWidth: 1))
        }
    }
}

// The soft lantern light behind the pairing screen, like the landing page.
struct LanternGlow: View {
    @State private var breathe = false

    var body: some View {
        RadialGradient(colors: [Theme.glow.opacity(0.45), Theme.glow.opacity(0.08), .clear], center: .top, startRadius: 10, endRadius: breathe ? 420 : 360)
            .ignoresSafeArea()
            .onAppear {
                withAnimation(.easeInOut(duration: 3.5).repeatForever(autoreverses: true)) { breathe = true }
            }
    }
}
