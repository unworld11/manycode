import AppKit
import Foundation

// manycode menu bar helper. Shows active session codes from
// ~/.manycode/sessions/*.json, copies join commands, notifies on joins.
// Launched by `manycode host` with --auto (exits when no sessions remain)
// or by `manycode menubar` without it (stays until quit).

let home = FileManager.default.homeDirectoryForCurrentUser
let stateDir = home.appendingPathComponent(".manycode/sessions")
let pidFile = home.appendingPathComponent(".manycode/menubar.pid")

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
    let tunnelOpening: Bool?
    let browser: String?
    let cmd: String?
    let readOnly: Bool?
    let recording: String?
}

let accent = NSColor(calibratedRed: 0x5E / 255.0, green: 0xE3 / 255.0, blue: 0x8A / 255.0, alpha: 1)

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
    p.arguments = ["-e", "display notification \"\(esc)\" with title \"manycode\""]
    try? p.run()
}

class AppDelegate: NSObject, NSApplicationDelegate {
    var statusItem: NSStatusItem!
    var timer: Timer?
    var lastCounts: [Int32: Int] = [:]
    var lastNames: [Int32: [String]] = [:]
    var lastSnapshot = "\u{0}"
    var emptySince: Date? = nil
    var flashUntil: Date? = nil
    // pids where we clicked "open anywhere link" - drives the ready/failed
    // notifications; the loading row itself follows the host's tunnelOpening
    var tunnelAsked: [Int32: Date] = [:]
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
            let names = s.names ?? []
            if cur > prev {
                let name = s.names?.last.map { " (\($0))" } ?? ""
                notify("friend connected\(name) \u{00b7} \(s.code)")
            } else if cur < prev {
                // whoever is in the old roster but not the new one left
                let old = lastNames[s.pid] ?? []
                var remaining = names
                var gone: [String] = []
                for n in old {
                    if let i = remaining.firstIndex(of: n) { remaining.remove(at: i) } else { gone.append(n) }
                }
                let who = gone.isEmpty ? "a friend" : gone.joined(separator: ", ")
                notify("\(who) left \u{00b7} \(s.code)")
            }
            lastCounts[s.pid] = cur
            lastNames[s.pid] = names

            // close the loop on "open anywhere link" clicks
            if let asked = tunnelAsked[s.pid] {
                if s.tunnel != nil {
                    tunnelAsked.removeValue(forKey: s.pid)
                    notify("anywhere link is ready \u{00b7} \(s.code)")
                } else if Date().timeIntervalSince(asked) > 90 {
                    tunnelAsked.removeValue(forKey: s.pid)
                    notify("anywhere link didn't come up \u{00b7} \(s.code) - check the host terminal")
                }
            }
        }
        tunnelAsked = tunnelAsked.filter { pid, _ in sessions.contains { $0.pid == pid } }

        // don't stomp the "copied ✓" flash mid-display
        if let f = flashUntil, Date() < f { return }
        flashUntil = nil

        // avoid rebuilding the menu (and closing it under the cursor) when nothing changed
        let snapshot = sessions.map { "\($0.pid):\($0.code):\($0.joiners ?? 0):\(($0.names ?? []).joined(separator: ",")):\($0.tunnel ?? "-"):\($0.tunnelOpening ?? false):\($0.browser ?? "-"):\($0.recording ?? "-"):\($0.readOnly ?? false)" }.joined(separator: "|")
            + ":asked=\(tunnelAsked.keys.sorted())"
        if snapshot == lastSnapshot { return }
        lastSnapshot = snapshot

        statusItem.button?.title = sessions.isEmpty
            ? " idle"
            : " " + sessions.map { s -> String in
                let n = s.joiners ?? 0
                return spaced(s.code) + (n > 0 ? " \u{00b7}\(n)" : "")
              }.joined(separator: "   ")
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
                string: "run manycode host to start one",
                attributes: [.font: NSFont.monospacedSystemFont(ofSize: 11, weight: .regular), .foregroundColor: NSColor.secondaryLabelColor]))
            head.attributedTitle = t
            menu.addItem(head)
        }

        for s in sessions {
            var dir = s.cwd.map { ($0 as NSString).lastPathComponent } ?? ""
            if let c = s.cmd, c != "claude" { dir += " \u{00b7} \(c)" }
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
            addRow(menu, "copy join command", icon: "arrow.right.doc.on.clipboard", action: #selector(copyItem(_:)), payload: "manycode join \(s.code)")
            if let ip = s.ip, let port = s.port {
                addRow(menu, "copy direct join command", icon: "network", action: #selector(copyItem(_:)), payload: "manycode join \(s.code) --host \(ip):\(port)")
            }
            if let t = s.tunnel {
                addRow(menu, "copy anywhere join command", icon: "globe", action: #selector(copyItem(_:)), payload: "manycode join \(s.code) --host \(t)")
                addRow(menu, "copy anywhere terminal link", icon: "link", action: #selector(copyItem(_:)), payload: t)
            } else if s.tunnelOpening == true || tunnelAsked[s.pid] != nil {
                addRow(menu, "opening anywhere link\u{2026}", icon: "hourglass")
            } else {
                // same mechanism as `manycode tunnel`: drop a request file, the
                // host picks it up within a couple of seconds
                addRow(menu, "open anywhere link\u{2026}", icon: "globe", action: #selector(openTunnel(_:)), payload: String(s.pid))
            }
            if let b = s.browser {
                addRow(menu, "copy browser link", icon: "safari", action: #selector(copyItem(_:)), payload: b)
            }

            let n = s.joiners ?? 0
            let names = (s.names ?? []).joined(separator: ", ")
            if n == 0 {
                addRow(menu, "nobody connected yet", icon: "person")
            } else {
                addRow(menu, "\(n) connected\(names.isEmpty ? "" : ": \(names)")", icon: n > 1 ? "person.2.fill" : "person.fill")
            }
            if s.readOnly == true {
                addRow(menu, "view-only session", icon: "eye")
            }
            if let r = s.recording {
                addRow(menu, "recording \u{00b7} \((r as NSString).lastPathComponent)", icon: "record.circle")
            }
            addRow(menu, "end session", icon: "xmark.circle", action: #selector(endSession(_:)), payload: String(s.pid))
            menu.addItem(.separator())
        }

        let quit = NSMenuItem(title: "quit manycode menu", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "")
        quit.target = NSApp
        quit.image = symbol("power")
        menu.addItem(quit)
        statusItem.menu = menu
    }

    @objc func copyItem(_ sender: NSMenuItem) {
        if let s = sender.representedObject as? String {
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(s, forType: .string)
            flash("copied \u{2713}")
        }
    }

    @objc func openTunnel(_ sender: NSMenuItem) {
        guard let s = sender.representedObject as? String, let pid = Int32(s) else { return }
        let req = stateDir.appendingPathComponent("\(s).tunnel-request")
        try? Data().write(to: req)
        // show the loading row right away; the host's tunnelOpening flag takes
        // over once it picks the request up (within ~2s)
        tunnelAsked[pid] = Date()
        flash("opening\u{2026}")
    }

    @objc func endSession(_ sender: NSMenuItem) {
        guard let s = sender.representedObject as? String, let pid = Int32(s) else { return }
        kill(pid, SIGTERM)
        flash("ended")
    }

    // brief status-bar feedback so a click visibly did something
    func flash(_ text: String) {
        statusItem.button?.title = " \(text)"
        flashUntil = Date().addingTimeInterval(0.9)
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
            self.flashUntil = nil
            self.lastSnapshot = "\u{0}" // force the next refresh to redraw
            self.refresh()
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
