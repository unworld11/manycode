import SwiftUI

@main
struct ManycodeApp: App {
    @StateObject private var client = SessionClient()
    @StateObject private var app = AppState()

    var body: some Scene {
        WindowGroup {
            Shell()
                .environmentObject(client)
                .environmentObject(app)
                .frame(minWidth: 860, minHeight: 600)
                .preferredColorScheme(.dark)
        }
        .windowStyle(.hiddenTitleBar)
        .windowResizability(.contentSize)
    }
}

enum Section: String, CaseIterable, Identifiable {
    case host = "Host"
    case join = "Join"
    case messages = "Messages"
    case recordings = "Recordings"
    case settings = "Settings"
    var id: String { rawValue }
}

// App-wide navigation + which session (if any) we started ourselves.
final class AppState: ObservableObject {
    @Published var section: Section = .host
    @Published var hostedSession: LocalSession?
    @Published var userName: String = Discovery.configName()
}

// MARK: - design A palette (terminal green)

extension Color {
    static let mcBg      = Color(hex: 0x14171B) // window
    static let mcSidebar = Color(hex: 0x101215)
    static let mcDeep    = Color(hex: 0x0B0D10) // terminal / hero
    static let mcText    = Color(hex: 0xE8EAED)
    static let mcGreen   = Color(hex: 0x5EE38A)
    static let mcAmber   = Color(hex: 0xE8B45A)
    static let mcRed     = Color(hex: 0xFF8A8A)
    static let mcRedDot  = Color(hex: 0xFF5F57)

    static func mcDim(_ o: Double) -> Color { Color(red: 235/255, green: 238/255, blue: 242/255, opacity: o) }
    static let mcPanel   = Color.white.opacity(0.035)
    static let mcPanelHi = Color.white.opacity(0.06)
    static let mcBorder  = Color.white.opacity(0.07)
    static let mcGreenGlow = Color(hex: 0x5EE38A).opacity(0.12)

    init(hex: UInt32) {
        self.init(
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255)
    }
}

// deterministic per-name color for avatars / chat, mirroring the web sidebar
func nameColor(_ n: String) -> Color {
    var h: UInt32 = 0
    for c in n.unicodeScalars { h = h &* 31 &+ c.value }
    return Color(hue: Double(h % 360) / 360.0, saturation: 0.5, brightness: 0.72)
}

func avatarLetter(_ n: String) -> String {
    String(n.trimmingCharacters(in: .whitespaces).first ?? "?").uppercased()
}

let mcMono = Font.system(size: 13, design: .monospaced)
