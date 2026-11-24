# 界面共享迁移（UI 抽取）：分档、进度与遇到的真实边界

> 目标见 [ADR-0001](../adr/0001-desktop-tri-platform-shared-kotlin.md)：Windows / macOS / Linux + Android
> 四端共用一份界面。本文件记录**怎么判定哪些文件能搬、已经搬了什么、搬的时候撞到了什么**。
>
> 分析工具：`python3 tools/classify_ui_portability.py`（可复现，非印象判断）。

## 1. 判定方法

对 app 模块每个 `.kt` 文件算两件事：

1. **自身平台信号**——`android.*` / `androidx.activity|core|security|glance` import，以及
   Android 专有的 Compose / 框架 API（`LocalContext`、`stringResource`、`R.*`、`painterResource`、
   `Toast`、`Intent`、`Bitmap`、`BackHandler`、Glance、`EncryptedSharedPreferences`…）；
2. **依赖闭包**——import 解析 + **同包无 import 的直接符号引用**（同包引用不带 import，
   只看 import 会大面积漏判），然后取不动点：闭包里只要有一个平台文件，整个闭包都不能搬。

分档：**A** = 闭包干净可直接进共享模块；**B** = 自身干净但被平台文件拖累（搬它得先搬/抽象那个文件）；
**C** = 自身就有平台信号。

> 工具的第一版把函数体内的局部量（`val path = …`）和函数参数误当成包级符号，制造了大量假依赖
> （`AppIcons` 被误判成依赖 `BackgroundImage`，只因两边都有个叫 `path` 的局部量）。只认**从第 0 列
> 开始**的行修掉了它，A 档从 12 文件 1720 行变成 27 文件 5196 行。
>
> 第二版又发现另一个更隐蔽的假信号：把 `java.io.File` 也当成平台信号。**`java.*` 不是平台信号**——
> 它只是不能进 `commonMain`，放进 `jvmAndAndroidMain` 完全合法。这个假信号把整个 `data/` 持久化层
> （`CardStorage` 等）错判成不可搬，直到真要动手做 `:shared-data` 时才暴露（那个模块 4 个文件
> 一行未改就共享成功）。修正后 A 档的含义明确为：**无需平台改造即可搬入共享模块，含 `java.*` 的
> 落 `jvmAndAndroidMain`、不含的落 `commonMain`**。

## 2. 分档结果

当前（`:shared-ui` 已迁 12 文件、`:shared-data` 已迁 7 文件、五条平台接缝落地之后）：

| 档 | 文件数 / 行数（app 模块剩余） |
| --- | --- |
| **A**（可直接搬） | 9 文件 / 793 行 |
| **B**（被平台文件拖累） | 3 文件 / 777 行 |
| **C**（自身带平台信号） | 24 文件 / 8171 行 |

**每次抽掉一条平台边界，都会有一片文件从 B/C 升到 A**：底图接缝解锁了 `CardFace`，
日期接缝解锁了 `StatsScreen`（825 行，本次已迁），系统返回外移解锁了 `LibraryScreen` / `QuizScreen`。
B 档从最初的 8 个降到 3 个。

> 工具本身修过三次假信号/漏检：① 函数内局部量被当成包级符号（假依赖）；
> ② `java.io.File` 被当成平台信号（把整个 `data/` 误判成不可搬）；
> ③ **`BackHandler` 漏检**——它常以全限定调用出现（`androidx.activity.compose.BackHandler { … }`，
> 没有 import 也没有括号），于是 `StatsScreen` 被误判成可搬、搬进去才编译失败。
> 教训：**分档只是筛子，编译才是裁判**；每次搬迁都要真编译两端。

## 3. 已经搬进 `:shared-ui` 的（本次，6 个生产文件 2365 行）

| 文件 | 行数 | 源集 | 说明 |
| --- | ---: | --- | --- |
| `ui/QuizScreen.kt` | 833 | jvmAndAndroidMain | 整屏，参数是纯领域类型 + 回调（无 ViewModel 依赖） |
| `ui/AppIcons.kt` | 668 | commonMain | 手写矢量图标 |
| `ui/LibraryScreen.kt` | 326 | jvmAndAndroidMain | 整屏，同上 |
| `ui/common/MarkdownTextRenderer.kt` | 297 | commonMain | Markdown 行内渲染 |
| `ui/stats/LearningHeatmap.kt` | 214 | jvmAndAndroidMain | 学习热力图 |
| `data/CategoryStampColor.kt` | 27 | jvmAndAndroidMain | 四领域印章色（随 Quiz/Library 一起搬） |

