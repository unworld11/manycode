import AppKit
import Foundation

// ccshare menu bar helper. Shows active session codes from
// ~/.ccshare/sessions/*.json, copies join commands, notifies on joins.
// Launched by `ccshare host` with --auto (exits when no sessions remain)
// or by `ccshare menubar` without it (stays until quit).

let home = FileManager.default.homeDirectoryForCurrentUser
let stateDir = home.appendingPathComponent(".ccshare/sessions")
let pidFile = home.appendingPathComponent(".ccshare/menubar.pid")

// single instance
if let data = try? Data(contentsOf: pidFile),
   let s = String(data: data, encoding: .utf8),
   let old = Int32(s.trimmingCharacters(in: .whitespacesAndNewlines)),
   kill(old, 0) == 0 {
    exit(0)
}
try? FileManager.default.createDirectory(at: pidFile.deletingLastPathComponent(), withIntermediateDirectories: true)
try? String(ProcessInfo.processInfo.processIdentifier).write(to: pidFile, atomically: true, encoding: .utf8)

struct SessionState: Codable {
    let pid: Int32
    let code: String
    let port: Int?
    let ip: String?
    let cwd: String?
    let joiners: Int?
    let names: [String]?
    let tunnel: String?
}

let accent = NSColor(calibratedRed: 0xD9 / 255.0, green: 0x77 / 255.0, blue: 0x57 / 255.0, alpha: 1)

func spaced(_ code: String) -> String {
    // 7KQ2FM -> 7KQ 2FM, matching the terminal banner
    guard code.count > 3 else { return code }
    let mid = code.index(code.startIndex, offsetBy: code.count / 2)
    return "\(code[..<mid]) \(code[mid...])"
}

func symbol(_ name: String) -> NSImage? {
    let img = NSImage(systemSymbolName: name, accessibilityDescription: nil)
    img?.isTemplate = true
    return img
}

func readSessions() -> [SessionState] {
    guard let files = try? FileManager.default.contentsOfDirectory(at: stateDir, includingPropertiesForKeys: nil) else { return [] }
    var out: [SessionState] = []
    for f in files where f.pathExtension == "json" {
        guard let data = try? Data(contentsOf: f),
              let s = try? JSONDecoder().decode(SessionState.self, from: data) else { continue }
        if kill(s.pid, 0) == 0 {
            out.append(s)
        } else {
            try? FileManager.default.removeItem(at: f)
        }
    }
    return out.sorted { $0.pid < $1.pid }
}

func notify(_ text: String) {
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
    let esc = text.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"")
    p.arguments = ["-e", "display notification \"\(esc)\" with title \"ccshare\""]
    try? p.run()
}

class AppDelegate: NSObject, NSApplicationDelegate {
    var statusItem: NSStatusItem!
    var timer: Timer?
    var lastCounts: [Int32: Int] = [:]
    var lastSnapshot = "\u{0}"
    var emptySince: Date? = nil
    let auto = CommandLine.arguments.contains("--auto")

    func applicationDidFinishLaunching(_ n: Notification) {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let btn = statusItem.button {
            btn.font = NSFont.monospacedSystemFont(ofSize: 12, weight: .semibold)
            if let img = symbol("terminal.fill") ?? symbol("terminal") {
                btn.image = img
                btn.imagePosition = .imageLeading
            }
        }
        refresh()
        timer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { _ in self.refresh() }
    }

