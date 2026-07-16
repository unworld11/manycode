import Foundation

// Hosting from the app spawns the installed CLI engine headless in the picked
// folder, waits for its state file, and the app joins its own session on
// localhost - one protocol, one engine, every other client stays compatible.
enum HostLauncher {
    enum HostError: LocalizedError {
        case cliMissing
        case timedOut
        var errorDescription: String? {
            switch self {
            case .cliMissing: return "the manycode CLI isn't installed - run the installer from manycode.vercel.app first"
            case .timedOut: return "the session didn't start in time - try `manycode host` in a terminal to see why"
            }
        }
    }

    static func startHost(in folder: URL, completion: @escaping (Result<LocalSession, Error>) -> Void) {
        let before = Set(Discovery.localSessions().map(\.pid))
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/zsh")
        // login shell so the installed `manycode` is on PATH even when the app
        // wasn't launched from a terminal
        p.arguments = ["-lc", "command -v manycode >/dev/null || exit 127; exec manycode host --no-menubar"]
        p.currentDirectoryURL = folder
        p.standardInput = FileHandle.nullDevice
        p.standardOutput = FileHandle.nullDevice
        p.standardError = FileHandle.nullDevice
        do { try p.run() } catch {
            return completion(.failure(error))
        }

        let deadline = Date().addingTimeInterval(12)
        func poll() {
            if !p.isRunning && p.terminationStatus == 127 {
                return completion(.failure(HostError.cliMissing))
            }
            if let s = Discovery.localSessions().first(where: { !before.contains($0.pid) && $0.cwd == folder.path }) {
                return completion(.success(s))
            }
            if Date() > deadline {
                p.terminate()
                return completion(.failure(HostError.timedOut))
            }
            DispatchQueue.global().asyncAfter(deadline: .now() + 0.4) { poll() }
        }
        DispatchQueue.global().asyncAfter(deadline: .now() + 0.6) { poll() }
    }

    static func endSession(_ s: LocalSession) {
        kill(s.pid, SIGTERM)
    }
}