加上更早的 `Theme.kt`(150) 与 `KnowledgeCardTeaser.kt`(55)，`:shared-ui` 现有 8 个生产文件 **2578 行**。

**桌面宿主现在直接渲染 `LibraryScreen`**（与 Android 端同一份 Compose 代码），不再是自搭的临时界面。

## 4. 迁移时撞到的四类真实边界（都会在后续批次反复出现）

### 4.1 系统返回必须外移到宿主

`androidx.activity.compose.BackHandler` 桌面不存在，CMP 1.8.2 也**没有**公共替代
（实测 `ui-desktop-1.8.2.jar` 里只有 `backhandler/DesktopBackGestureDispatcher` 内部类，没有公开的
`BackHandler` composable）。处理办法：共享界面只暴露 `onBack` / `onExit` 回调，
**由 Android 宿主在调用点包一层**（见 `MainActivity.kt` 的两处）。语义上也更对：系统返回是宿主的事。

> 替代方案是 `expect/actual` 包一层 `PlatformBackHandler`。没选它是因为这两处调用点都在宿主里，
> 包一层等于把宿主已经知道的事再抽象一遍。等出现**共享界面内部**需要响应返回的场景再上 expect/actual。

### 4.2 多平台 Material 图标在 1.8+ 不存在

`org.jetbrains.compose.material:material-icons-*` 最后一次发布是 **1.7.3**；androidx 侧
`androidx.compose.material:material-icons-core` 只到 1.7.8 且**没有 `-desktop` 变体**（实测 404）。
已迁界面里有 6 处 `Icons.*`，因此 `:shared-ui` 暂时钉 `material-icons-core:1.7.3`
（纯 ImageVector 定义，与 1.8.2 运行时不冲突）。
**技术债**：改为手写进 `AppIcons`（本模块已有该模式）即可去掉这个停更依赖。

### 4.3 含 `java.*` 的界面文件放 `jvmAndAndroidMain`

与 `:domain` 同一约定：`LibraryScreen`（`SimpleDateFormat`/`Date`）、`LearningHeatmap`（`java.time`）、
`CategoryStampColor`（`synchronized`）都落在中间源集；纯 Compose 的 `AppIcons` / `MarkdownTextRenderer`
放 `commonMain`。理由与陷阱见 [KMP 探针结果](KMP_PROBE_RESULT.md)。

### 4.4 包名不变 = import 零改动

搬走的文件全部保持 `com.knowflick.app.*` 原包名，因此 app 侧**没有一行 import 改动**
（`Theme.kt` 迁移时 24 个引用文件零改动，本次 6 个文件同理）。这是分批平移的前提。

## 5. 下一批建议（按价值 / 风险排序）

> 注：`:shared-data` 已经把持久化层与归档引擎搬走（`CardStorage` / `ArchiveImportManager` /
> `CardArchiveEngine` / `CardExportEngine`），所以 app 侧 `data/` 只剩与平台强相关的
> `ShareFileWriter` / `SystemCredentialStore` / `WebClipFetcher` / `ChatSessionStorage`。

1. **抽象 `ui/LearningDay.kt`** → 一次解锁 `StatsScreen`(825) 与 `ui/stats/*`；
2. **`BackgroundImage` 的桌面实现**（expect/actual：Android 读 assets，桌面读文件/classpath）
   → 解锁 `CardFace.kt`(281) 与整个刷卡页视觉；
3. **`ai/*` 约 1100 行**：已是 A 档，按内容归属搬到 `:domain`（AI 提示词与服务属逻辑层）
   或 `:shared-data`；
4. **平台动作继续抽象**：文件选择/归档导入导出已落地（见下），还剩**底图资源、剪贴板、
   系统分享、Toast**；这些是 `SettingsScreen` / `DetailScreen` 等屏的解锁条件；
5. **安装包图标**：三端各需 `.icns` / `.ico` / `.png`。美术源已挪到 `shared/icons/AppIcon.iconset/`，
   `tools/generate_app_icons.py` 一路派生；`apps/workbench`（第一套桌面）另有自己的
   `npx tauri icon` 产物。要避免的是同一张美术手工维护出多份。

> **2026-10-13 注**：本文件记录的是 [ADR-0001](../../adr/0001-desktop-tri-platform-shared-kotlin.md)
> 那条「桌面与安卓共用一份 Kotlin 界面」路线的迁移过程。该路线已由
> [ADR-0002](../../adr/0002-desktop-web-split-from-android.md) 替代（桌面第一套改走 `apps/workbench`
> 的 Web 界面），下面的推进计划与分档表**只作过程记录**；已落地的共享代码仍被 Android 与冻住的 `:desktop` 使用。