    func refresh() {
        let sessions = readSessions()

        if sessions.isEmpty {
            if auto {
                if emptySince == nil { emptySince = Date() }
                if Date().timeIntervalSince(emptySince!) > 8 { NSApp.terminate(nil) }
            }
        } else {
            emptySince = nil
        }

        for s in sessions {
            let prev = lastCounts[s.pid] ?? 0
            let cur = s.joiners ?? 0
            if cur > prev {
                let name = s.names?.last.map { " (\($0))" } ?? ""
                notify("friend connected\(name) \u{00b7} \(s.code)")
            }
            lastCounts[s.pid] = cur
        }

        // avoid rebuilding the menu (and closing it under the cursor) when nothing changed
        let snapshot = sessions.map { "\($0.pid):\($0.code):\($0.joiners ?? 0):\(($0.names ?? []).joined(separator: ",")):\($0.tunnel ?? "-")" }.joined(separator: "|")
        if snapshot == lastSnapshot { return }
        lastSnapshot = snapshot

        statusItem.button?.title = sessions.isEmpty
            ? " idle"
            : " " + sessions.map { spaced($0.code) }.joined(separator: "  \u{00b7}  ")
        // globe once an anywhere link is live, terminal until then
        let anywhere = sessions.contains { $0.tunnel != nil }
        statusItem.button?.image = anywhere
            ? (symbol("globe") ?? symbol("terminal"))
            : (symbol("terminal.fill") ?? symbol("terminal"))
        buildMenu(sessions)
    }

    func addRow(_ menu: NSMenu, _ title: String, icon: String, action: Selector? = nil, payload: String? = nil) {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: "")
        if action != nil { item.target = self }
        item.representedObject = payload
        item.image = symbol(icon)
        menu.addItem(item)
    }

    func buildMenu(_ sessions: [SessionState]) {
        let menu = NSMenu()

        if sessions.isEmpty {
            let head = NSMenuItem(title: "", action: nil, keyEquivalent: "")
            let t = NSMutableAttributedString(
                string: "no active session\n",
                attributes: [.font: NSFont.systemFont(ofSize: 13, weight: .semibold), .foregroundColor: NSColor.labelColor])
            t.append(NSAttributedString(
                string: "run ccshare host to start one",
                attributes: [.font: NSFont.monospacedSystemFont(ofSize: 11, weight: .regular), .foregroundColor: NSColor.secondaryLabelColor]))
            head.attributedTitle = t
            menu.addItem(head)
        }

        for s in sessions {
            let dir = s.cwd.map { ($0 as NSString).lastPathComponent } ?? ""
            let head = NSMenuItem(title: "", action: nil, keyEquivalent: "")
            let t = NSMutableAttributedString(
                string: spaced(s.code) + "\n",
                attributes: [
                    .font: NSFont.monospacedSystemFont(ofSize: 22, weight: .bold),
                    .foregroundColor: accent,
                    .kern: 2.5,
                ])
            t.append(NSAttributedString(
                string: dir,
                attributes: [
                    .font: NSFont.monospacedSystemFont(ofSize: 11, weight: .regular),
                    .foregroundColor: NSColor.secondaryLabelColor,
                ]))
            head.attributedTitle = t
            menu.addItem(head)

            addRow(menu, "copy code", icon: "doc.on.doc", action: #selector(copyItem(_:)), payload: s.code)
            addRow(menu, "copy join command", icon: "arrow.right.doc.on.clipboard", action: #selector(copyItem(_:)), payload: "ccshare join \(s.code)")
            if let ip = s.ip, let port = s.port {
                addRow(menu, "copy direct join command", icon: "network", action: #selector(copyItem(_:)), payload: "ccshare join \(s.code) --host \(ip):\(port)")
            }
            if let t = s.tunnel {
                addRow(menu, "copy remote join command", icon: "globe", action: #selector(copyItem(_:)), payload: "ccshare join \(s.code) --host \(t)")
            }

            let n = s.joiners ?? 0
            let names = (s.names ?? []).joined(separator: ", ")
            if n == 0 {
                addRow(menu, "nobody connected yet", icon: "person")
            } else {
                addRow(menu, "\(n) connected\(names.isEmpty ? "" : ": \(names)")", icon: n > 1 ? "person.2.fill" : "person.fill")
            }
            menu.addItem(.separator())
        }

        let quit = NSMenuItem(title: "quit ccshare menu", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "")
        quit.target = NSApp
        quit.image = symbol("power")
        menu.addItem(quit)
        statusItem.menu = menu
    }

    @objc func copyItem(_ sender: NSMenuItem) {
        if let s = sender.representedObject as? String {
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(s, forType: .string)
        }
    }

    func applicationWillTerminate(_ n: Notification) {
        try? FileManager.default.removeItem(at: pidFile)
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let delegate = AppDelegate()
app.delegate = delegate
app.run()
