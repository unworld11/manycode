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

    let font = NSFont.monospacedSystemFont(ofSize: size * 0.60, weight: .bold)
    let glyph = NSAttributedString(string: "$", attributes: [
        .font: font,
        .foregroundColor: NSColor(red: 0x5E / 255, green: 0xE3 / 255, blue: 0x8A / 255, alpha: 1),
    ])
    let gs = glyph.size()
    glyph.draw(at: NSPoint(x: (size - gs.width) / 2, y: (size - gs.height) / 2 + size * 0.01))

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
