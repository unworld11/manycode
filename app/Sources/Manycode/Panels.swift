import SwiftUI

// MARK: - config.json (shared with the CLI, same dot-dir resolution)

enum Config {
    static var dir: URL {
        let home = FileManager.default.homeDirectoryForCurrentUser
        let new = home.appendingPathComponent(".manycode")
        if FileManager.default.fileExists(atPath: new.path) { return new }
        let old = home.appendingPathComponent(".ccshare")
        return FileManager.default.fileExists(atPath: old.path) ? old : new
    }
    static var file: URL { dir.appendingPathComponent("config.json") }

    static func read() -> [String: Any] {
        (try? Data(contentsOf: file)).flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:]
    }

    static func setName(_ name: String) {
        var cfg = read()
        cfg["name"] = name
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        if let data = try? JSONSerialization.data(withJSONObject: cfg, options: [.prettyPrinted, .sortedKeys]) {
            try? data.write(to: file)
        }
    }
}

// MARK: - Settings

struct SettingsView: View {
    @EnvironmentObject var app: AppState
    @State private var cfg: [String: Any] = Config.read()
    @State private var nameDraft = ""

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text("Settings").font(.system(size: 22, weight: .bold))

                group("You") {
                    HStack {
                        Text("Display name").font(.system(size: 13)).foregroundColor(.mcDim(0.75)).frame(width: 130, alignment: .leading)
                        TextField("how joiners see you", text: $nameDraft)
                            .textFieldStyle(.plain).font(.system(size: 13)).foregroundColor(.mcText)
                            .onSubmit(saveName)
                        Button("Save", action: saveName).buttonStyle(.plain)
                            .font(.system(size: 12, weight: .semibold)).foregroundColor(.mcGreen)
                    }.padding(.horizontal, 14).padding(.vertical, 11)
                }

                group("Defaults · set with `manycode setup`") {
                    row("Default agent", value(cfg["agent"]) ?? "claude")
                    divider
                    row("Open tunnel", boolText(cfg["tunnel"], default: true))
                    divider
                    row("Menu bar helper", boolText(cfg["menubar"], default: true))
                    divider
                    row("Approve joiners", boolText(cfg["approve"], default: false))
                }

                Text("These defaults are shared with the manycode CLI. Run `manycode setup` in a terminal to change them, or override per session with flags.")
                    .font(.system(size: 11.5)).foregroundColor(.mcDim(0.45)).lineSpacing(2)
            }
            .padding(28).frame(maxWidth: .infinity, alignment: .leading)
        }
        .onAppear { cfg = Config.read(); nameDraft = (cfg["name"] as? String) ?? app.userName }
    }

    private func saveName() {
        let n = nameDraft.trimmingCharacters(in: .whitespaces)
        guard !n.isEmpty else { return }
        Config.setName(n)
        app.userName = n
    }

    private func group<C: View>(_ title: String, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title.uppercased()).font(.system(size: 10, weight: .semibold)).kerning(0.6).foregroundColor(.mcDim(0.45)).padding(.horizontal, 4)
            VStack(spacing: 0) { content() }
                .background(Color.mcPanel)
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.mcBorder))
                .cornerRadius(12)
        }
    }

    private func row(_ label: String, _ v: String) -> some View {
        HStack {
            Text(label).font(.system(size: 13)).foregroundColor(.mcDim(0.75))
            Spacer()
            Text(v).font(.system(size: 12.5, design: .monospaced)).foregroundColor(.mcText)
        }.padding(.horizontal, 14).padding(.vertical, 11)
    }

    private var divider: some View { Rectangle().fill(Color.mcBorder).frame(height: 1) }
    private func value(_ a: Any?) -> String? { a as? String }
    private func boolText(_ a: Any?, default d: Bool) -> String {
        let b = (a as? Bool) ?? d
        return b ? "on" : "off"
    }
}

// MARK: - Recordings

struct RecordingsView: View {
    @State private var sessions: [LocalSession] = []
    private let tick = Timer.publish(every: 3, on: .main, in: .common).autoconnect()

    private var recording: [LocalSession] { sessions.filter { $0.recording != nil } }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Recordings").font(.system(size: 22, weight: .bold))
                    Text("sessions saved as asciinema .cast files").font(.system(size: 13)).foregroundColor(.mcDim(0.6))
                }

                if recording.isEmpty {
                    VStack(spacing: 12) {
                        Image(systemName: "record.circle").font(.system(size: 30)).foregroundColor(.mcDim(0.35))
                        Text("nothing recording right now").font(.system(size: 13)).foregroundColor(.mcDim(0.6))
                        Text("host with recording on (or `manycode host --record`) and the .cast\nlands in the project folder — reveal it here while it's live.")
                            .font(.system(size: 12)).foregroundColor(.mcDim(0.45)).multilineTextAlignment(.center).lineSpacing(2)
                    }
                    .frame(maxWidth: .infinity).padding(.vertical, 40)
                } else {
                    Text("RECORDING NOW").font(.system(size: 10, weight: .semibold)).kerning(0.6).foregroundColor(.mcDim(0.45))
                    VStack(spacing: 8) {
                        ForEach(recording) { s in recRow(s) }
                    }
                }
            }
            .padding(28).frame(maxWidth: .infinity, alignment: .leading)
        }
        .onAppear { sessions = Discovery.localSessions() }
        .onReceive(tick) { _ in sessions = Discovery.localSessions() }
    }

    private func recRow(_ s: LocalSession) -> some View {
        HStack(spacing: 12) {
            Circle().fill(Color.mcRedDot).frame(width: 8, height: 8)
            VStack(alignment: .leading, spacing: 2) {
                Text((s.recording! as NSString).lastPathComponent).font(.system(size: 13, weight: .semibold, design: .monospaced)).foregroundColor(.mcText)
                Text("\(s.dirName) · \(s.spacedCode)").font(.system(size: 11)).foregroundColor(.mcDim(0.5))
            }
            Spacer()
            Button("Reveal") { NSWorkspace.shared.selectFile(s.recording!, inFileViewerRootedAtPath: "") }
                .buttonStyle(.plain).font(.system(size: 12, weight: .semibold)).foregroundColor(.mcGreen)
        }
        .padding(12).background(Color.mcPanel)
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.mcBorder)).cornerRadius(10)
    }
}
