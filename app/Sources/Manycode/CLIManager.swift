import Foundation

// The app joins sessions on its own, but hosting drives the `manycode` CLI
// engine (the PTY wrapper). A downloaded .app has no install hook, so we
// bootstrap the engine on first launch: detect it, and install it with the
// same curl|sh the site documents, streaming progress.
enum CLIManager {
    // login shell so we see the user's real PATH (Homebrew, nvm), not the
    // stripped environment a Finder-launched app inherits
    private static func loginShell(_ cmd: String) -> (status: Int32, out: String) {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/zsh")
        p.arguments = ["-lc", cmd]
        let pipe = Pipe()
        p.standardOutput = pipe
        p.standardError = pipe
        p.standardInput = FileHandle.nullDevice
        do { try p.run() } catch { return (127, "") }
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        p.waitUntilExit()
        return (p.terminationStatus, String(data: data, encoding: .utf8) ?? "")
    }

    static func isInstalled() -> Bool {
        loginShell("command -v manycode").status == 0
    }

    static func installedVersion() -> String? {
        let r = loginShell("manycode version 2>/dev/null")
        return r.status == 0 ? r.out.trimmingCharacters(in: .whitespacesAndNewlines) : nil
    }

    // which prerequisites the installer needs are already present
    static func missingTools() -> [String] {
        ["git", "node", "npm"].filter { loginShell("command -v \($0)").status != 0 }
    }

    /// Run the installer, streaming its output line-by-line. Completion on main.
    static func install(onOutput: @escaping (String) -> Void, completion: @escaping (Bool) -> Void) {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/zsh")
        p.arguments = ["-lc", "curl -fsSL https://manycode.vercel.app/install.sh | sh"]
        let pipe = Pipe()
        p.standardOutput = pipe
        p.standardError = pipe
        p.standardInput = FileHandle.nullDevice
        pipe.fileHandleForReading.readabilityHandler = { h in
            let d = h.availableData
            guard !d.isEmpty, let s = String(data: d, encoding: .utf8) else { return }
            DispatchQueue.main.async { onOutput(s) }
        }
        p.terminationHandler = { proc in
            pipe.fileHandleForReading.readabilityHandler = nil
            DispatchQueue.main.async { completion(proc.terminationStatus == 0) }
        }
        do { try p.run() } catch {
            DispatchQueue.main.async { completion(false) }
        }
    }
}
