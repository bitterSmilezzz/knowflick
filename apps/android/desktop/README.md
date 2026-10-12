# :desktop —— 桌面宿主（Windows / macOS / Linux）

Kotlin JVM + Compose Multiplatform 宿主。它与 Android 端共用同一份**领域逻辑**（`:domain`）、
同一份**持久化实现**（`:shared-data`）与同一份**界面代码**（`:shared-ui`）——三份都是同一份代码。

## 现状

| 项 | 状态 |
| --- | --- |
| 共享领域层 | ✅ `implementation(project(":domain"))`，卡库状态机 / JSON 线格式 / 学科表均可用 |
| 共享持久化层 | ✅ `implementation(project(":shared-data"))`——**真实卡库落盘/回读**，与 Android 端同一份 `CardStorage`（原子写 + 备份轮转 + 损坏回退） |
| 共享界面层 | ✅ `implementation(project(":shared-ui"))`——**主界面直接渲染 `LibraryScreen`**，与 Android 端是同一份 Compose 代码 |
| Compose 运行时 | ✅ CMP 1.8.2，与 Android 端 `compose-bom:2025.06.00`（`androidx.compose.*` = 1.8.2）逐号对齐 |
| 离屏渲染测试 | ✅ `./gradlew :desktop:test`（7 项：领域层复用 / 持久化往返 / 归档导入 / 导出往返 / 非法输入 / 整屏渲染 / 导入后界面更新） |
| 三端目标 | ✅ 一份产物跑 Windows / macOS / Linux（jvm target） |
| 安装包 | ✅ 三端各出原生包（dmg / msi / deb），由 [desktop.yml](../../../.github/workflows/desktop.yml) 的三系统 matrix 构建并附 Release |
| 底图资源 | ✅ 仓库根 `shared/assets/bg`（42 张 webp，2.4 MB）经 `resources.srcDir` 打进 jar，`:shared-ui` 的 jvm 侧 actual 用 Skia 解码——与 Android 端同一份来源、同一布局、零副本 |
| 导入归档 | ✅ 原生文件对话框选 `.zip` 备份包 / `.json` 镜像 → **共享** `ArchiveImportManager` 探测 → 按 MERGE 合并 → 落盘 → 界面刷新 |
| 知识测验 | ✅ **共享** `QuizScreen` + **共享** `QuizCycle`（`:domain`）——菜单栏「学习 → 知识测验 / 只测今天到期」，评分经 SM-2 落库，可「再测一组」 |
| 学习统计 | ✅ **共享** `StatsScreen`（同一个 `StatsCalculator` / `LearningPlan` / 热力图）——菜单栏「学习 → 学习统计」，统计页里的「今日到期」可直接跳进到期复习 |
| 导出 | ✅ 收藏阁 → Markdown、整库 → JSON 镜像，选「另存为」；导出格式由**共享** `CardExportEngine` 决定 |
| 平台动作 | ⚠️ 系统级分享用「另存为」替代（桌面无 `ACTION_SEND` 对等物）；剪贴板、Toast 未接 |
| 详情页 | ❌ 尚未迁入共享模块（点击卡片只给提示） |
| 应用图标 | ❌ 未接入（三端各需 `.icns` / `.ico` / `.png`） |

总目标与决策见 [ADR-0001](../../../docs/adr/0001-desktop-tri-platform-shared-kotlin.md)；
界面分档进度见 [UI_EXTRACTION](../../../docs/windows-route/UI_EXTRACTION.md)。

## 状态与重组（一个容易踩的约定）

卡库（`CardStore`）与测验会话（`QuizSession`）**都不是 Compose 状态**，而且评分只改动**同一个**
`QuizSession` 实例的内部进度——实例本身不变。所以宿主的重组契约是：

- 任何写入后 `version++`（`DesktopHostState` 负责）；
- 版本驱动的屏幕外面套 `key(state.version)`（与 Android 宿主的 `key(viewModel.version)` 同一手法）——
  `key` 既**订阅**了 version，又在变化时重建这棵子树。

少了 `key` 会出现「评分后界面停在第一张卡」这类静默故障（写这波时被测试逮到过一次：
只订阅 `quizSession` 实例是收不到失效通知的）。

## 桌面侧的平台相关代码只有两个文件

除下面这些，桌面端的一切都来自共享模块（这就是「一套开发」在宿主侧的体现）：

| 文件 | 职责 | 对应 Android 端 |
| --- | --- | --- |
| `DesktopPaths.kt` | 数据目录在哪（mac/Win/Linux 各按惯例） | `context.filesDir/store` |
| `DesktopFileDialogs.kt` | 原生文件对话框（打开/另存为）与取路径 | SAF `ActivityResultContracts.OpenDocument` |

