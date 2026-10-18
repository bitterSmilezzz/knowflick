# 多端仓库结构与协作规范

本仓库同时承载 KnowFlick 的多个端。各端独立开发、按小版本汇总回 `main`。

## 目录结构

```text
KnowFlick/
├── apps/                    # 各端应用（互不依赖，各自独立构建）
│   ├── workbench/           # 第一套桌面（Vite + React + TypeScript + Tauri 2）
│   │   ├── src/domain/      # 卡片 / 卡库 / 排列 / 间隔重复 / 统计 / 搜索 / 剪藏抽取 / 笔记解析（含 Vitest 单测）
│   │   ├── src/ui/          # 界面组件
│   │   ├── src/shell/       # 壳能力封装（文件对话框、网络、凭据）
│   │   ├── vite.config.ts   # publicDir 指向 shared/assets
│   │   └── src-tauri/       # Rust 壳：数据目录、原子写与备份轮转、正文抓取、AI 请求、导出
│   └── android/             # 第二套：Android 端（Gradle + Compose）
│       ├── app/             # :app —— 应用与装配层（data / ui / speech / sync / export / widget）
│       ├── domain/          # :domain —— KMP 领域层（androidTarget + jvm），Android 与冻结的 :desktop 共用
│       ├── shared-data/     # :shared-data —— 共享持久化层（卡库落盘），同上两者共用，宿主注入目录
│       ├── shared-ui/       # :shared-ui —— CMP 共享界面层，Android 与冻结的 :desktop 共用
│       └── desktop/         # :desktop —— 已冻住的 JVM 桌面宿主（一份产物跑 Windows / macOS / Linux），不再加功能
├── shared/                  # 跨端共享内容（单一事实来源）
│   ├── assets/
│   │   ├── taxonomy_map.json # 学科契约
│   │   └── bg/*.webp        # 42 张分类底图
│   └── icons/               # 安装包图标：AppIcon.iconset（美术源）+ 派生的 AppIcon.{icns,ico,png}
├── tools/                   # 跨端脚本（构建、图标生成、内容导入、发布组装）
├── docs/                    # 跨端文档与各端发布记录
├── dist/                    # 构建产物（不入 Git）
├── CHANGELOG.md             # 各端更新日志
├── CONTEXT.md               # 领域上下文
└── README.md
```

新增端时在 `apps/` 下建同名目录，不要往仓库根目录放源码。

**端按「套」划分**（[ADR-0002](adr/0002-desktop-web-split-from-android.md)）：Windows / Linux / macOS
与稍后的网页是第一套，共用 `apps/workbench` 这一份 Web 界面——**不为某个操作系统再建目录**；
Android 是第二套；iOS 先不做，也不和 Android 绑成一个框架。

Swift / SwiftUI 的 `apps/mac` 已于 2026-10-13 **整体删除**（148 个文件，退役记录见
[MAC_CONVERGENCE.md](MAC_CONVERGENCE.md)）。仓库里的任何文档、脚本或 workflow 都不要再把它当活端。

## 共享资产

`shared/assets/` 是底图与学科契约的**唯一事实来源**。三处引用方通过不同机制引用同一份文件：

| 引用方 | 引用方式 | 说明 |
| --- | --- | --- |
| android（`:app`） | `app/build.gradle.kts` 的 `sourceSets["main"].assets.srcDirs("../../../shared/assets")` | Gradle 直接读取该目录 |
| 第一套桌面（`apps/workbench`） | `vite.config.ts` 的 `publicDir: path.resolve(root, "../../shared/assets")` | 构建进 `dist/`，运行时按 `/bg/<key>.webp` 取；**不再**列进 `tauri.conf.json` 的 `bundle.resources`——那份副本只会落进产物的 `_up_/` 前缀目录，白白多几 MB |
| 已冻住的 JVM 桌面（`:desktop`） | `desktop/build.gradle.kts` 的 `sourceSets["main"].resources.srcDir(file("../../../shared/assets"))` | 打进 jar 当 classpath 资源，`:shared-ui` 的 jvm 侧 actual 用 Skia 解码 |

**不要**在 `apps/*/` 下留副本——迁移前 mac 与 android 各存一份 42 张底图（6.35 MB ×2）和内容库，
靠人工同步保持一致，一旦漂移会导致两端内容不一致且难以察觉。（mac 端现已删除，这条是历史教训。）