## 7. 平台动作（B 档第一块，已落地）

归档导入/导出这条线已经打通，形状是「**共享引擎 + 各端只做 IO 边界**」：

| 层 | 内容 | 位置 |
| --- | --- | --- |
| 共享 | ZIP/JSON 探测、预览构造、合并策略、Markdown/JSON/TSV/ZIP 导出 | `:shared-data` 的 `ArchiveImportManager` / `CardArchiveEngine` / `CardExportEngine` |
| Android | SAF `Uri` → 字节；`Intent` 分享 | `:app` 的 `AndroidArchiveReader` / `ShareFileWriter` |
| 桌面 | AWT 文件对话框 → 字节；「另存为」代替系统分享 | `:desktop` 的 `DesktopFileDialogs` |

桌面端因此**第一次能真正把卡片放进来**（此前只能看空库）。两端跑的是同一份探测与合并实现——
新增平台时照这个形状接 IO 即可，**不要复制引擎**。

### 7.1 另外两条接缝：触觉与底图

| 接缝 | 共享侧 | Android 实际实现 | 桌面实际实现 |
| --- | --- | --- | --- |
| 触觉反馈 | `PlatformHaptics` + `rememberPlatformHaptics()` | `androidMain`：包住原来的 `HapticFeedbackHelper`（API 29+ `VibrationEffect` 预设，**行为不变**） | `jvmMain`：`NoOpPlatformHaptics`（桌面无触觉） |
| 分类底图 | `rememberBackgroundImage(key)` / `PreloadBackgroundImage(key)` | `androidMain`：assets + `BitmapFactory` + `LruCache`（原实现整体搬入） | `jvmMain`：classpath 资源 + Skia 解码 + 内存缓存 |
| 轻量提示 | `Notifier` / `LocalNotifier`（**宿主提供的 CompositionLocal**，默认静默） | 宿主用 `ProvideToastNotifier { … }` 包根内容 → 系统 Toast | 宿主把 `LocalNotifier` 指向自己的通知条（`state.showNotice`） |
| 系统返回 | `PlatformBackHandler(enabled) { … }` | `androidMain`：转给 `androidx.activity.compose.BackHandler` | `jvmMain`：no-op（桌面没有系统返回，屏内返回按钮才是路径） |
| 界面音效 | `PlatformSounds`（滑纸 / 翻卡 / 掌握提示 / 点击） | `androidMain`：包住原 `AudioEffectHelper`（`AudioTrack` 合成音，行为不变） | `jvmMain`：no-op（桌面暂未设计音效） |
| 「今天」快照 | `LearningDay` + `rememberLearningDay()`（`internal`，仅统计页用） | `androidMain`：`ACTION_DATE_CHANGED` / `TIME_CHANGED` / `TIMEZONE_CHANGED` 广播 + 回到前台 + 到午夜定时（原实现；`ContextCompat.registerReceiver` 换成手写 API 33 分支，少引一个依赖） | `jvmMain`：30 秒轮询（桌面没有日期变更广播；睡眠唤醒最多晚 30 秒） |

### 7.2 两个「不搬也能共享」的形态

详情页（`DetailScreen` 446 行）迁进 `:shared-ui` 时，用了两种比「抽 expect/actual」更轻的手法：

| 手法 | 用在什么上 | 做法 |
| --- | --- | --- |
| **公共 API 直接消解** | 打开外链、触觉反馈 | `LocalUriHandler` / `rememberPlatformHaptics()` 都是 CMP 公共面：Android 自动走 `Intent`、桌面走系统浏览器；**共享屏里一行平台代码都不需要** |
| **宿主槽位（slot）** | 聊天 Sheet(844)、海报 Sheet(371)、桌面微件（`AppWidgetManager`） | 共享屏只负责「什么时候显示/触发」，能力由宿主以 `chatSheet` / `posterSheet` / `onAddWidget` 参数注入（`null` = 该端没这个能力；菜单项或面板自然不出现）。Android 传它的实现，桌面不传——**因此迁详情页与刷卡页都不必连带搬平台专属功能**（合计省下 1215+ 行） |

**槽位的配套约定**：Sheet 展开时系统返回要让位给 Sheet。共享屏不再自己用 `androidx` 的 `BackHandler`，
而是用 **`PlatformBackHandler(enabled = …)` 接缝**自己声明（详情页据此在浮层展开时让位）。

> 约定演进（值得记一笔）：最初的做法是**把返回语义外移到宿主**（每个屏在 `MainActivity` 调用点再包一层
> `BackHandler`）。搬到第五个屏时它的代价显出来了：一个屏的返回语义被拆到两个文件里，宿主越写越厚，
> 且每迁一个新屏都要记得去改宿主。后来补上 `PlatformBackHandler` 接缝（与触觉/音效同一形态）后，
> 五处宿主包装与 `onOverlayVisibilityChanged` 回调全部删除——**接缝 > 外移**，因为前者让组件自洽。

