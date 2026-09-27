# macOS 本机工具链调查（2026-09-27）

> 结论先行：**本机只装了 Command Line Tools 27.0，无法编译任何 SwiftUI App**。这不是项目代码问题，
> 换到干净的 git HEAD 同样失败。验证构建请走 GitHub Actions（`.github/workflows/macos.yml`，runner 自带完整 Xcode），
> 或在本机安装完整 Xcode 后 `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`。

## 现象

`swift build` 报大量：

```
error: external macro implementation type 'SwiftUIMacros.StateMacro' could not be found for macro 'State()';
       plugin for module 'SwiftUIMacros' not found
```

连带 `@State` 未展开产生的一串「cannot assign to property: 'self' is immutable」等派生错误。

## 排查过程与三个独立原因

1. **`_archived/` 归档目录被 SwiftPM 编译**（项目侧问题，已修）：
   `CardView.swift` / `CardDeckView.swift` 移入 `Sources/KnowFlick/Views/_archived/` 后仍会被
   target 收录。已在 `apps/mac/Package.swift` 的 executable target 加 `exclude: ["Views/_archived"]`。

2. **CLT 27.0 的工具链宏插件 dylib 缺 LC_RPATH**（系统侧问题）：
   `otool -L /Library/Developer/CommandLineTools/usr/lib/swift/host/plugins/libSwiftMacros.dylib`
   依赖 `@rpath/libSwiftSyntaxMacros.dylib`，但该 dylib **没有任何 LC_RPATH**，dlopen 报
   `Library not loaded: @rpath/libSwiftSyntaxMacros.dylib — Reason: no LC_RPATH's found`。
   9 月中旬的 macOS 27.0 小版本更新（26A425 → 26A428）后 dyld 不再宽容这种情况。
   `DYLD_FALLBACK_LIBRARY_PATH` 对 swift-frontend 无效——Apple 平台二进制会剥离全部 `DYLD_*` 环境变量（已实测）。

3. **`SwiftUIMacros` 插件只随完整 Xcode 分发**（根因）：
   SwiftUI 的 `@State` 等包装器自 macOS 26 / Swift 6.4 起变为宏，
   `#externalMacro(module: "SwiftUIMacros", ...)`。全机搜索确认 `libSwiftUIMacros.dylib`
   **不存在于** CLT、macOS 27.0 SDK、系统框架，也不存在于 swift.org 的
   swift-6.4.0-RELEASE 工具链（已下载解包验证）——它只随 Xcode.app 分发且不开源
   （社区佐证：[Swift 6.4 build failures with CLT](https://github.com/drumih/turbo-fieldfare/issues/185)、
   [SwiftUI State Macro Investigation](https://muukii.github.io/astro/posts/swiftui-state-macro-investigation-edfc3957/)）。
   这正是 `macos.yml` 头注释「本地只有 CommandLineTools 时 SwiftUI 宏无法展开」的完整版故事。

## 本机能做与不能做

- ✅ `swiftc -parse` 全量语法检查（无需 SDK）
- ✅ **KnowFlickCore 整模块 typecheck / KnowFlickCoreTests 测试目标编译**：Core 只依赖工具链自带的
  `libObservationMacros.dylib`（swift.org 工具链的插件 rpath 正常），绕开了缺失的 SwiftUI 宏。
  2026-09-28 实测：Core 37 文件 + 全部测试代码以 `-swift-version 6` 严格并发**整模块编译通过**；
  注意 `swift test` 默认会连带构建 app 可执行目标而失败，需先 `swift build --target KnowFlickCoreTests`
  再 `swift test --skip-build`；测试执行进程在本机有挂起现象（CI 环境正常），执行结果以 CI 为准：
  ```bash
  TC=~/Downloads/knowflick-toolchain/extracted/swift-6.4.0-RELEASE-osx-package.pkg/Payload
  # 整模块严格并发 typecheck（Core 全部 37 文件）
  $TC/usr/bin/swiftc -typecheck -swift-version 6 \
    -sdk /Library/Developer/CommandLineTools/SDKs/MacOSX27.0.sdk \
    apps/mac/Sources/KnowFlickCore/**/*.swift
  # Core 单测（测试目标不依赖 SwiftUI app target，不会触宏缺失）
  SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX27.0.sdk \
    $TC/usr/bin/swift test --scratch-path /tmp/kf-test-build   # 在 apps/mac 下执行
  ```
- ❌ `swift build` / app target 编译（`@State` 等 SwiftUI 宏展开失败，触到 KnowFlick target 即失败）
- ✅ 完整 app 构建 + 全量验证：推送 main 由 CI 完成；本机验证需装 Xcode 26+

## 本机遗留的临时文件

- `~/Downloads/knowflick-toolchain/`：swift-6.4.0-RELEASE-osx.pkg（1.5 GB）及其解包目录，
  调查用，确认不含 SwiftUIMacros 后可删除。