> 2026-10 更新：预置内容库（`seed_cards.json` 214 张）已从仓库移除，知识内容改由用户剪藏/导入产出，
> 不再是跨端共享资产；`shared/assets/` 现在只剩底图与 `taxonomy_map.json` 学科契约。

改动共享资产后必须验证引用方：

```sh
# android：确认资源进了 APK
cd apps/android && ./gradlew :app:assembleDebug
unzip -l app/build/outputs/apk/debug/app-debug.apk | grep "assets/bg/.*\.webp" | head

# 第一套桌面：确认资源进了 dist/
cd apps/workbench && npm run build
ls dist/bg/*.webp | head

# 第一套桌面的完整门禁（npm test + tsc + cargo test，与 workbench.yml 同口径）
./tools/verify_workbench.sh
```

底图统一用 **WebP**：三处引用方都按同一份 `shared/assets/bg/*.webp` 引用并都能解码——Android 侧原生支持
WebP，第一套桌面由浏览器解码（构建时随 `publicDir` 进 `dist/`），已冻住的 `:desktop` 由 Skia 解码
（[`:desktop` 说明](../apps/android/desktop/README.md) 记录了解出 `bg/ai.webp`）。
同画质下体积约为 JPEG 的三分之一。

## 共享代码（`:domain` 逻辑 + `:shared-ui` 界面）

`shared/` 解决的是**内容**共享；**代码**共享解决的是「一次开发多端同步」。**当前决策**见
[ADR-0002：桌面三端与网页一套，安卓单独一套](adr/0002-desktop-web-split-from-android.md)：
第一套（Windows / Linux / macOS 与稍后的网页）走 `apps/workbench` 的一份 Web 界面，Android 单独一套。
**下面这四个 Kotlin 模块服务 Android 与已冻住的 `:desktop`——第一套桌面的桌面端不再走它们**，
新桌面功能写在 `apps/workbench`，不要往 `:shared-ui` / `:desktop` 里加。
[ADR-0001](adr/0001-desktop-tri-platform-shared-kotlin.md) 那条
「Windows / macOS / Linux 三端 + Android 四端共用一份 Kotlin / Compose 实现」**不再是活计划**
（它是旧活计划的记录，其实测结论仍有效）；已落地的共享代码不因这个决定删除。

| 模块 | 内容 | 技术形态 | 谁在用 |
| --- | --- | --- | --- |
| `:domain`（`apps/android/domain`） | 卡片模型 / 卡库状态机 / 学科与学习范围 / 统计 / 搜索 / 图谱 / 间隔重复 / 剪藏抽取 / **测验轮次编排 `QuizCycle`**、**延伸阅读推荐 `RelatedCards`**、**AI/语音设置模型（`AiSettings` / `AiProviderPresets` / `SpeechSettings`）**、**AI 服务层 `AiService`（OkHttp + 流式解析）与 `net/OkHttpAwait`**，以及 AI 会话模型（`CardChatMessage` / `CardChatSession`）——包名 `com.knowflick.app.domain` / `.ai` | KMP：`androidTarget` + `jvm`（JVM 17） | `:app`、`:shared-data`、`:shared-ui`、`:desktop`（都在 `apps/android` 构建内） |
| `:shared-data`（`apps/android/shared-data`） | 共享持久化层：卡库 JSON 原子写 / 备份轮转 / 损坏回退 / 持久化队列 / `AppModel`，以及**归档引擎**（ZIP/JSON 探测 + 合并策略）与导出（Markdown / JSON / TSV / ZIP）；包名 `com.knowflick.app.data` | KMP（`jvmAndAndroidMain` 承载 `java.io`） | `:app`、`:desktop` |
| `:shared-ui`（`apps/android/shared-ui`） | 跨端界面：主题令牌、**六个整屏：`DeckScreen`（刷卡主页）/ `LibraryScreen` / `DetailScreen` / `QuizScreen` / `StatsScreen` / `SettingsScreen`，外加 `LearningMapScreen`（学习地图）、弹层 `SearchSheet`（全局搜索）、`ImportRestoreDialog`（导入预览）与 `CardFollowUpChatSheet`（AI 追问）**、`CardFace`、`LearningHeatmap`、`AppIcons`、`MarkdownTextRenderer`，以及六条平台接缝（**返回** `PlatformBackHandler`、**轻量提示** `LocalNotifier`、**触觉** `PlatformHaptics`、**音效** `PlatformSounds`、**底图** `rememberBackgroundImage`、**日期** `rememberLearningDay`）；包名 `com.knowflick.app.ui` 原样保留 | KMP + CMP 1.8.2，四个源集（`commonMain` / `jvmAndAndroidMain` / `androidMain` / `jvmMain`） | `:app`（Android 端生产路径）、`:desktop`；**第一套桌面（`apps/workbench`）不用它**——它的界面是 Web |
| `:desktop`（`apps/android/desktop`） | 已冻住的桌面宿主（一份产物跑 Win/mac/Linux）：渲染共享整屏、读写共享卡库、**导入归档 / 导出 / 知识测验与到期复习**；平台边界只有数据目录与原生文件对话框 | Kotlin JVM + CMP 1.8.2 | 无下游消费者——它自己就是宿主（已冻住，不再加功能） |

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

