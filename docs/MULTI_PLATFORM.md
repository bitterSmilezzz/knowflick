# 多端仓库结构与协作规范

本仓库同时承载 KnowFlick 的多个端。各端独立开发、按小版本汇总回 `main`。

## 目录结构

```text
KnowFlick/
├── apps/                    # 各端应用（互不依赖，各自独立构建）
│   ├── mac/                 # macOS 端（SwiftPM + SwiftUI）
│   │   ├── Package.swift
│   │   ├── Sources/
│   │   ├── Tests/
│   │   ├── Resources/       # 应用图标等仅 mac 使用的资源
│   │   └── build_app.sh
│   ├── android/             # Android 端（Gradle + Compose）
│   └── <windows|extension>/ # 待创建
├── shared/                  # 跨端共享内容（单一事实来源）
│   └── assets/
│       ├── taxonomy_map.json # 学科契约
│       └── bg/*.webp        # 42 张分类底图
├── tools/                   # 跨端脚本（构建、图标校验、内容导入）
├── docs/                    # 跨端文档与各端发布记录
├── dist/                    # 构建产物（不入 Git）
├── CHANGELOG.md             # 各端更新日志
├── CONTEXT.md               # 领域上下文
└── README.md
```

新增端时在 `apps/` 下建同名目录，不要往仓库根目录放源码。

## 共享资产

`shared/assets/` 是底图与学科契约的**唯一事实来源**。两端当前通过不同机制引用同一份文件：

| 端 | 引用方式 | 说明 |
| --- | --- | --- |
| mac | `tools/sync_shared_assets.sh` 把 `shared/assets` 同步进 `apps/mac/Sources/KnowFlickCore/Resources/` | 该目录不入 Git（仅留 `.gitkeep`）。不用符号链接：跨 target 的软链在 SwiftPM 下不可靠 |
| android | `app/build.gradle.kts` 的 `sourceSets["main"].assets.srcDirs("../../../shared/assets")` | Gradle 直接读取该目录 |

**不要**在 `apps/*/` 下留副本——迁移前 mac 与 android 各存一份 42 张底图（6.35 MB ×2）和内容库，靠人工同步保持一致，一旦漂移会导致两端内容不一致且难以察觉。

> 2026-10 更新：预置内容库（`seed_cards.json` 214 张）已从仓库移除，知识内容改由用户剪藏/导入产出，
> 不再是跨端共享资产；`shared/assets/` 现在只剩底图与 `taxonomy_map.json` 学科契约。

改动共享资产后必须同时验证两端：

```sh
# mac：确认资源进了 bundle
cd apps/mac && swift build --target KnowFlickCore
ls .build/out/Products/Debug/KnowFlick_KnowFlickCore.bundle/Contents/Resources/ | head

# android：确认资源进了 APK
cd apps/android && ./gradlew :app:assembleDebug
unzip -l app/build/outputs/apk/debug/app-debug.apk | grep "assets/bg/.*\.webp" | head
```

底图统一用 **WebP**（mac 端自 macOS 11 起原生支持解码，两条加载路径 `NSImage(contentsOf:)` 与 ImageIO 缩略图均已验证）。同画质下体积约为 JPEG 的三分之一。

## 分支模型

采用**短特性分支 + main 汇总**：`main` 始终是多端汇总分支，且保持可构建、可发布。

| 用途 | 命名 | 示例 |
| --- | --- | --- |
| 新增功能 | `<端>/<功能>` | `android/swipe-haptic`、`win/initial-scaffold` |
| 缺陷修复 | `fix/<端>-<问题>` | `fix/android-refresh-stale` |
| 跨端改动 | `chore/<主题>` | `chore/multi-platform-layout` |
| 文档 | `docs/<主题>` | `docs/android-release` |

端名统一用 `mac` / `wind` / `android` / `ext`。

规则：

- 分支从最新 `main` 切出，完成即合回 `main` 并删除。
- 不建长期存活的分支——各端若长期分叉，`CHANGELOG.md`、`docs/`、`shared/` 会反复冲突。
- 合并前先 rebase 到最新 `main`，保持历史线性（与仓库现有习惯一致）。
- 跨端改动（如本规范引入的目录调整）单独开分支，不要混进某端的功能分支。

### 多机协作（macOS / Windows 双机）

本仓库在 macOS 与 Windows 两台机器上由 agent 并行开发。**同步中枢只有 GitHub，永不同步工作目录**——两个 agent 同时写同一份 `.git` 会损坏索引，构建产物（mac `.build`、android `build/`）也不跨机复制。

- **一个分支同一时刻只在一台机器签出。** 接活前 `git fetch` 确认起点；开工先推到 origin，对端看到即视为「已被占」。
- **改动的端在能验证它的机器上做**（mac UI 层↔Xcode、Windows 端↔Windows SDK、Android↔JDK 17 + SDK）；本地跑不了的验证由 CI 兜底，不得跳过 CI 结论核对。
- **行尾统一 LF**，由根目录 `.gitattributes` 管辖；Windows 上 `core.autocrlf` 应设 `false`（或 `input`），不得设 `true`。
- 跨会话结论必须落到仓库文件（`docs/` / `CONTEXT.md` / 代码注释），只留在本机 `.scratch/` 的结论对端看不到。
- 双机工作流与项目级 agent 约定的完整说明见根目录 [AGENTS.md](../AGENTS.md)；新机器环境搭建见 [WINDOWS_ONBOARDING.md](WINDOWS_ONBOARDING.md)。

## 提交与发布

### 提交信息

沿用现有约定，格式 `<type>(<端>): <描述>`：

```text
feat(android): release v0.8.4 with explicit deck state, WebP assets and baseline profile
fix(mac): repair settings write failure reporting
chore(repo): move mac sources under apps/mac
```

