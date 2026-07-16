import SwiftUI

// design 1d — focused live session: terminal + right rail (people / messages)
struct SessionWorkspace: View {
    @EnvironmentObject var client: SessionClient
    @EnvironmentObject var app: AppState
    @State private var rail: Rail = .people
    @State private var showInvite = false

    enum Rail { case people, messages }

    private var isHost: Bool { app.hostedSession != nil }
    private var liveSession: LocalSession? {
        Discovery.localSessions().first { $0.code == client.code }
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider().overlay(Color.mcBorder)
            if client.sessionEnded {
                endedState
            } else {
                HStack(spacing: 0) {
                    TerminalWrapper(client: client)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(Color.mcDeep)
                    Divider().overlay(Color.mcBorder)
                    rightRail.frame(width: 244)
                }
            }
            Divider().overlay(Color.mcBorder)
            statusBar
        }
        .background(Color.mcBg)
        .sheet(isPresented: $showInvite) {
            InviteSheet(session: liveSession, code: client.code).environmentObject(app)
        }
    }

    // MARK: header

    private var header: some View {
        HStack(spacing: 10) {
            // clear the real macOS traffic lights on the left
            Spacer().frame(width: 68)
            Text(sessionTitle).font(.system(size: 13, design: .monospaced)).foregroundColor(.mcDim(0.7))
            Spacer()
            Text(client.code.isEmpty ? "" : spaced(client.code))
                .font(.system(size: 12, weight: .bold, design: .monospaced)).foregroundColor(.mcGreen)
                .padding(.horizontal, 10).padding(.vertical, 4)
                .background(Color.mcGreen.opacity(0.1))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.mcGreen.opacity(0.25)))
                .cornerRadius(8)
            if liveSession?.recording != nil { recPill }
            if isHost {
                pillButton("Invite", icon: "person.badge.plus") { showInvite = true }
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
    }

    private var sessionTitle: String {
        if let s = liveSession { return "~/\(s.dirName) · \(s.cmd)" }
        return client.readOnly ? "joined · view only" : "joined session"
    }

    private var recPill: some View {
        HStack(spacing: 6) {
            Circle().fill(Color.mcRedDot).frame(width: 6, height: 6)
            Text("REC").font(.system(size: 11, weight: .semibold))
        }
        .foregroundColor(.mcRed)
        .padding(.horizontal, 10).padding(.vertical, 4)
        .overlay(Capsule().stroke(Color.mcRed.opacity(0.4)))
    }

    // MARK: right rail

    private var rightRail: some View {
        VStack(spacing: 0) {
            HStack(spacing: 6) {
                railTab(title: "People", icon: "person.2", tag: .people, badge: 0)
                railTab(title: "Messages", icon: "bubble.left", tag: .messages, badge: client.unread)
            }
            .padding(8)

            Divider().overlay(Color.mcBorder)

            if rail == .people { PeopleRail(isHost: isHost, live: liveSession) }
            else { ChatPane() }
        }
        .background(Color.mcSidebar)
    }

    private func railTab(title: String, icon: String, tag: Rail, badge: Int) -> some View {
        let active = rail == tag
        return Button {
            rail = tag
            if tag == .messages { client.unread = 0 }
        } label: {
            HStack(spacing: 6) {
                Image(systemName: icon).font(.system(size: 11))
                Text(title).font(.system(size: 12, weight: .semibold))
                if badge > 0 {
                    Text("\(badge)").font(.system(size: 10, weight: .bold)).foregroundColor(.mcDeep)
                        .padding(.horizontal, 5).padding(.vertical, 1)
                        .background(Color.mcGreen).clipShape(Capsule())
                }
            }
            .foregroundColor(active ? .mcGreen : .mcDim(0.6))
            .frame(maxWidth: .infinity).padding(.vertical, 7)
            .background(active ? Color.mcGreenGlow : Color.white.opacity(0.03))
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(active ? Color.mcGreen.opacity(0.3) : .clear))
            .cornerRadius(8)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    // MARK: status bar

    private var statusBar: some View {
        HStack(spacing: 8) {
            Text(client.status).font(.system(size: 11)).foregroundColor(.mcDim(0.45))
            Spacer()
            if let s = liveSession {
                if s.tunnel != nil { Text("tunnel open").font(.system(size: 11)).foregroundColor(.mcDim(0.45)) }
                if s.recording != nil { Text("· recording .cast").font(.system(size: 11)).foregroundColor(.mcDim(0.45)) }
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 8)
    }

    private var endedState: some View {
        VStack(spacing: 14) {
            Image(systemName: "moon.zzz").font(.system(size: 30)).foregroundColor(.mcDim(0.4))
            Text("the host ended the session").font(.system(size: 14)).foregroundColor(.mcDim(0.7))
            Button("Back to lobby") { leave() }
                .buttonStyle(.plain)
                .font(.system(size: 13, weight: .semibold)).foregroundColor(.mcDeep)
                .padding(.horizontal, 20).padding(.vertical, 9).background(Color.mcGreen).cornerRadius(9)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.mcDeep)
    }

    private func leave() {
        if let h = app.hostedSession { HostLauncher.endSession(h) } // ending our own host stops the engine
        app.hostedSession = nil
        client.reset()
    }

    private func pillButton(_ title: String, icon: String, tap: @escaping () -> Void) -> some View {
        Button(action: tap) {
            Label(title, systemImage: icon).font(.system(size: 12, weight: .medium))
                .padding(.horizontal, 12).padding(.vertical, 5)
                .foregroundColor(.mcText)
                .background(Color.mcPanelHi).cornerRadius(8)
        }.buttonStyle(.plain)
    }

    private func spaced(_ c: String) -> String {
        guard c.count > 3 else { return c }
        let mid = c.index(c.startIndex, offsetBy: c.count / 2)
        return "\(c[..<mid]) \(c[mid...])"
    }
}

// MARK: - people rail (design 1d joiners)

struct PeopleRail: View {
    @EnvironmentObject var client: SessionClient
    @EnvironmentObject var app: AppState
    let isHost: Bool
    let live: LocalSession?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("IN THIS SESSION").font(.system(size: 10, weight: .semibold)).kerning(0.6)
                .foregroundColor(.mcDim(0.45)).padding(.horizontal, 4).padding(.top, 12)

            personRow(name: "\(app.userName) (you)", sub: isHost ? "host" : (client.readOnly ? "view only" : "read-write"), me: true)
            ForEach(others, id: \.self) { n in
                personRow(name: n, sub: "connected", me: false)
            }
            if others.isEmpty && isHost {
                Text("nobody else yet — share the code")
                    .font(.system(size: 11)).foregroundColor(.mcDim(0.4)).padding(.horizontal, 6)
            }

            Spacer()
            Button(action: leave) {
                Text(isHost ? "End session" : "Leave")
                    .font(.system(size: 12, weight: .semibold)).foregroundColor(.mcRed)
                    .frame(maxWidth: .infinity).padding(.vertical, 8)
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.mcRed.opacity(0.4)))
            }.buttonStyle(.plain)
        }
        .padding(12)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }

    // Only the host can enumerate the roster (from its state file); a joiner
    // just sees itself. Hosting from the app means our own client shows up in
    // that roster too, so drop one instance of our name - what's left is the
    // genuine other people.
    private var others: [String] {
        guard isHost, var names = live?.names else { return [] }
        if let i = names.firstIndex(where: { $0.caseInsensitiveCompare(app.userName) == .orderedSame }) {
            names.remove(at: i)
        }
        return names
    }

    private func personRow(name: String, sub: String, me: Bool) -> some View {
        HStack(spacing: 9) {
            Circle().fill(me ? Color.mcGreenGlow : nameColor(name).opacity(0.3))
                .overlay(Text(avatarLetter(name)).font(.system(size: 11, weight: .bold)).foregroundColor(me ? .mcGreen : nameColor(name)))
                .frame(width: 26, height: 26)
            VStack(alignment: .leading, spacing: 1) {
                Text(name).font(.system(size: 12, weight: .semibold)).foregroundColor(.mcText).lineLimit(1)
                Text(sub).font(.system(size: 10)).foregroundColor(.mcDim(0.5))
            }
            Spacer()
            if !me { Circle().fill(Color.mcGreen).frame(width: 7, height: 7) }
        }
        .padding(8)
        .background(Color.mcPanel).cornerRadius(10)
    }

    private func leave() {
        if let h = app.hostedSession { HostLauncher.endSession(h) }
        app.hostedSession = nil
        client.reset()
    }
}