**可移植边界**：这几个共享模块今天是「纯 JVM Kotlin」，可移植到 JVM 家族宿主（Android + 已冻住的 `:desktop`）——
第一套桌面的界面不在这条线上，它是 Web。
要加非 JVM target（iOS / Web），必须先把 `java.*` 换成 `kotlinx-datetime` 等公共库（约 9 文件 25 处）。

**验证**（四个模块的测试都必须显式点名，漏点名不会报错、只是静默少跑；`./tools/build_android.sh`
与 `android.yml` 已同步）：

```sh
cd apps/android && ./gradlew :domain:jvmTest :shared-data:jvmTest :shared-ui:jvmTest :desktop:test   # 201 项，只需 JDK 17
```

## 分支模型

采用**短特性分支 + main 汇总**：`main` 始终是多端汇总分支，且保持可构建、可发布。

| 用途 | 命名 | 示例 |
| --- | --- | --- |
| 新增功能 | `<端>/<功能>` | `android/swipe-haptic`、`workbench/initial-scaffold` |
| 缺陷修复 | `fix/<端>-<问题>` | `fix/android-refresh-stale` |
| 跨端改动 | `chore/<主题>` | `chore/multi-platform-layout` |
| 文档 | `docs/<主题>` | `docs/android-release` |

端名按今天存在的端取：`workbench`（第一套桌面，`apps/workbench`）/ `android`（第二套）/
`desktop`（已冻住的 JVM 桌面宿主，只做维护）/ `chore`（跨端：`shared/`、`tools/`、workflow 布局）/
`docs`。mac 端已删除，不再有 `mac/*` 分支；Windows 与稍后的网页都在 `workbench` 这一套里，不单开端名。

规则：

- 分支从最新 `main` 切出，完成即合回 `main` 并删除。
- 不建长期存活的分支——各端若长期分叉，`CHANGELOG.md`、`docs/`、`shared/` 会反复冲突。
- 合并前先 rebase 到最新 `main`，保持历史线性（与仓库现有习惯一致）。
- 跨端改动（如本规范引入的目录调整）单独开分支，不要混进某端的功能分支。

### 多机协作（macOS / Windows 双机）

本仓库在 macOS 与 Windows 两台机器上由 agent 并行开发。**同步中枢只有 GitHub，永不同步工作目录**——两个 agent 同时写同一份 `.git` 会损坏索引，构建产物（android `build/`、`apps/workbench/node_modules/` 与 `apps/workbench/src-tauri/target/`）也不跨机复制。

- **一个分支同一时刻只在一台机器签出。** 接活前 `git fetch` 确认起点；开工先推到 origin，对端看到即视为「已被占」。
- **改动的端在能验证它的机器上做**（第一套桌面↔Node 22 + Rust；Android↔JDK 17 + Android SDK；共享 Kotlin 模块↔JDK 17，不需要 SDK）；三端安装包（DMG / MSI / DEB）只能在各自系统上出，本地跑不了的验证由 CI 兜底，不得跳过 CI 结论核对。
- **行尾统一 LF**，由根目录 `.gitattributes` 管辖；Windows 上 `core.autocrlf` 应设 `false`（或 `input`），不得设 `true`。
- 跨会话结论必须落到仓库文件（`docs/` / `CONTEXT.md` / 代码注释），只留在本机 `.scratch/` 的结论对端看不到。
- 双机工作流与项目级 agent 约定的完整说明见根目录 [AGENTS.md](../AGENTS.md)；新机器环境搭建见 [WINDOWS_ONBOARDING.md](WINDOWS_ONBOARDING.md)。

