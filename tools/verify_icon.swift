import Foundation
import ImageIO
import CoreGraphics

// Decode every icon representation and compare the largest to the checked-in artwork.
func source(_ path: String) -> CGImageSource {
    guard let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil) else {
        fatalError("Cannot decode icon: \(path)")
    }
    return source
}
func pixels(_ image: CGImage) -> Data {
    let context = CGContext(data: nil, width: image.width, height: image.height,
        bitsPerComponent: 8, bytesPerRow: image.width * 4,
        space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
    return Data(bytes: context.data!, count: image.width * image.height * 4)
}
guard CommandLine.arguments.count == 3 else { fatalError("Usage: verify_icon.swift icon.icns artwork.png") }
let icon = source(CommandLine.arguments[1])
let artwork = source(CommandLine.arguments[2])
var sizes = Set<Int>()
var largest: CGImage?
for index in 0..<CGImageSourceGetCount(icon) {
    guard let image = CGImageSourceCreateImageAtIndex(icon, index, nil), image.width == image.height else {
        fatalError("Invalid icon representation \(index)")
    }
    sizes.insert(image.width)
    if image.width == 1024 { largest = image }
}
guard Set([16, 32, 64, 128, 256, 512, 1024]).isSubset(of: sizes),
      let largest, let reference = CGImageSourceCreateImageAtIndex(artwork, 0, nil),
      reference.width == 1024, reference.height == 1024,
      pixels(largest) == pixels(reference) else {
    fatalError("Icon sizes are missing or ICNS does not match AppIcon.png")
}
print("Icon verified: all sizes decode; 1024px artwork matches ICNS")
