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
        // app 层（视图目标）测试：只放不依赖窗口/渲染循环的纯逻辑用例（路由枚举等）。
        // 本目标依赖执行文件，需要完整 Xcode（CI 的 macos-15 runner 与本地 Xcode 均满足）；
        // `./tools/test.sh --core-only` 只构建 Core 测试目标，不受影响。
        .testTarget(
            name: "KnowFlickAppTests",
            dependencies: ["KnowFlick"],
            path: "Tests/KnowFlickAppTests",
            swiftSettings: [
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