## 提交与发布

### 提交信息

沿用现有约定，格式 `<type>(<端>): <描述>`：

```text
feat(android): release v0.8.4 with explicit deck state, WebP assets and baseline profile
fix(desktop): 更正版本约束的表述——只有 macOS 需要 MAJOR>0 别名
chore(release): 三端安装包图标 + 发布附件组装可本地空跑
```

`type` 用 `feat` / `fix` / `refactor` / `docs` / `test` / `perf` / `chore`。跨端改动可省略端名或写 `repo`。

### 版本号与 tag

各端版本号**互相独立**，tag 用端前缀区分：

| 端 | tag 格式 | 版本来源 |
| --- | --- | --- |
| 第一套桌面（`apps/workbench`） | `workbench-v<版本>` | `apps/workbench/package.json` 与 `apps/workbench/src-tauri/tauri.conf.json` 的 `version`（发布脚本两处都校验） |
| android | `android-v<版本>` | `apps/android/app/build.gradle.kts` 的 `versionName` / `versionCode` |
| 已冻住的 JVM 桌面（`:desktop`） | `desktop-v<版本>` | `apps/android/desktop/build.gradle.kts` 的 `packageVersion` |

mac 端（**已删除**）历史上用**无前缀的 `v*`**（40 余个 Release）：该序列**已终止**——不会有新版本，
历史 tag 与 Release 全部保留。其余端一律加前缀，避免 tag 冲突。Windows 不单独成套（由第一套桌面覆盖），
因此没有 `win-v*`；浏览器插件也未再规划 `ext-v*`。

> **mac 版本序列自 0.1.0 起改用 pre-1.0 序列（2026-09-28）。** mac 尚非正规产品，
> 版本号如实反映这一阶段；`v4.6.0` 为旧 4.x 序列末版，其间的 40 余个历史
> tag/Release 全部保留、不删除，但新版本不再续 4.x。更早的历史：`v4.1.1`–`v4.1.8`
> 这 8 个版本号曾被 Android 里程碑（M1–M7）借用，CHANGELOG 中的这 8 条记录已
> 更名为对应的 `android-v0.1.0`–`android-v0.7.0`。两端版本号互不相干，也不要交叉
> 编号——交叉编号会产生「同一版本号在两端指不同东西」的歧义，事后清理成本很高。
>
> **现状（2026-10-13 之后）**：mac 端已整体删除，以上是序列终止前的口径；`v*` 不再出新版本，
> mac 侧的版本号来源文件也随 `apps/mac` 一起没了。mac 收敛过程见 [MAC_CONVERGENCE.md](MAC_CONVERGENCE.md)。

### 版本号不要跨端借用

各端版本号是独立序列，**不要**为了「统一」而让一端占用另一端的号段。判断依据很简单：
看 tag 前缀。`v4.1.8` 是 mac 的号（序列已终止），`android-v0.7.0` 是 android 的号，
两者可以同时存在且互不冲突。第一套桌面同理：`workbench-v0.1.0` 与 `desktop-v0.1.0` 是两个不同的序列，
产物名也不同（`KnowFlick-Workbench-<版本>-<系统>.<扩展名>` vs `KnowFlick-<版本>-<系统>.<扩展名>`），
不能互相借用号段。

### 每完成一个小版本就汇总

1. 在 `CHANGELOG.md` 顶部对应端的分节写清本版内容。
2. 在 `docs/` 写发布记录（android 是 `ANDROID_RELEASE_<版本>.md`；mac 序列已终止，历史 `MAC_RELEASE_*.md` 保留）。
3. 合回 `main` 并推送。
4. 打 tag 并推送；打之前核对 tag 名与版本来源一致：android ↔ `apps/android/app/build.gradle.kts` 的
   `versionCode` / `versionName`，第一套桌面 ↔ `apps/workbench/package.json` 与 `src-tauri/tauri.conf.json`，
   已冻住的 `:desktop` ↔ `apps/android/desktop/build.gradle.kts` 的 `packageVersion`。
5. 用 `gh release create` 发 Release，**把构建产物作为附件上传**：`dist/` 不入 Git，不传附件则用户无法下载安装包
   （`workbench-v*` 与 `desktop-v*` 的附件由各自的 workflow 自动组装上传，不用手工传）。

