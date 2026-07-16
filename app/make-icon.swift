import AppKit

// Renders the app icon (green $ on dark rounded square, matching the site
// favicon) at every iconset size, into Manycode.iconset/ for iconutil.

func render(_ px: Int) -> Data? {
    guard let rep = NSBitmapImageRep(
        bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px,
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
        colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0) else { return nil }
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    let size = CGFloat(px)

    let inset = size * 0.06
    let rect = NSRect(x: inset, y: inset, width: size - inset * 2, height: size - inset * 2)
    let path = NSBezierPath(roundedRect: rect, xRadius: size * 0.22, yRadius: size * 0.22)
    NSColor(red: 0x0B / 255, green: 0x0D / 255, blue: 0x10 / 255, alpha: 1).setFill()
    path.fill()

    // three stacked terminal cursors (many people, one live terminal)
    func col(_ hex: UInt32) -> NSColor {
        NSColor(red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255, blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
    }
    let bw = size * 0.145, bh = size * 0.42, off = size * 0.11, r = size * 0.035
    let total = bw + off * 2
    let x0 = (size - total) / 2, y0 = (size - bh) / 2
    for (k, hex) in [0x2F7D52, 0x43A86B, 0x5EE38A].enumerated() {
        col(UInt32(hex)).setFill()
        NSBezierPath(roundedRect: NSRect(x: x0 + CGFloat(k) * off, y: y0, width: bw, height: bh), xRadius: r, yRadius: r).fill()
    }

    NSGraphicsContext.restoreGraphicsState()
    return rep.representation(using: .png, properties: [:])
}

let sizes: [(String, Int)] = [
    ("icon_16x16", 16), ("icon_16x16@2x", 32),
    ("icon_32x32", 32), ("icon_32x32@2x", 64),
    ("icon_128x128", 128), ("icon_128x128@2x", 256),
    ("icon_256x256", 256), ("icon_256x256@2x", 512),
    ("icon_512x512", 512), ("icon_512x512@2x", 1024),
]

let dir = "Manycode.iconset"
try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
for (name, px) in sizes {
    if let data = render(px) {
        try? data.write(to: URL(fileURLWithPath: "\(dir)/\(name).png"))
        print("wrote \(name).png")
    }
}
