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
                // Core 以值类型 + @MainActor 为主，先行迁移到 Swift 6 严格并发；App 层维持 v5
                .swiftLanguageMode(.v6)
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
            path: "Tests/KnowFlickCoreTests",
            swiftSettings: [
                .swiftLanguageMode(.v6)
            ]
        )
    ],
    swiftLanguageModes: [.v5]
)
