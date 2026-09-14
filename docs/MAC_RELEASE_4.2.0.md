# macOS 4.2.0 发布记录

日期：2026-09-14。本版修复了一个**已随 v3.2.0 发布出去**的启动崩溃，并把仓库调整为多端布局。

## 交付

`KnowFlick-4.2.0.app.zip` 与其 `.sha256` 校验和作为附件附在本版 Release 上（`dist/` 不入 Git）。
本机为纯 SwiftPM 工程，本地无完整 Xcode，产物由云端 macOS runner 构建。

## 核心缺陷：产物启动即崩

### 现象

双击 `KnowFlick.app` 立即退出，报：

```text
Fatal error: could not load resource bundle: from
  <app>/Contents/…/KnowFlick_KnowFlickCore.bundle
  or <repo>/.build/arm64-apple-macosx/release/KnowFlick_KnowFlickCore.bundle
```

崩溃栈（系统崩溃报告）：

```text
libswiftCore.dylib   _assertionFailure(_:_:file:line:flags:)
KnowFlick            closure #1 in variable initialization expression of static NSBundle.module
KnowFlick            one-time initialization function for module
KnowFlick            specialized AppStore.loadSeedCards()
KnowFlick            AppStore.bootstrap()
```

### 影响范围

**已发布的 v3.2.0 同样受影响**。Release 上的 `KnowFlick.app.zip` 与本地 9-11 打包产物
字节完全相同（sha256 `b9dab50557fc0a1a909132f01cb2c38e826e8f9e6cc20dfdcfeffdc4c84bdecc`），
下载后启动即崩。也就是说，所有从 Release 下载 v3.2.0 的用户都拿不到能用的 App。

缺陷能长期潜伏，是因为编译、签名、资源复制全部通过，只有真正启动才暴露。

### 根因

SwiftPM 生成的 `resource_bundle_accessor` 在不同工具链下探测资源 bundle 的候选路径不同：

| 工具链 | 候选路径 | `Contents/Resources` 布局下 |
| --- | --- | --- |
| CommandLineTools 27 | `Bundle.main.resourceURL` → `bundleURL` | 能找到 |
| Xcode 26.3 | `Bundle.main.bundleURL` → 编译期 `.build` 路径 | **找不到，直接 fatalError** |

本机打包用 CLT、云端用 Xcode，两边的候选列表不同，于是「本地能跑、发布出去崩溃」。

### 修复

在 `apps/mac/Sources/KnowFlickCore/Support/CoreResources.swift` 里自行按候选列表查找，
依次尝试 `Bundle.main.resourceURL`、`Bundle.main.bundleURL`、framework 资源目录，
两个工具链的产物都能命中；找不到时回退 `Bundle.module`，报错信息与原先一致。

**资源 bundle 的位置不能改**：放到 `.app` 根目录虽能被 Xcode 产物找到，却会破坏代码签名
（实测 `unsealed contents present in the bundle root`，`codesign --verify` 失败）。

### 防复发

`build_app.sh` 与 CI 都补上启动自检：实跑一次二进制，出现 `could not load resource bundle`
即判失败。只匹配这一条致命错误，避免把无 GUI 会话下的正常退出误判为失败。

## 仓库结构：多端布局

为 Windows 与浏览器插件端做准备，仓库从「mac 占根目录」调整为「`apps/` 各端 + `shared/` 共享」：

- mac 端移入 `apps/mac`，android 端移入 `apps/android`，构建产物统一收敛到根 `dist/`。
- 种子卡与 42 张分类底图提取到 `shared/assets` 作为唯一事实来源。迁移前两端各存一份副本，
  逐字节比对确认完全一致后才删重复项。
- mac 侧由 `tools/sync_shared_assets.sh` 把共享资产同步进 SwiftPM 资源目录
  （不用符号链接：跨 target 的软链在 SwiftPM 下不可靠）；android 侧用 `assets.srcDirs` 指向共享目录。
- 底图统一为 WebP，两端共用同一份文件。

## 版本号整理

mac 端的版本号曾被 Android 开发借用：CHANGELOG 中 `v4.1.1`–`v4.1.8` 这 8 条的内容其实都是
Android 里程碑（M1–M7），对应 tag 为 `android-v0.1.0`–`v0.7.0`。这 8 条已更名为对应的 android
版本号，android 序列现为 `android-v0.1.0` → `android-v0.8.4` 连续排列。mac 端自 4.2.0 继续，
两端版本号自此互不相干。规则见 [多端协作规范](MULTI_PLATFORM.md)。

## 验证

| 项目 | 结果 |
| --- | --- |
| Swift 测试 | 175 项通过（26 个 suite） |
| 代码签名 | `codesign --verify --deep --strict` 通过（adhoc） |
| 资源完整性 | 214 张种子卡 + 42 张底图 |
| 启动自检 | 实际启动并持续运行，无资源 bundle 错误 |
| Info.plist 版本 | 4.2.0（与 `AppVersion.swift` 一致） |

产物本身还做过独立复核：从 CI 下载 artifact 后解压，比对 `.sha256` 一致，双击启动后进程持续
驻留（非仅通过 CI 自检）。

## 环境说明

本机只有 CommandLineTools（无完整 Xcode），UI 层无法本地编译——SwiftUI 宏的实现
`libSwiftUIMacros.dylib` 只在完整 Xcode 中提供。因此：

- Core 测试本地可跑：`./tools/test.sh --core-only`（175 项）
- UI 层与完整 `.app` 的构建验证交给 [macOS workflow](../.github/workflows/macos.yml)

打包产物必须用完整 Xcode 构建——这正是本版修复的缺陷得以暴露的原因。
