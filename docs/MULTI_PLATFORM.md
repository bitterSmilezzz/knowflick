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
│       ├── seed_cards.json  # 214 张种子卡
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

`shared/assets/` 是种子卡与底图的**唯一事实来源**。两端当前通过不同机制引用同一份文件：

| 端 | 引用方式 | 说明 |
| --- | --- | --- |
| mac | `apps/mac/Sources/KnowFlickCore/Resources/` 下的符号链接 | SwiftPM 会跟随符号链接，把内容打进 resource bundle |
| android | `app/build.gradle.kts` 的 `sourceSets["main"].assets.srcDirs("../../../shared/assets")` | Gradle 直接读取该目录 |

**不要**在 `apps/*/` 下留副本——迁移前 mac 与 android 各存一份 42 张底图（6.35 MB ×2）和 seed_cards.json，靠人工同步保持一致，一旦漂移会导致两端内容不一致且难以察觉。

改动共享资产后必须同时验证两端：

```sh
# mac：确认资源进了 bundle
cd apps/mac && swift build --target KnowFlickCore
ls .build/out/Products/Debug/KnowFlick_KnowFlickCore.bundle/Contents/Resources/ | head

# android：确认资源进了 APK
cd apps/android && ./gradlew :app:assembleDebug
unzip -l app/build/outputs/apk/debug/app-debug.apk | grep "assets/seed_cards.json"
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

### 每完成一个小版本就汇总

1. 在 `CHANGELOG.md` 顶部对应端的分节写清本版内容。
2. 在 `docs/` 写发布记录（`ANDROID_RELEASE_<版本>.md` / `MAC_RELEASE_<版本>.md`）。
3. 合回 `main` 并推送。
4. 打 tag 并推送。
5. 用 `gh release create` 发 Release，**把构建产物作为附件上传**：`dist/` 不入 Git，不传附件则用户无法下载安装包。

### 发版检查清单

```sh
# 1. 端内测试与构建
./tools/build_android.sh          # android：单测 + Lint + release + 签名校验
./tools/test.sh                   # mac：Swift Testing
cd apps/mac && ./build_app.sh     # mac：打包 .app

# 2. 提交、推送、打 tag
git push origin main
git tag android-v0.8.5 && git push origin android-v0.8.5

# 3. 发 Release（附产物）
gh release create android-v0.8.5 --title "..." --notes-file <正文> \
  dist/android/KnowFlick-0.8.5.apk dist/android/KnowFlick-0.8.5.apk.sha256
```

## 环境要求

| 端 | 依赖 | 本机状态 |
| --- | --- | --- |
| android | JDK 17、Android SDK（Platform 35 + Build Tools 35.0.0） | ✅ 可用 |
| mac | **完整 Xcode**（SwiftUI 宏需要 Xcode 的工具链插件） | ⚠️ 本机只有 CommandLineTools，`Sources/KnowFlick/**` 无法编译，`KnowFlickCore` 可构建 |

mac 端 UI 层编译失败的报错形如 `external macro implementation type 'SwiftUIMacros.StateMacro' could not be found`——这是缺完整 Xcode，不是代码问题。需要构建完整 `.app` 时先安装 Xcode 并 `sudo xcode-select -s /Applications/Xcode.app`。