// MARK: - invite sheet (design 1a: code hero + join methods)

struct InviteSheet: View {
    @EnvironmentObject var app: AppState
    @Environment(\.dismiss) private var dismiss
    let session: LocalSession?
    let code: String

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Invite to the session").font(.system(size: 14, weight: .semibold))
                Spacer()
                Button { dismiss() } label: { Image(systemName: "xmark").foregroundColor(.mcDim(0.5)) }.buttonStyle(.plain)
            }
            .padding(16)
            Divider().overlay(Color.mcBorder)

            VStack(spacing: 14) {
                VStack(spacing: 12) {
                    Text("SESSION CODE — SAY IT OUT LOUD").font(.system(size: 10)).kerning(1.6).foregroundColor(.mcDim(0.4))
                    Text(spaced(code)).font(.system(size: 60, weight: .bold, design: .monospaced))
                        .foregroundColor(.mcGreen).shadow(color: .mcGreen.opacity(0.35), radius: 22)
                    HStack(spacing: 8) {
                        copyBtn("Copy code", value: code, outline: true)
                        if let b = session?.browser { copyBtn("Copy browser link", value: b, outline: false) }
                    }
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 28)
                .background(Color.mcDeep)
                .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.mcGreen.opacity(0.18)))
                .cornerRadius(14)

                VStack(spacing: 8) {
                    joinRow("same wifi", "manycode join \(code)")
                    if let ip = session?.ip, let port = session?.port {
                        joinRow("direct", "manycode join \(code) --host \(ip):\(port)")
                    }
                    if let b = session?.browser { joinRow("browser", b) }
                }
            }
            .padding(16)
        }
        .frame(width: 460)
        .background(Color.mcBg)
        .foregroundColor(.mcText)
    }

    private func joinRow(_ label: String, _ cmd: String) -> some View {
        HStack(spacing: 12) {
            Text(label.uppercased()).font(.system(size: 10)).kerning(0.6).foregroundColor(.mcDim(0.45)).frame(width: 74, alignment: .leading)
            Text(cmd).font(.system(size: 12, design: .monospaced)).foregroundColor(.mcText).lineLimit(1).truncationMode(.middle)
            Spacer()
            Button("copy") { copy(cmd) }.buttonStyle(.plain).font(.system(size: 11)).foregroundColor(.mcGreen)
        }
        .padding(.horizontal, 14).padding(.vertical, 10)
        .background(Color.mcPanel)
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.mcBorder))
        .cornerRadius(10)
    }

    private func copyBtn(_ title: String, value: String, outline: Bool) -> some View {
        Button { copy(value) } label: {
            Text(title).font(.system(size: 12, weight: .semibold))
                .foregroundColor(outline ? .mcGreen : .mcDim(0.75))
                .padding(.horizontal, 14).padding(.vertical, 6)
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(outline ? Color.mcGreen.opacity(0.35) : Color.white.opacity(0.12)))
        }.buttonStyle(.plain)
    }

    private func copy(_ s: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(s, forType: .string)
    }

    private func spaced(_ c: String) -> String {
        guard c.count > 3 else { return c }
        let mid = c.index(c.startIndex, offsetBy: c.count / 2)
        return "\(c[..<mid]) \(c[mid...])"
    }
}
