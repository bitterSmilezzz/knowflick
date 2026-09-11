import AppKit

// Package image artwork into macOS icon slots with a true alpha rounded-square mask.
let args = CommandLine.arguments
guard args.count == 3, let source = NSImage(contentsOfFile: args[1]) else {
    fatalError("Usage: swift tools/build_icon.swift artwork.png output-directory")
}
let output = URL(fileURLWithPath: args[2], isDirectory: true)
try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
let iconset = output.appendingPathComponent("AppIcon.iconset", isDirectory: true)
try FileManager.default.createDirectory(at: iconset, withIntermediateDirectories: true)
func render(_ size: Int) throws -> Data {
    let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size,
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
        colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
    NSGraphicsContext.current?.imageInterpolation = .high
    let rect = NSRect(x: 0, y: 0, width: size, height: size)
    NSBezierPath(roundedRect: rect, xRadius: CGFloat(size) * 0.26, yRadius: CGFloat(size) * 0.26).addClip()
    source.draw(in: rect, from: .zero, operation: .copy, fraction: 1)
    NSGraphicsContext.restoreGraphicsState()
    return bitmap.representation(using: .png, properties: [:])!
}
try render(1024).write(to: output.appendingPathComponent("AppIcon.png"))
for size in [16, 32, 128, 256, 512] {
    try render(size).write(to: iconset.appendingPathComponent("icon_\(size)x\(size).png"))
    try render(size * 2).write(to: iconset.appendingPathComponent("icon_\(size)x\(size)@2x.png"))
}

// 打包为标准 ICNS（macOS 应用实际加载的格式；此前 iconutil 是漏掉的手工步骤）
let icnsProcess = Process()
icnsProcess.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
icnsProcess.arguments = ["-c", "icns", iconset.path, "-o", output.appendingPathComponent("AppIcon.icns").path]
try icnsProcess.run()
icnsProcess.waitUntilExit()
guard icnsProcess.terminationStatus == 0 else {
    fatalError("iconutil 打包失败（退出码 \(icnsProcess.terminationStatus)）")
}
print("已生成 \(output.appendingPathComponent("AppIcon.icns").path)")
