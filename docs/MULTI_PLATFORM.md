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
│   │   ├── app/             # 应用与装配层（data / ui / speech / sync / export / widget）
│   │   ├── domain/          # :domain —— KMP 领域层（androidTarget + jvm），四端共享
│   │   ├── shared-data/     # :shared-data —— 共享持久化层（卡库落盘），四端共享，宿主注入目录
│   │   ├── shared-ui/       # :shared-ui —— CMP 共享界面层，四端共享（win/mac/linux + Android）
│   │   └── desktop/         # :desktop —— 桌面宿主（一份产物跑 Windows / macOS / Linux）
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

## 共享代码（`:domain` 逻辑 + `:shared-ui` 界面）

`shared/` 解决的是**内容**共享；**代码**共享解决的是「一次开发多端同步」。目标与决策见
[ADR-0001：桌面三端与 Android 共用一份 Kotlin / Compose 代码](adr/0001-desktop-tri-platform-shared-kotlin.md)：
**Windows / macOS / Linux 三端 + Android 四端共用一份实现**，各端只是薄宿主。

| 模块 | 内容 | 技术形态 | 谁在用 |
| --- | --- | --- | --- |
| `:domain`（`apps/android/domain`） | 卡片模型 / 卡库状态机 / 学科与学习范围 / 统计 / 搜索 / 图谱 / 间隔重复 / 剪藏抽取 / **测验轮次编排 `QuizCycle`**、**延伸阅读推荐 `RelatedCards`**、**AI/语音设置模型（`AiSettings` / `AiProviderPresets` / `SpeechSettings`）**、**AI 服务层 `AiService`（OkHttp + 流式解析）与 `net/OkHttpAwait`**，以及 AI 会话模型（`CardChatMessage` / `CardChatSession`）——包名 `com.knowflick.app.domain` / `.ai` | KMP：`androidTarget` + `jvm`（JVM 17） | `:app`、`:shared-data`、`:shared-ui`、`:desktop` |
| `:shared-data`（`apps/android/shared-data`） | 共享持久化层：卡库 JSON 原子写 / 备份轮转 / 损坏回退 / 持久化队列 / `AppModel`，以及**归档引擎**（ZIP/JSON 探测 + 合并策略）与导出（Markdown / JSON / TSV / ZIP）；包名 `com.knowflick.app.data` | KMP（`jvmAndAndroidMain` 承载 `java.io`） | `:app`、`:desktop` |
| `:shared-ui`（`apps/android/shared-ui`） | 跨端界面：主题令牌、**六个整屏：`DeckScreen`（刷卡主页）/ `LibraryScreen` / `DetailScreen` / `QuizScreen` / `StatsScreen` / `SettingsScreen`，外加大弹层 `SearchSheet`（全局搜索）**、`CardFace`、`LearningHeatmap`、`AppIcons`、`MarkdownTextRenderer`、`LearningHeatmap`、`AppIcons`、`MarkdownTextRenderer`，以及五条平台接缝（**返回** `PlatformBackHandler`、**触觉** `PlatformHaptics`、**音效** `PlatformSounds`、**底图** `rememberBackgroundImage`、**日期** `rememberLearningDay`）；包名 `com.knowflick.app.ui` 原样保留 | KMP + CMP 1.8.2，四个源集（`commonMain` / `jvmAndAndroidMain` / `androidMain` / `jvmMain`） | `:app`（Android 端生产路径）、`:desktop` |
| `:desktop`（`apps/android/desktop`） | 桌面宿主（一份产物跑 Win/mac/Linux）：渲染共享整屏、读写共享卡库、**导入归档 / 导出 / 知识测验与到期复习**；平台边界只有数据目录与原生文件对话框 | Kotlin JVM + CMP 1.8.2 | 三端桌面 |

分档进度、迁移边界与下一批计划见 [界面共享迁移](windows-route/UI_EXTRACTION.md)（含可复现的
`tools/classify_ui_portability.py`）。

**迁移策略（本仓库的自定约定）**：搬文件时**包名保持不变**（`com.knowflick.app.*`），因此调用方
import 一行都不用改——`:domain` 19 文件、`Theme.kt`（24 个引用文件）、以及 A 档 6 个界面文件
（`QuizScreen`/`LibraryScreen`/`LearningHeatmap`/`AppIcons`/`MarkdownTextRenderer`/`CategoryStampColor`）
都是这样零改动完成的。这是 12k 行 UI 能分批平移的前提。

**源集约定**：`commonMain` 只放平台无关代码；含 `java.time` / `java.util` 的文件放
`jvmAndAndroidMain`（手建中间源集），不要放 `commonMain`——理由见 [KMP 探针结果](windows-route/KMP_PROBE_RESULT.md)。
界面侧同理：Android 专有调用（`LocalContext` / `Toast` / `Intent` / `Bitmap` / assets 读取 / Glance）
不能进 `commonMain`，要么抽 `expect`/`actual`，要么留在 `:app`。

**可移植边界**：两个共享模块今天是「纯 JVM Kotlin」，可移植到 JVM 家族宿主（Android + 三端桌面）。
要加非 JVM target（iOS / Web），必须先把 `java.*` 换成 `kotlinx-datetime` 等公共库（约 9 文件 25 处）。

**验证**（三个模块的测试都必须显式点名，漏点名不会报错、只是静默少跑；`./tools/build_android.sh`
与 `android.yml` 已同步）：

```sh
cd apps/android && ./gradlew :domain:jvmTest :shared-data:jvmTest :shared-ui:jvmTest :desktop:test   # 201 项，只需 JDK 17
```

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
cd apps/android && ./gradlew :desktop:test :desktop:packageDmg   # desktop：本系统安装包
#   ↑ jpackage 不支持交叉编译：macOS 出 dmg、Windows 出 msi、Linux 出 deb。
#     发布用的三个包由 .github/workflows/desktop.yml 的三系统 matrix 自动产出并附到 Release。

