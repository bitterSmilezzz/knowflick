// swift-tools-version:6.0
import PackageDescription

let package = Package(
    name: "KnowFlick",
    platforms: [
        .macOS(.v14)
    ],
    targets: [
        .target(
            name: "KnowFlickCore",
            path: "Sources/KnowFlickCore",
            resources: [
                .process("Resources")
            ]
        ),
        .executableTarget(
            name: "KnowFlick",
            dependencies: ["KnowFlickCore"],
            path: "Sources/KnowFlick"
        ),
        .testTarget(
            name: "KnowFlickCoreTests",
            dependencies: ["KnowFlickCore"],
            path: "Tests/KnowFlickCoreTests"
        )
    ],
    swiftLanguageModes: [.v5]
)