另两条平台接缝的桌面侧在 `:shared-ui/src/jvmMain`（触觉 no-op、底图 Skia 解码），
与 Android 侧同处一个 expect/actual 接缝——见 [UI_EXTRACTION §7.1](../../../docs/windows-route/UI_EXTRACTION.md)。

**归档怎么解析、导出成什么格式，不在这两个文件里**——那是 `:shared-data` 的引擎，
两端跑同一份（见 [UI_EXTRACTION §7](../../../docs/windows-route/UI_EXTRACTION.md)）。

## 数据目录

| 系统 | 目录 |
| --- | --- |
| macOS | `~/Library/Application Support/KnowFlick/store` |
| Windows | `%APPDATA%\KnowFlick\store` |
| Linux | `$XDG_DATA_HOME/knowflick/store`（未设则 `~/.local/share`） |

结构与 Android 端 `filesDir/store` 完全一致（`cards.json` + `cards.backup.json` + `cards.backup2.json`）。
**首次启动是空库**——这是正常起点（预置知识库已退役，内容由用户剪藏/导入产生），不是 bug。

跑起来看窗口：

```sh
cd apps/android
./gradlew :desktop:run          # 需要图形会话；测试用 headless，不进 CI 的窗口路径
./gradlew :desktop:test         # 只需 JDK 17——**不需要 Android SDK**
```

## 打包与发布（一套开发，多处发布）

```sh
cd apps/android
./gradlew :desktop:packageDmg   # macOS → build/compose/binaries/main/dmg/*.dmg（实测 65 MB）
./gradlew :desktop:packageMsi   # Windows（要在 Windows 上跑）
./gradlew :desktop:packageDeb   # Linux（要在 Linux 上跑）
./gradlew :desktop:createDistributable   # 免安装的应用目录（三端都可用、无需额外打包工具）
```

**jpackage 不支持交叉编译**：三个包必须在各自系统上构建。发布不做三份配置，而是
[desktop.yml](../../../.github/workflows/desktop.yml) 一份配置跑三台 runner，各自出包后统一命名附到同一个 Release
（tag `desktop-v*`）。那个 workflow **刻意不装 Android SDK**，等于在 CI 上再证一次
「桌面端独立于 Android 工具链」。

打包时踩到的两条真实约束（都已写进注释，别当成配置错误）：

1. **只有 macOS 的包版本要求 MAJOR > 0**（CI 实测：Windows/Linux 直接用产品版本 `0.1.0` 正常出包）——
   macOS 会被 `0.1.0` 直接拒绝，所以 `macOS { packageVersion = "1.0.0" }` 是**打包器别名**；
   对外一律用产品版本（tag、Release、附件名都用 `0.1.0`，发布流程里统一改名）。
   三端产物命名因此不同：`KnowFlick-0.1.0.msi` / `knowflick_0.1.0-1_amd64.deb` / `KnowFlick-1.0.0.dmg`。
2. **JDK 厂商检查** —— Compose 只认 Temurin/Corretto/Zulu，开发机的 Homebrew openjdk@17 会被拒；
   `gradle.properties` 里为此关掉了检查，**但对外产物一律由 CI 用 Temurin 构建**，避免把开发机的
   运行时打进包里。
3. **安装器元数据必须纯 ASCII** —— jpackage 用平台默认字符集读自己的 `@argfile`，Windows runner
   的 cp1252 遇到中文直接抛 `Input length = 1`（MalformedInputException），MSI 构建失败（实测踩过）。
   所以 `description` 用英文；**同理，Windows 机器上的仓库路径也避免中文**（路径同样进 argfile）。
   中文只留在产品界面里，安装器文案等 jpackage 支持按端覆盖再补。

## 为什么暂驻 `apps/android/` 构建内

`apps/*/` 的约定是「一端一目录」，这里的安排是一个**有意的暂时取舍**：

- Compose Multiplatform 的 UI 共享要求共享模块**同时有 android 与 jvm 两个 target**，
  而 android target 必须在 Android 构建里编译（`:app` 要消费它）。所以共享代码天然长在
  `apps/android` 下；
- 宿主自己则既可以留在这个构建里（`project(":domain")` 零接线成本），也可以独立成
  `apps/desktop/` 自己的构建（走 composite build 或产物发布，版本可解耦）。

选型矩阵与实测见 [CMP 工具链对齐实验](../../../docs/windows-route/CMP_TOOLCHAIN_ALIGNMENT.md)。
**什么时候该挪**：当 Windows 端要独立发版、要自己的 CI 与打包流水线时，把宿主提升为
`apps/desktop/`（或 `apps/windows/`）并配自己的 workflow；届时共享模块仍留在
`apps/android`，两者通过 composite build / 产物契约相连。
