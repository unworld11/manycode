import SwiftUI

// Shared chat pane (session right rail) — design A language.
struct ChatPane: View {
    @EnvironmentObject var client: SessionClient
    @State private var draft = ""

    var body: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 10) {
                        if client.chat.isEmpty {
                            Text("no messages yet — say hi without typing into the shared prompt")
                                .font(.system(size: 11.5)).foregroundColor(.mcDim(0.4))
                                .padding(.top, 16).padding(.horizontal, 4)
                        }
                        ForEach(client.chat) { m in ChatBubble(m: m) }
                    }
                    .padding(12)
                }
                .onChange(of: client.chat) { _ in
                    if let last = client.chat.last { withAnimation { proxy.scrollTo(last.id, anchor: .bottom) } }
                }
            }
            Divider().overlay(Color.mcBorder)
            HStack(spacing: 8) {
                TextField("message the room…", text: $draft)
                    .textFieldStyle(.plain).font(.system(size: 12))
                    .foregroundColor(.mcText)
                    .onSubmit(send)
                Button(action: send) {
                    Image(systemName: "paperplane.fill").font(.system(size: 12)).foregroundColor(draft.isEmpty ? .mcDim(0.3) : .mcGreen)
                }.buttonStyle(.plain).disabled(draft.isEmpty)
            }
            .padding(10)
        }
        .frame(maxHeight: .infinity)
    }

    private func send() {
        let t = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty else { return }
        client.sendChat(t)
        draft = ""
    }
}

struct ChatBubble: View {
    let m: ChatMsg
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 5) {
                Text(m.mine ? "you" : m.from)
                    .font(.system(size: 11, weight: .bold))
                    .foregroundColor(m.mine ? .mcGreen : nameColor(m.from))
                if m.isHost {
                    Text("host").font(.system(size: 9, weight: .medium)).foregroundColor(.mcDim(0.5))
                        .padding(.horizontal, 4).padding(.vertical, 1)
                        .background(Color.white.opacity(0.06)).cornerRadius(4)
                }
            }
            Text(m.text).font(.system(size: 12.5)).foregroundColor(.mcText).textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// Lobby "Messages" tab — chat only lives inside a session, so guide there.
struct MessagesLobby: View {
    @EnvironmentObject var app: AppState

    var body: some View {
        VStack(spacing: 16) {
            Spacer()
            Image(systemName: "bubble.left.and.bubble.right")
                .font(.system(size: 34)).foregroundColor(.mcGreen.opacity(0.7))
            Text("Messages live inside a session").font(.system(size: 15, weight: .semibold))
            Text("join or host a session and the room chat opens alongside the terminal —\ntalk without typing over each other in the shared prompt.")
                .font(.system(size: 12.5)).foregroundColor(.mcDim(0.55))
                .multilineTextAlignment(.center).lineSpacing(3)
            HStack(spacing: 10) {
                lobbyBtn("Host a session", filled: true) { app.section = .host }
                lobbyBtn("Join by code", filled: false) { app.section = .join }
            }
            .padding(.top, 6)
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func lobbyBtn(_ t: String, filled: Bool, tap: @escaping () -> Void) -> some View {
        Button(action: tap) {
            Text(t).font(.system(size: 13, weight: .semibold))
                .foregroundColor(filled ? .mcDeep : .mcGreen)
                .padding(.horizontal, 18).padding(.vertical, 9)
                .background(filled ? Color.mcGreen : .clear)
                .overlay(RoundedRectangle(cornerRadius: 9).stroke(filled ? .clear : Color.mcGreen.opacity(0.35)))
                .cornerRadius(9)
        }.buttonStyle(.plain)
    }
}
