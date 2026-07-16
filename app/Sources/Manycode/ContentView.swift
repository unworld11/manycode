import SwiftUI

// MARK: - Shell: lobby (nav sidebar) vs focused live session

struct Shell: View {
    @EnvironmentObject var client: SessionClient
    @EnvironmentObject var app: AppState

    var body: some View {
        ZStack {
            Color.mcBg.ignoresSafeArea()
            if client.joined || client.sessionEnded {
                SessionWorkspace()          // design 1d — focused, no nav rail
            } else {
                HStack(spacing: 0) {
                    Sidebar()               // design 1a rail
                    Divider().overlay(Color.mcBorder)
                    lobbyContent
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
        }
        .foregroundColor(.mcText)
    }

    @ViewBuilder private var lobbyContent: some View {
        switch app.section {
        case .host:       HostView()
        case .join:       JoinView()
        case .messages:   MessagesLobby()
        case .recordings: RecordingsView()
        case .settings:   SettingsView()
        }
    }
}

// MARK: - Sidebar (design 1a)

struct Sidebar: View {
    @EnvironmentObject var app: AppState

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // leave room for the real macOS window controls (hidden titlebar)
            Spacer().frame(height: 26)
            Text("$ manycode")
                .font(.system(size: 14, weight: .semibold, design: .monospaced))
                .foregroundColor(.mcGreen)
                .padding(.leading, 8).padding(.bottom, 20)

            VStack(spacing: 2) {
                ForEach(Section.allCases) { s in
                    NavRow(section: s, active: app.section == s) { app.section = s }
                }
            }
            Spacer()
            HStack(spacing: 9) {
                Circle().fill(Color.mcGreenGlow).overlay(
                    Text(avatarLetter(app.userName)).font(.system(size: 11, weight: .bold)).foregroundColor(.mcGreen)
                ).frame(width: 24, height: 24)
                Text("\(app.userName) · host").font(.system(size: 12)).foregroundColor(.mcDim(0.6))
            }
            .padding(.vertical, 10).padding(.leading, 4)
            .overlay(Rectangle().fill(Color.mcBorder).frame(height: 1), alignment: .top)
        }
        .padding(14)
        .frame(width: 212)
        .background(Color.mcSidebar)
    }
}

struct NavRow: View {
    let section: Section
    let active: Bool
    let tap: () -> Void

    var body: some View {
        Button(action: tap) {
            HStack(spacing: 9) {
                Circle().fill(active ? Color.mcGreen : Color.mcDim(0.35)).frame(width: 7, height: 7)
                Text(section.rawValue)
                    .font(.system(size: 13, weight: active ? .semibold : .regular))
                    .foregroundColor(active ? .mcGreen : .mcDim(0.7))
                Spacer()
            }
            .padding(.horizontal, 10).padding(.vertical, 7)
            .background(active ? Color.mcGreenGlow : .clear)
            .cornerRadius(8)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Host (design 1a entry: your sessions + start hosting)

struct HostView: View {
    @EnvironmentObject var client: SessionClient
    @EnvironmentObject var app: AppState
    @State private var sessions: [LocalSession] = []
    @State private var busy = false
    @State private var err: String?
    private let tick = Timer.publish(every: 2, on: .main, in: .common).autoconnect()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                header

                Button(action: hostFolder) {
                    HStack(spacing: 12) {
                        Image(systemName: "folder.badge.plus").font(.system(size: 16)).foregroundColor(.mcGreen)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(busy ? "starting…" : "Host a folder")
                                .font(.system(size: 14, weight: .semibold)).foregroundColor(.mcText)
                            Text("share a live agent session from any project directory")
                                .font(.system(size: 12)).foregroundColor(.mcDim(0.55))
                        }
                        Spacer()
                        Image(systemName: "chevron.right").foregroundColor(.mcDim(0.4))
                    }
                    .padding(16)
                    .background(Color.mcGreenGlow)
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.mcGreen.opacity(0.25)))
                    .cornerRadius(12)
                }
                .buttonStyle(.plain).disabled(busy)

                if let err { Text(err).font(.system(size: 12)).foregroundColor(.mcRed) }

                if sessions.isEmpty {
                    emptyState
                } else {
                    Text("SESSIONS ON THIS MAC").font(.system(size: 10, weight: .semibold)).kerning(0.6).foregroundColor(.mcDim(0.45))
                    VStack(spacing: 8) {
                        ForEach(sessions) { s in SessionCard(s: s) { open(s) } }
                    }
                }
            }
            .padding(28)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .onAppear { sessions = Discovery.localSessions() }
        .onReceive(tick) { _ in sessions = Discovery.localSessions() }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Host").font(.system(size: 22, weight: .bold))
            Text("start a session, or hop back into one already running here")
                .font(.system(size: 13)).foregroundColor(.mcDim(0.6))
        }
    }

    private var emptyState: some View {
        HStack(spacing: 10) {
            Image(systemName: "antenna.radiowaves.left.and.right").foregroundColor(.mcDim(0.4))
            Text("nothing hosted yet — pick a folder above to go live")
                .font(.system(size: 12.5)).foregroundColor(.mcDim(0.5))
        }
        .padding(.vertical, 8)
    }

    private func open(_ s: LocalSession) {
        app.hostedSession = s
        guard let url = URL(string: "ws://127.0.0.1:\(s.port)") else { return }
        client.connect(url: url, code: s.code, name: app.userName)
    }

    private func hostFolder() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.prompt = "Host here"
        panel.message = "pick the project folder to share"
        guard panel.runModal() == .OK, let folder = panel.url else { return }
        busy = true; err = nil
        HostLauncher.startHost(in: folder) { result in
            DispatchQueue.main.async {
                busy = false
                switch result {
                case .failure(let e): err = e.localizedDescription
                case .success(let s): open(s)
                }
            }
        }
    }
}