另外顺手把「延伸阅读」的推荐打分从 Android 调用点抽进 `:domain`（`RelatedCards`，5 项表征测试）——
否则桌面详情页就得把同一套打分逻辑再写一遍。

### 7.3 一道分层选择题：界面要用的数据描述类型放哪

迁 `ImportRestoreDialog`(288) 时撞见一个分层问题：它要 `ArchivePreview` / `RestoreStrategy`，
而这两个类型定义在 `:shared-data`，可 `:shared-ui` 只依赖 `:domain`（**UI 不依赖持久化层**，这个分层是刻意的）。

两种解法，选了后者：

| 解法 | 代价 |
| --- | --- |
| 让 `:shared-ui` 依赖 `:shared-data` | 为一个对话框破掉分层，之后 UI 会顺手用更多持久化类型 |
| **把「描述类型」移到 `:domain`**（本次采用） | 只动 5 个引用点：类型本身零 IO（`ArchivePreview` 只是卡片数/分类统计/解析出的卡片），引擎仍留在 `:shared-data` |

判据：**类型属于哪一层，看它描述什么，而不是看谁最先用到它**。「归档里有什么」是领域描述，
「怎么从字节解析出它」是持久化实现——于是前者进 `:domain`，界面与引擎都能用，分层不破。

### 7.4 共享代码里**不要硬编码 `Dispatchers.Main`**

迁 `ChatStateHolder`（会话流式编排）时踩到一个只有真跑起来才会露出的坑：它写死了
`scope.launch(Dispatchers.Main)` / `withContext(Dispatchers.Main)`。这在 Android 上没问题，
但在纯 JVM（桌面宿主、单测）里**没有 Main 调度器**，`withContext(Dispatchers.Main)` 直接抛
`Module with the Main dispatcher had failed to initialize`——表面症状极具误导性：
**回答内容已经流出来了，`isStreaming` 却永远不结束**（因为把标志位置 false 的那段恰好在 Main 上）。

修法不是「各端各抄一份」，而是**把调度器变成构造参数**：默认值保持 `Dispatchers.Main`（Android 行为不变），
桌面/测试注入自己的。同类问题要一起想：`Dispatchers.Main`、`Dispatchers.IO`（JVM 有，Native 没有）、
系统时钟、默认时区——**共享代码只该依赖注入进来的执行环境**。

### 7.5 一类「看着能搬、其实搬不了」的界面：自己画布

`ui/graph/KnowledgeGraphScreen.kt`(833) 的分档理由是 `LocalContext`，把触觉/音效换上接缝后看起来可以整屏搬走——
实际编译才发现它用 **`android.graphics.Paint` 做文字测量**（全限定写法，没有 import）：

```kotlin
val labelPaint = remember { android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG) }
```

这类「自己开画布 + 用平台绘图 API 量文字」的界面**不是接缝能解决的**：要么改用 Compose 的
`TextMeasurer`/`DrawScope`（真迁移），要么留在各端。教训：分档工具补了「全限定 Android 调用」检测，
但**最终判定仍然只能靠真编译**——这次是编译器先发现的。

底图的**图片来源仍是仓库根 `shared/assets`**：Android 经 `assets.srcDirs` 直读，桌面经
`resources.srcDir` 打进 jar——两端同布局（`bg/<key>.webp`）、零副本。桌面侧已实测能解出
`bg/ai.webp`（`:desktop:test` 的 `resolvesBackgroundImageFromBundledSharedAssets`）。

**为何先做这两条而不是直接搬详情页**：`DetailScreen`(446) 还渲染着 `CardFollowUpChatSheet`(844)
与 `CardPosterExportSheet`(371)，三者串起来是一次 1600+ 行的迁移；而触觉与底图是所有卡片视觉
（刷卡页、详情页、海报）的**共同前置**，先做它们能让后续每一屏都少一道坎。

## 6. 复现

```sh
python3 tools/classify_ui_portability.py            # 分档 + 已迁清单
python3 tools/classify_ui_portability.py --json     # 落 .scratch/ui-extraction/classification.json

cd apps/android
./gradlew :shared-ui:jvmTest :desktop:test          # 共享界面在桌面 JVM 上离屏渲染（只需 JDK 17）
./gradlew :app:testDebugUnitTest :domain:jvmTest :shared-ui:jvmTest :desktop:test :app:lintDebug
```