### 发版检查清单

```sh
# 1. 端内测试与构建
./tools/build_android.sh          # android：单测 + Lint + release + 签名校验
./tools/verify_workbench.sh       # 第一套桌面：npm test + tsc + cargo test（只需 Node 22+ 与 Rust）
cd apps/android && ./gradlew :desktop:test :desktop:packageDmg   # 冻结的 JVM 桌面：本系统安装包
#   ↑ jpackage 不支持交叉编译：macOS 出 dmg、Windows 出 msi、Linux 出 deb。
#     发布用的三个包由 .github/workflows/desktop.yml 的三系统 matrix 自动产出并附到 Release。

# 2. 核对版本号与 tag 一致
grep -E 'versionCode|versionName' apps/android/app/build.gradle.kts
grep -m1 '"version"' apps/workbench/package.json apps/workbench/src-tauri/tauri.conf.json
# 冻结 JVM 桌面（:desktop）的版本号来自 apps/android/desktop/build.gradle.kts 的 packageVersion（workflow 会校验 tag 与它一致）

# 3. 提交、推送、打 tag（注解 tag，与 mac 的 v4.2.0 风格一致）
git push origin main
git tag -a android-v0.8.5 -m "KnowFlick Android v0.8.5（versionCode 13）"
git tag -a workbench-v0.1.0 -m "KnowFlick Workbench v0.1.0（Windows/macOS/Linux）"
git tag -a desktop-v0.1.0 -m "KnowFlick Desktop v0.1.0（Windows/macOS/Linux）"
git push origin android-v0.8.5 workbench-v0.1.0 desktop-v0.1.0

# 4. 发 Release（附产物）
gh release create android-v0.8.5 --title "..." --notes-file <正文> \
  dist/android/KnowFlick-0.8.5.apk dist/android/KnowFlick-0.8.5.apk.sha256
```

tag 一律打**注解 tag**：`android-v0.1.0`–`android-v0.8.4` 历史上是轻量 tag，自 `android-v0.8.5` 起统一为注解 tag（与 mac 的 `v4.2.0` 一致），以便把发布说明随 tag 保存；`git describe` 默认也只认注解 tag。

**哪条 tag 会自己产出云端产物**：`workbench-v*` → [workbench-release.yml](../.github/workflows/workbench-release.yml)
（三系统 matrix 各出一档，各自先过一遍 `verify_workbench.sh`，再由 `tools/assemble_workbench_release.sh`
统一命名为 `KnowFlick-Workbench-<版本>-<系统>.<扩展名>`、生成 `SHA256SUMS.txt` 并附到同一个 Release）；
`desktop-v*` → [desktop.yml](../.github/workflows/desktop.yml)（三系统 matrix 各出一个安装包，统一命名后附到同一个
Release，并附 `SHA256SUMS.txt`）；`android-v*` 不触发任何 workflow，签名 APK 必须本地 `./tools/build_android.sh`
产出、本地上传附件。

历史上无前缀的 `v*` 曾触发 `macos.yml` 构建 `.app` 并附 Release：该 workflow 已随 `apps/mac` 一起删除，
`v*` 序列终止，这条通道不复存在。

> 桌面端 tag 有两个纪律：① tag 里的版本必须等于产物里声明的版本——`desktop-v*` 对
> `apps/android/desktop/build.gradle.kts` 的 `packageVersion`，`workbench-v*` 对
> `apps/workbench/package.json` 与 `src-tauri/tauri.conf.json`（两条都是硬校验；本地可分别用
> `tools/assemble_desktop_release.sh --tag …` / `tools/assemble_workbench_release.sh --tag …` 空跑验证）；
> ② **`paths` 过滤对 tag 推送不生效**——GitHub 官方文档原话是 "Path filters are not evaluated for
> pushes of tags"（[workflow syntax, `on.<push>.paths`](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#onpushpull_requestpull_request_targetpathspaths-ignore)），
> 所以 tag 打在只改文档的提交上**同样会**触发三系统构建与发布。
> （本条此前写成「paths 对 tag 同样生效」，是错的——别按那个说法去挑「含桌面改动的提交」打 tag。）

### 安装包图标：一份美术，三端格式

