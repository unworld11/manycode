import Foundation
import Combine

// Speaks the manycode wire protocol: JSON text frames for control
// (join/ok/hold/replay/chat/exit), binary frames for terminal bytes.
// Same protocol as the CLI joiner and the browser page.

struct ChatMsg: Identifiable, Equatable {
    let id = UUID()
    let from: String
    let text: String
    let isHost: Bool
    let mine: Bool
}

final class SessionClient: NSObject, ObservableObject {
    @Published var status = "not connected"
    @Published var joined = false
    @Published var readOnly = false
    @Published var chat: [ChatMsg] = []
    @Published var unread = 0
    @Published var chatOpen = true
    @Published var code = ""
    @Published var errorText: String?
    @Published var sessionEnded = false

    /// terminal view installs this to receive output bytes (main thread).
    /// Anything that arrives before the view mounts is held and flushed on set,
    /// so an early replay frame is never dropped.
    var onOutput: ((Data) -> Void)? {
        didSet {
            guard onOutput != nil, !backlog.isEmpty else { return }
            let b = backlog; backlog = Data()
            onOutput?(b)
        }
    }
    private var backlog = Data()
    private func emit(_ d: Data) {
        if let o = onOutput { o(d) } else { backlog.append(d) }
    }

    private var ws: URLSessionWebSocketTask?
    private var replayed = false
    private var pending: [Data] = []
    private var myName = ""
    private var lastCols = 80
    private var lastRows = 24

    func connect(url: URL, code: String, name: String) {
        disconnect()
        self.code = code
        self.myName = name
        self.replayed = false
        self.pending = []
        self.sessionEnded = false
        self.errorText = nil
        status = "connecting…"
        let task = URLSession.shared.webSocketTask(with: url)
        ws = task
        task.resume()
        sendJSON(["t": "join", "code": code, "name": name, "cols": lastCols, "rows": lastRows])
        receiveLoop(task)
        // if the replay never lands (empty scrollback), stop holding frames
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in
            guard let self, !self.replayed else { return }
            self.replayed = true
            self.flushPending()
        }
    }

    func disconnect() {
        ws?.cancel(with: .goingAway, reason: nil)
        ws = nil
        DispatchQueue.main.async {
            self.joined = false
            self.status = "not connected"
        }
    }

    // full reset back to the lobby - drops the socket and clears the transcript
    func reset() {
        disconnect()
        DispatchQueue.main.async {
            self.sessionEnded = false
            self.errorText = nil
            self.chat = []
            self.unread = 0
            self.code = ""
            self.backlog = Data()
            self.pending = []
            self.replayed = false
            self.onOutput = nil
        }
    }

    // MARK: outbound

    func sendInput(_ bytes: ArraySlice<UInt8>) {
        guard joined, !readOnly, let ws else { return }
        ws.send(.data(Data(bytes))) { _ in }
    }

    func sendResize(cols: Int, rows: Int) {
        lastCols = cols
        lastRows = rows
        guard joined else { return }
        sendJSON(["t": "resize", "cols": cols, "rows": rows])
    }

    func sendChat(_ text: String) {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty, joined else { return }
        sendJSON(["t": "chat", "text": t])
        DispatchQueue.main.async {
            self.chat.append(ChatMsg(from: "you", text: t, isHost: false, mine: true))
        }
    }

    private func sendJSON(_ obj: [String: Any]) {
        guard let ws, let data = try? JSONSerialization.data(withJSONObject: obj),
              let s = String(data: data, encoding: .utf8) else { return }
        ws.send(.string(s)) { _ in }
    }

    // MARK: inbound

    private func receiveLoop(_ task: URLSessionWebSocketTask) {
        task.receive { [weak self] result in
            guard let self, self.ws === task else { return }
            switch result {
            case .failure(let err):
                DispatchQueue.main.async {
                    if !self.sessionEnded {
                        self.errorText = self.joined ? "disconnected" : "could not connect: \(err.localizedDescription)"
                        self.status = "disconnected"
                        self.joined = false
                    }
                }
            case .success(let msg):
                switch msg {
                case .data(let d): self.handleBinary(d)
                case .string(let s): self.handleControl(s)
                @unknown default: break
                }
                self.receiveLoop(task)
            }
        }
    }

    private func handleBinary(_ d: Data) {
        DispatchQueue.main.async {
            if !self.replayed { self.pending.append(d) } else { self.emit(d) }
        }
    }

    private func flushPending() {
        for p in pending { emit(p) }
        pending = []
    }

    private func handleControl(_ s: String) {
        guard let data = s.data(using: .utf8),
              let m = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let t = m["t"] as? String else { return }
        DispatchQueue.main.async {
            switch t {
            case "hold":
                self.status = "waiting for the host to let you in…"
            case "ok":
                self.joined = true
                self.readOnly = (m["readOnly"] as? Bool) ?? false
                self.status = "connected as \(self.myName)" + (self.readOnly ? " · view only" : "")
            case "replay":
                if let b64 = m["d"] as? String, let bytes = Data(base64Encoded: b64) {
                    self.emit(bytes)
                }
                self.replayed = true
                self.flushPending()
                if (m["readOnly"] as? Bool) == true { self.readOnly = true }
            case "chat":
                let from = (m["from"] as? String) ?? "friend"
                let text = (m["text"] as? String) ?? ""
                self.chat.append(ChatMsg(from: from, text: text, isHost: (m["host"] as? Bool) ?? false, mine: false))
                if !self.chatOpen { self.unread += 1 }
            case "chatlog":
                for c in (m["msgs"] as? [[String: Any]]) ?? [] {
                    self.chat.append(ChatMsg(
                        from: (c["from"] as? String) ?? "friend",
                        text: (c["text"] as? String) ?? "",
                        isHost: (c["host"] as? Bool) ?? false,
                        mine: false))
                }
            case "err":
                self.errorText = (m["msg"] as? String) ?? "rejected"
                self.status = "not connected"
                self.joined = false
            case "exit":
                self.sessionEnded = true
                self.status = "host ended the session"
                self.joined = false
            default:
                break
            }
        }
    }
}
