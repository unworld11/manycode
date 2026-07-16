import SwiftUI
import SwiftTerm

// SwiftTerm's NSView terminal hosted in SwiftUI. Bytes in via client.onOutput,
// keys out via the delegate straight onto the websocket.
struct TerminalWrapper: NSViewRepresentable {
    @ObservedObject var client: SessionClient

    func makeCoordinator() -> Coordinator { Coordinator(client: client) }

    func makeNSView(context: Context) -> TerminalView {
        let tv = TerminalView(frame: .zero)
        tv.terminalDelegate = context.coordinator
        tv.nativeBackgroundColor = NSColor(red: 0x0B / 255, green: 0x0D / 255, blue: 0x10 / 255, alpha: 1)
        tv.nativeForegroundColor = NSColor(red: 0xE8 / 255, green: 0xE4 / 255, blue: 0xDC / 255, alpha: 1)
        client.onOutput = { [weak tv] data in
            tv?.feed(byteArray: [UInt8](data)[...])
        }
        DispatchQueue.main.async {
            if let w = tv.window { w.makeFirstResponder(tv) }
        }
        return tv
    }

    func updateNSView(_ tv: TerminalView, context: Context) {}

    final class Coordinator: NSObject, TerminalViewDelegate {
        let client: SessionClient
        init(client: SessionClient) { self.client = client }

        func send(source: TerminalView, data: ArraySlice<UInt8>) {
            client.sendInput(data)
        }

        func sizeChanged(source: TerminalView, newCols: Int, newRows: Int) {
            client.sendResize(cols: newCols, rows: newRows)
        }

        func setTerminalTitle(source: TerminalView, title: String) {}
        func hostCurrentDirectoryUpdate(source: TerminalView, directory: String?) {}
        func scrolled(source: TerminalView, position: Double) {}
        func requestOpenLink(source: TerminalView, link: String, params: [String: String]) {
            if let url = URL(string: link) { NSWorkspace.shared.open(url) }
        }
        func bell(source: TerminalView) { NSSound.beep() }
        func clipboardCopy(source: TerminalView, content: Data) {
            if let s = String(data: content, encoding: .utf8) {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(s, forType: .string)
            }
        }
        func iTermContent(source: TerminalView, content: ArraySlice<UInt8>) {}
        func rangeChanged(source: TerminalView, startY: Int, endY: Int) {}
    }
}