struct SessionCard: View {
    let s: LocalSession
    let tap: () -> Void
    var body: some View {
        Button(action: tap) {
            HStack(spacing: 14) {
                Text(s.spacedCode).font(.system(size: 16, weight: .bold, design: .monospaced)).foregroundColor(.mcGreen)
                VStack(alignment: .leading, spacing: 2) {
                    Text(s.dirName).font(.system(size: 13, weight: .semibold)).foregroundColor(.mcText)
                    Text("\(s.cmd)\(s.tunnel != nil ? " · tunnel open" : "")\(s.recording != nil ? " · rec" : "")")
                        .font(.system(size: 11)).foregroundColor(.mcDim(0.5))
                }
                Spacer()
                Text(s.names.isEmpty ? "nobody in yet" : s.names.joined(separator: ", "))
                    .font(.system(size: 11)).foregroundColor(.mcDim(0.5))
                Image(systemName: "arrow.right").foregroundColor(.mcGreen)
            }
            .padding(12)
            .background(Color.mcPanel)
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.mcBorder))
            .cornerRadius(10)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Join (design 1e: code boxes)

struct JoinView: View {
    @EnvironmentObject var client: SessionClient
    @EnvironmentObject var app: AppState
    @State private var code = ""
    @State private var busy = false
    @FocusState private var focused: Bool

    private var chars: [Character] { Array(code.prefix(6)) }

    var body: some View {
        VStack(spacing: 22) {
            Spacer()
            VStack(spacing: 6) {
                Text("Join a session").font(.system(size: 18, weight: .bold))
                Text("type the 6-character code your friend read out")
                    .font(.system(size: 12)).foregroundColor(.mcDim(0.55))
            }

            HStack(spacing: 8) {
                ForEach(0..<6, id: \.self) { i in
                    CodeBox(ch: i < chars.count ? String(chars[i]) : "",
                            active: i == chars.count && focused)
                }
            }
            .onTapGesture { focused = true }
            .overlay(
                TextField("", text: $code)
                    .focused($focused)
                    .textFieldStyle(.plain)
                    .foregroundColor(.clear)
                    .accentColor(.clear)
                    .onChange(of: code) { v in
                        code = String(v.uppercased().filter { $0.isLetter || $0.isNumber }.prefix(6))
                    }
                    .onSubmit(join)
                    .opacity(0.01)
            )

            if let e = client.errorText {
                Text(e).font(.system(size: 12)).foregroundColor(.mcRed).multilineTextAlignment(.center).frame(maxWidth: 380)
            } else if busy {
                HStack(spacing: 8) {
                    Circle().fill(Color.mcGreen).frame(width: 6, height: 6)
                    Text("looking for the session on your network…").font(.system(size: 12)).foregroundColor(.mcDim(0.55))
                }
            }

            Button(action: join) {
                Text(busy ? "joining…" : "Join")
                    .font(.system(size: 13, weight: .semibold)).foregroundColor(.mcDeep)
                    .padding(.horizontal, 22).padding(.vertical, 9)
                    .background(Color.mcGreen).cornerRadius(9)
            }
            .buttonStyle(.plain).disabled(code.count < 4 || busy)
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .onAppear { focused = true; client.errorText = nil }
    }

    private func join() {
        let c = code.uppercased().filter { $0.isLetter || $0.isNumber }
        guard c.count >= 4 else { return }
        client.errorText = nil
        if let s = Discovery.localSessions().first(where: { $0.code == c }) {
            app.hostedSession = nil
            connect(host: "127.0.0.1", port: s.port, code: c); return
        }
        busy = true
        DispatchQueue.global().async {
            let found = Discovery.discoverLAN(code: c)
            DispatchQueue.main.async {
                busy = false
                if let f = found { connect(host: f.host, port: f.port, code: c) }
                else { client.errorText = "no session found on this network — if they're remote, open their browser link instead" }
            }
        }
    }

    private func connect(host: String, port: Int, code: String) {
        guard let url = URL(string: "ws://\(host):\(port)") else { return }
        client.connect(url: url, code: code, name: app.userName)
    }
}

struct CodeBox: View {
    let ch: String
    let active: Bool
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 10).fill(Color.mcDeep)
            RoundedRectangle(cornerRadius: 10)
                .stroke(active || !ch.isEmpty ? Color.mcGreen.opacity(active ? 0.7 : 0.4) : Color.white.opacity(0.1),
                        lineWidth: 1)
            if ch.isEmpty && active {
                Rectangle().fill(Color.mcGreen).frame(width: 2, height: 28)
            } else {
                Text(ch).font(.system(size: 30, weight: .bold, design: .monospaced)).foregroundColor(.mcGreen)
            }
        }
        .frame(width: 52, height: 62)
    }
}
