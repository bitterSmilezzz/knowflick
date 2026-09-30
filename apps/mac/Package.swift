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
            ],
            swiftSettings: [
                // Swift 6 严格并发（v3.8.0 起 Core 先行，v4.0.0 起全包迁移）
                .swiftLanguageMode(.v6)
            ]
        ),
        .executableTarget(
            name: "KnowFlick",
            dependencies: ["KnowFlickCore"],
            path: "Sources/KnowFlick",
            swiftSettings: [
                // Swift 6 严格并发（v4.0.0 起与 Core 一致）
                .swiftLanguageMode(.v6)
            ]
        ),
        .testTarget(
            name: "KnowFlickCoreTests",
            dependencies: ["KnowFlickCore"],
            path: "Tests/KnowFlickCoreTests",
            swiftSettings: [
                .swiftLanguageMode(.v6)
            ]
        )
    ],
    swiftLanguageModes: [.v5]
)