# 2. 核对版本号与 tag 一致
grep -E 'versionCode|versionName' apps/android/app/build.gradle.kts
# mac 侧版本号来自 apps/mac/Sources/KnowFlickCore/Support/AppVersion.swift
# desktop 侧版本号来自 apps/android/desktop/build.gradle.kts 的 packageVersion（workflow 会校验 tag 与它一致）

# 3. 提交、推送、打 tag（注解 tag，与 mac 的 v4.2.0 风格一致）
git push origin main
git tag -a android-v0.8.5 -m "KnowFlick Android v0.8.5（versionCode 13）"
git tag -a desktop-v0.1.0 -m "KnowFlick Desktop v0.1.0（Windows/macOS/Linux）"
git push origin android-v0.8.5 desktop-v0.1.0

# 4. 发 Release（附产物）
gh release create android-v0.8.5 --title "..." --notes-file <正文> \
  dist/android/KnowFlick-0.8.5.apk dist/android/KnowFlick-0.8.5.apk.sha256
```

tag 一律打**注解 tag**：`android-v0.1.0`–`android-v0.8.4` 历史上是轻量 tag，自 `android-v0.8.5` 起统一为注解 tag（与 mac 的 `v4.2.0` 一致），以便把发布说明随 tag 保存；`git describe` 默认也只认注解 tag。

**哪条 tag 会自己产出云端产物**：`v*` → `macos.yml`（构建 .app 并附 Release）；`desktop-v*` →
`desktop.yml`（三系统 matrix 各出一个安装包，统一命名后附到同一个 Release，并附 `SHA256SUMS.txt`）；
`android-v*` 不触发任何 workflow，签名 APK 必须本地 `./tools/build_android.sh` 产出、本地上传附件。

> 桌面端 tag 有两个纪律：① tag 里的版本必须等于 `apps/android/desktop/build.gradle.kts` 的
> `packageVersion`（硬校验，与 macos.yml 同一条；本地可用 `tools/assemble_desktop_release.sh --tag …` 空跑验证）；
> ② **`paths` 过滤对 tag 推送不生效**——GitHub 官方文档原话是 "Path filters are not evaluated for
> pushes of tags"（[workflow syntax, `on.<push>.paths`](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#onpushpull_requestpull_request_targetpathspaths-ignore)），
> 所以 tag 打在只改文档的提交上**同样会**触发三系统构建与发布。
> （本条此前写成「paths 对 tag 同样生效」，是错的——别按那个说法去挑「含桌面改动的提交」打 tag。）

### 安装包图标：一份美术，三端格式

jpackage 不交叉编译，也不认「一种图标走三端」：macOS 要 `.icns`、Windows 要 `.ico`、Linux 要 `.png`。
按第一原则，**美术只有一份**（`apps/mac/Resources/AppIcon.iconset/`），三端格式由
`tools/generate_app_icons.py` 派生到 `shared/icons/` 并随仓库分发：

```sh
python3 tools/generate_app_icons.py          # 重新生成（.icns 需要 macOS 的 iconutil）
python3 tools/generate_app_icons.py --check  # 只校验产物在不在（产物是二进制，评审看不到 diff）
```

打包任务依赖 `:desktop:verifyAppIcons`：图标缺失时**在打包这一步就失败并给出生成命令**，
而不是静默套上 jpackage 的默认图标（那种问题在安装包里很难被发现）。

### 发布前三端附件怎么组装（可本地空跑）

`tools/assemble_desktop_release.sh` 是那条「只在打 tag 时走」的通道的**唯一实现**，workflow 直接调它：

```sh
# 目录布局 = actions/download-artifact 落盘后的样子
mkdir -p dryrun/desktop-{dmg,msi,deb} && cp … dmg msi deb 各一份
bash tools/assemble_desktop_release.sh --tag desktop-v0.1.0 --artifacts-dir dryrun --out dryrun-out
```

它做四件事：校验 tag 与 `packageVersion` 一致 → 把 jpackage 的原名（如 `KnowFlick-1.0.0.dmg`，
macOS 的 MAJOR>0 别名）统一成产品版本名 → 生成 `SHA256SUMS.txt` → （加 `--publish` 时）附到 Release。
放在脚本里的理由很直接：这条通道打 tag 才会走，而在 YAML 里的一坨 shell 没法本地空跑。

## 环境要求

| 端 | 依赖 | 本机状态 |
| --- | --- | --- |
| android | JDK 17、Android SDK（Platform 35 + Build Tools 35.0.0） | ✅ 可用（Homebrew openjdk@17 + `~/Library/Android/sdk`） |
| android 领域层（`:domain`，KMP） | **只需 JDK 17**——不需要 Android SDK | ✅ 可用（实测：移走 `local.properties` 且 `ANDROID_HOME` 指向不存在路径，`./gradlew :domain:jvmTest` 仍 171 项全绿；见 [KMP 探针结果](windows-route/KMP_PROBE_RESULT.md)） |
| 共享界面（`:shared-ui`）与桌面宿主（`:desktop`） | **只需 JDK 17**——不需要 Android SDK；**打安装包要在目标系统上**（jpackage 不支持交叉编译） | ✅ 可用（`:shared-ui:jvmTest` / `:desktop:test` 本机全绿；`:desktop:packageDmg` 实测出 65 MB DMG。MSI/DEB 由 [desktop.yml](.github/workflows/desktop.yml) 的三系统 matrix 覆盖） |
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