jpackage 不交叉编译，也不认「一种图标走三端」：macOS 要 `.icns`、Windows 要 `.ico`、Linux 要 `.png`。
按第一原则，**美术只有一份**（`shared/icons/AppIcon.iconset/`，原先在 `apps/mac/Resources/` 下，
随 mac 端退役搬来），三端格式由 `tools/generate_app_icons.py` 派生到 `shared/icons/`
（`AppIcon.icns` / `AppIcon.ico` / `AppIcon.png`）并随仓库分发：

```sh
python3 tools/generate_app_icons.py          # 重新生成（.icns 需要 macOS 的 iconutil）
python3 tools/generate_app_icons.py --check  # 只校验产物在不在（产物是二进制，评审看不到 diff）
```

打包任务依赖 `:desktop:verifyAppIcons`：图标缺失时**在打包这一步就失败并给出生成命令**，
而不是静默套上 jpackage 的默认图标（那种问题在安装包里很难被发现）。

第一套桌面（`apps/workbench`）的第一份图标同样取自这份美术，但走它自己的派生路径：
`npx tauri icon <1024 源>` 生成 `apps/workbench/src-tauri/icons/`（产物**入库**，并同步
`tauri.conf.json` 的 `bundle.icon`；顺带生成的 iOS / Android / Windows Store 目录用不上，删掉再提交）。
它同样是**派生物**——改了美术要重新生成。

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

第一套桌面（`apps/workbench`）是**同一条纪律、另一份实现**：`tools/assemble_workbench_release.sh`
（tag `workbench-v*`，产物 `KnowFlick-Workbench-<版本>-<系统>.<扩展名>`，同样可本地空跑，版本校验对着
`package.json` 与 `tauri.conf.json` 两处）：

```sh
# 目录布局 = actions/download-artifact 落盘后的样子（workflow 里不 merge）
mkdir -p dryrun/workbench-{dmg,msi,deb} && cp … dmg msi deb 各一份
bash tools/assemble_workbench_release.sh --tag workbench-v0.1.0 --artifacts-dir dryrun --out dryrun-out
```

## 环境要求

| 端 / 模块 | 依赖 | 本机（macOS 开发机）状态 |
| --- | --- | --- |
| android（`:app`） | JDK 17、Android SDK（`compileSdk 36`，target SDK 保持 35） | ✅ 已装（Homebrew `openjdk@17` + `~/Library/Android/sdk`，其中有 platforms;android-35/36 与 build-tools 36.1.0） |
| 共享 Kotlin 模块（`:domain` / `:shared-data` / `:shared-ui`） | **只需 JDK 17**——不需要 Android SDK | ✅ 可用（实测：移走 `local.properties` 且 `ANDROID_HOME` 指向不存在路径，`./gradlew :domain:jvmTest` 仍全绿；见 [KMP 探针结果](windows-route/KMP_PROBE_RESULT.md)） |
| 已冻住的 JVM 桌面宿主（`:desktop`） | **只需 JDK 17**——不需要 Android SDK；**打安装包要在目标系统上**（jpackage 不支持交叉编译） | ✅ 可用（`:shared-ui:jvmTest` / `:desktop:test` 本机全绿；`:desktop:packageDmg` 实测出 65 MB DMG。MSI/DEB 由 [desktop.yml](../.github/workflows/desktop.yml) 的三系统 matrix 覆盖） |
| 第一套桌面（`apps/workbench`） | **Node 22+**（CI 固定 22）与 **Rust 工具链**——**不需要 JDK，也不需要 Android SDK** | ✅ 本机 node v24.18.0 / npm 11.16.0 / rustc 1.98.1 可用；三端安装包只能在各自系统上出，由 [workbench-release.yml](../.github/workflows/workbench-release.yml) 的三系统 matrix 产出 |

#### mac 端退役后残留的两个脚本

`tools/test.sh` 还留在 `tools/` 里，但**不是验证入口**了：它只打印共享端测试命令并以 1 退出（历史入口，留着指路）。
共享端验证跑 `cd apps/android && ./gradlew :domain:jvmTest :shared-data:jvmTest :shared-ui:jvmTest :desktop:test`，
第一套桌面跑 `./tools/verify_workbench.sh`。

`tools/sync_shared_assets.sh` 已随 mac 端一起**删除**——它最后只剩「检测到 `apps/mac` 不存在就返回」这一个动作，
而共享底图现在三处都是直接引用（Android 走 Gradle `assets.srcDirs`、第一套桌面走 Vite `publicDir`、`:desktop` 走 classpath 资源），
不存在需要同步的副本。