`type` 用 `feat` / `fix` / `refactor` / `docs` / `test` / `perf` / `chore`。跨端改动可省略端名或写 `repo`。

### 版本号与 tag

各端版本号**互相独立**，tag 用端前缀区分：

| 端 | tag 格式 | 版本来源 |
| --- | --- | --- |
| mac | `v<版本>` | `apps/mac/Sources/KnowFlickCore/Support/AppVersion.swift` |
| android | `android-v<版本>` | `apps/android/app/build.gradle.kts` 的 `versionName` / `versionCode` |
| windows | `win-v<版本>` | 待定 |
| 浏览器插件 | `ext-v<版本>` | 待定 |

mac 端历史上一直用无前缀的 `v*`（已有 40 余个 Release），保持不变；其余端一律加前缀，避免 tag 冲突。

> **mac 版本序列自 0.1.0 起改用 pre-1.0 序列（2026-09-28）。** mac 尚非正规产品，
> 版本号如实反映这一阶段；`v4.6.0` 为旧 4.x 序列末版，其间的 40 余个历史
> tag/Release 全部保留、不删除，但新版本不再续 4.x。更早的历史：`v4.1.1`–`v4.1.8`
> 这 8 个版本号曾被 Android 里程碑（M1–M7）借用，CHANGELOG 中的这 8 条记录已
> 更名为对应的 `android-v0.1.0`–`android-v0.7.0`。两端版本号互不相干，也不要交叉
> 编号——交叉编号会产生「同一版本号在两端指不同东西」的歧义，事后清理成本很高。

### 版本号不要跨端借用

各端版本号是独立序列，**不要**为了「统一」而让一端占用另一端的号段。判断依据很简单：
看 tag 前缀。`v4.1.8` 是 mac 的号，`android-v0.7.0` 是 android 的号，两者可以同时存在且互不冲突。

### 每完成一个小版本就汇总

1. 在 `CHANGELOG.md` 顶部对应端的分节写清本版内容。
2. 在 `docs/` 写发布记录（`ANDROID_RELEASE_<版本>.md` / `MAC_RELEASE_<版本>.md`）。
3. 合回 `main` 并推送。
4. 打 tag 并推送；打之前核对 tag 名与 `apps/android/app/build.gradle.kts` 里的 `versionCode` / `versionName` 一致。
5. 用 `gh release create` 发 Release，**把构建产物作为附件上传**：`dist/` 不入 Git，不传附件则用户无法下载安装包。

### 发版检查清单

```sh
# 1. 端内测试与构建
./tools/build_android.sh          # android：单测 + Lint + release + 签名校验
./tools/test.sh                   # mac：Swift Testing
cd apps/mac && ./build_app.sh     # mac：打包 .app

# 2. 核对版本号与 tag 一致
grep -E 'versionCode|versionName' apps/android/app/build.gradle.kts
# mac 侧版本号来自 apps/mac/Sources/KnowFlickCore/Support/AppVersion.swift

# 3. 提交、推送、打 tag（注解 tag，与 mac 的 v4.2.0 风格一致）
git push origin main
git tag -a android-v0.8.5 -m "KnowFlick Android v0.8.5（versionCode 13）"
git push origin android-v0.8.5

# 4. 发 Release（附产物）
gh release create android-v0.8.5 --title "..." --notes-file <正文> \
  dist/android/KnowFlick-0.8.5.apk dist/android/KnowFlick-0.8.5.apk.sha256
```

tag 一律打**注解 tag**：`android-v0.1.0`–`android-v0.8.4` 历史上是轻量 tag，自 `android-v0.8.5` 起统一为注解 tag（与 mac 的 `v4.2.0` 一致），以便把发布说明随 tag 保存；`git describe` 默认也只认注解 tag。

**android tag 不产生云端产物。** `android.yml` 没有 tag 触发，`macos.yml` 只认 `v*`，因此推送 `android-v0.8.5` 不会触发任何 workflow：上面的签名 APK 必须由本地 `./tools/build_android.sh` 产出，Release 附件也依赖本地上传。mac 端相反——推 `v*` 会触发 macOS workflow（`.github/workflows/macos.yml`）自动构建并附到 Release，两条路径的差异见 [多端现状报告](STATUS_2026-09-14.md) 第二节。

## 环境要求

| 端 | 依赖 | 本机状态 |
| --- | --- | --- |
| android | JDK 17、Android SDK（Platform 35 + Build Tools 35.0.0） | ✅ 可用（Homebrew openjdk@17 + `~/Library/Android/sdk`） |
| mac | **完整 Xcode**（SwiftUI 宏需要 Xcode 的工具链插件） | ✅ 可用（2026-10 起 `/Applications/Xcode.app` 已装，Swift 6.4；UI 层可本机编译验证） |

#### 无完整 Xcode 时的降级验证（备用口径）

```sh
./tools/test.sh --core-only    # 只跑 KnowFlickCoreTests，无需完整 Xcode
./tools/test.sh                # 全量测试，需要完整 Xcode
```

`--core-only` 只构建测试目标再 `--skip-build` 运行，绕开执行文件对 SwiftUI 宏的依赖。
UI 层（`Sources/KnowFlick/**`）的编译验证在已装完整 Xcode 的机器上本机进行，否则交给
[macOS workflow](.github/workflows/macos.yml)（`macos-15` runner 自带 Xcode）。

mac 端 UI 层编译失败的报错形如 `external macro implementation type 'SwiftUIMacros.StateMacro' could not be found`——这是缺完整 Xcode，不是代码问题。需要本地构建完整 `.app` 时先安装 Xcode 并 `sudo xcode-select -s /Applications/Xcode.app`。
