import Foundation
import CryptoKit

// Finding sessions: local ones come from ~/.manycode/sessions state files
// (same files the menu bar reads), LAN ones from the UDP broadcast protocol
// the CLI uses - probes carry a sha256 prefix of the code, never the code.

struct LocalSession: Identifiable, Equatable {
    var id: Int32 { pid }
    let pid: Int32
    let code: String
    let port: Int
    let cwd: String
    let cmd: String
    let names: [String]
    let browser: String?
    let ip: String?
    let tunnel: String?
    let recording: String?

    var dirName: String { (cwd as NSString).lastPathComponent }
    var spacedCode: String {
        guard code.count > 3 else { return code }
        let mid = code.index(code.startIndex, offsetBy: code.count / 2)
        return "\(code[..<mid]) \(code[mid...])"
    }
}

enum Discovery {
    static var stateDir: URL {
        let home = FileManager.default.homeDirectoryForCurrentUser
        let new = home.appendingPathComponent(".manycode/sessions")
        if FileManager.default.fileExists(atPath: new.path) { return new }
        return home.appendingPathComponent(".ccshare/sessions")
    }

    static func configName() -> String {
        let home = FileManager.default.homeDirectoryForCurrentUser
        for dir in [".manycode", ".ccshare"] {
            let f = home.appendingPathComponent("\(dir)/config.json")
            if let data = try? Data(contentsOf: f),
               let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let name = obj["name"] as? String, !name.isEmpty {
                return name
            }
        }
        return NSUserName()
    }

    static func localSessions() -> [LocalSession] {
        guard let files = try? FileManager.default.contentsOfDirectory(at: stateDir, includingPropertiesForKeys: nil) else { return [] }
        var out: [LocalSession] = []
        for f in files where f.pathExtension == "json" {
            guard let data = try? Data(contentsOf: f),
                  let m = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let pid = m["pid"] as? Int32 ?? (m["pid"] as? Int).map(Int32.init),
                  let code = m["code"] as? String,
                  let port = m["port"] as? Int else { continue }
            guard kill(pid, 0) == 0 else { continue } // dead session, the CLI sweeps it
            out.append(LocalSession(
                pid: pid,
                code: code,
                port: port,
                cwd: (m["cwd"] as? String) ?? "",
                cmd: (m["cmd"] as? String) ?? "claude",
                names: (m["names"] as? [String]) ?? [],
                browser: m["browser"] as? String,
                ip: m["ip"] as? String,
                tunnel: m["tunnel"] as? String,
                recording: m["recording"] as? String))
        }
        return out.sorted { $0.pid < $1.pid }
    }

    static func hash16(_ code: String) -> String {
        let digest = SHA256.hash(data: Data(code.uppercased().utf8))
        return digest.map { String(format: "%02x", $0) }.joined().prefix(16).lowercased()
    }

    /// Broadcast probes until a host with this code answers. Blocking - run off main.
    static func discoverLAN(code: String, timeout: TimeInterval = 3.5) -> (host: String, port: Int)? {
        let h = hash16(code)
        let fd = socket(AF_INET, SOCK_DGRAM, 0)
        guard fd >= 0 else { return nil }
        defer { close(fd) }
        var yes: Int32 = 1
        setsockopt(fd, SOL_SOCKET, SO_BROADCAST, &yes, socklen_t(MemoryLayout<Int32>.size))
        var tv = timeval(tv_sec: 0, tv_usec: 300_000)
        setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))

        var dest = sockaddr_in()
        dest.sin_family = sa_family_t(AF_INET)
        dest.sin_port = in_port_t(UInt16(42517).bigEndian)
        dest.sin_addr.s_addr = INADDR_BROADCAST

        let probe = Data("{\"t\":\"discover\",\"h\":\"\(h)\"}".utf8)
        let deadline = Date().addingTimeInterval(timeout)
        var lastSend = Date.distantPast

        while Date() < deadline {
            if Date().timeIntervalSince(lastSend) > 0.6 {
                lastSend = Date()
                probe.withUnsafeBytes { raw in
                    withUnsafePointer(to: &dest) { ptr in
                        ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sa in
                            _ = sendto(fd, raw.baseAddress, probe.count, 0, sa, socklen_t(MemoryLayout<sockaddr_in>.size))
                        }
                    }
                }
            }
            var buf = [UInt8](repeating: 0, count: 512)
            var from = sockaddr_in()
            var fromLen = socklen_t(MemoryLayout<sockaddr_in>.size)
            let n = withUnsafeMutablePointer(to: &from) { ptr in
                ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sa in
                    recvfrom(fd, &buf, buf.count, 0, sa, &fromLen)
                }
            }
            guard n > 0 else { continue }
            guard let m = try? JSONSerialization.jsonObject(with: Data(buf[0..<n])) as? [String: Any],
                  (m["t"] as? String) == "here", (m["h"] as? String) == h,
                  let port = m["port"] as? Int else { continue }
            var addr = from.sin_addr
            var str = [CChar](repeating: 0, count: Int(INET_ADDRSTRLEN))
            inet_ntop(AF_INET, &addr, &str, socklen_t(INET_ADDRSTRLEN))
            return (String(cString: str), port)
        }
        return nil
    }
}
