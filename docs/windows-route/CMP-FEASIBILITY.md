# Compose Multiplatform（CMP）路线可行性调研报告

- 调研对象：`apps/android`（Kotlin + Jetpack Compose）
- 调研方式：只读，全部数字来自实际命令输出（`find` / `wc -l` / `grep`）
- 调研时间：2026-10-10
- 结论口径：**是否值得把 Android 的 domain 层抽成独立 Kotlin 模块 + desktop target，UI 走 Compose Desktop**

---

## 摘要（先说结论）

1. **domain 层是干净的**：19 个文件、0 个 `import android.*`，也没有 coroutines / IO / Context 依赖。取值只用 `java.time` / `java.util` / `System.currentTimeMillis`。这是本仓库最有利的一条事实。
2. **真正的工作量不在 domain，在 UI 与平台绑定**：UI 26 文件 12258 行，其中 12 文件 5507 行含平台调用（`LocalContext`/`Toast`/`Intent`/`Bitmap` 等），但这些文件的调用点密度很低（例：843 行的 `CardFollowUpChatSheet` 只有 6 处平台调用），本质是「大片纯 Compose + 少量平台粘合」。
3. **工具链版本是硬前置，也是最大风险**：项目 Kotlin 2.0.21 / Compose BOM 2025.06.00 / Gradle 8.11.1。CMP 1.8.0 起要求 Kotlin ≥ 2.1.0，而与本项目 Kotlin 匹配的 CMP 1.7.3 内核只到 Jetpack Compose 1.7.6 —— 与当前 BOM 不对齐。**必须先解决 Kotlin ↔ CMP ↔ Compose BOM 的三方版本对齐，这一步无法绕过。**
4. **粗估**：完整 Windows 端首版 **30–52 人日**（单人），砍掉桌面微件与海报导出后约 **22–35 人日**。其中「平移即可」的纯逻辑约 7.7k 行只占 3–5 人日，成本大头在工具链与平台抽象层。

---

## ① 模块结构与代码量

### 1.1 Gradle 模块

`apps/android/settings.gradle.kts`：

```kotlin
rootProject.name = "KnowFlick"
include(":app")
include(":baselineprofile")
```

- 实质是 **单模块 app**（`apps/android/app`）+ 一个 baseline profile 采集模块（`com.android.test`，非应用代码）。
- **没有 `gradle/libs.versions.toml`**（已确认：`find . -name "*.toml" -not -path "*/build/*"` 无输出）。版本内联在根 `build.gradle.kts`（插件）与 `app/build.gradle.kts`（依赖）。
- **全仓无任何 KMP 配置**：`grep -rn 'kotlin("multiplatform")\|org.jetbrains.kotlin.multiplatform' --include=*.kts --include=*.toml` 无输出。

### 1.2 代码量（主源码 `app/src/main/kotlin/com/knowflick/app`）

命令：`find <pkg> -name "*.kt" -exec wc -l {} + | tail -1`（逐文件加总交叉校验一致）

| 包 | 文件数 | 行数 | 职责 |
| --- | ---: | ---: | --- |
| `domain/` | 19 | 4141 | 卡片模型、卡库状态机、学科体系、学习范围、统计、搜索、图谱、间隔重复、网页剪藏抽取 |
| `domain/graph/` | (1) | 452 | 已含于上行（`KnowledgeGraphEngine.kt`） |
| `domain/search/` | (2) | 461 | 已含于上行（`KnowledgeSearchEngine.kt` 290 + `PinyinHelper.kt` 171） |
| `domain/spaced/` | (2) | 314 | 已含于上行（`SpacedRepetitionEngine.kt` 185 + `FsrsEngine.kt` 129） |
| `data/` | 13 | 1468 | 落盘（cards.json / 原子写 / 备份轮转）、归档导入导出、凭据存取、剪藏网络出口 |
| `ui/` | 26 | 12258 | 全部界面（含 `ui/common`、`ui/sync`、`ui/clip`、`ui/graph`、`ui/map`、`ui/stats`） |
| `net/` | 1 | 28 | OkHttp ↔ 协程桥接 |
| `widget/` | 5 | 536 | Jetpack Glance 桌面微件 |
| `speech/` | 7 | 1535 | TTS/播放控制、前台服务、远程音色、档位 |
| `ai/` | 8 | 1138 | AI 服务、提示词、供应商预设、扫描/解析 |
| `sync/` | 3 | 609 | 局域网同步（裸 ServerSocket/Socket） |
| `export/` | 5 | 1102 | 海报渲染、归档导出、二维码编码 |
| 根包 | 4 | 1840 | `KnowFlickViewModel.kt` 1088 / `MainActivity.kt` 526 / `ChatStateHolder.kt` 199 / `VersionedMemo.kt` 27 |
| **合计** | **91** | **24655** | |

测试：`app/src/test` 49 文件 6327 行（其中 domain 相关 2850 行）、`app/src/androidTest` 6 文件 756 行。

### 1.3 最大单文件（前 12，行数）

| 文件 | 行数 | 平台绑定 |
| --- | ---: | --- |
| `KnowFlickViewModel.kt` | 1088 | Android（`AndroidViewModel` + `Application.filesDir` + `Uri`） |
| `ui/DeckScreen.kt` | 1050 | 少量（`Toast` + `LocalContext`，2 处） |
| `ui/SearchSheet.kt` | 941 | 无（仅 `BackHandler`） |
| `ui/CardFollowUpChatSheet.kt` | 843 | 少量（`Toast` + 剪贴板） |
| `ui/QuizScreen.kt` | 833 | 无（仅 `BackHandler`） |
| `ui/graph/KnowledgeGraphScreen.kt` | 832 | 少量（触觉/音效 helper 调用） |
| `ui/StatsScreen.kt` | 824 | 无（仅 `BackHandler`） |
| `ui/AudioConsoleSheet.kt` | 792 | 无（仅 `BackHandler`） |
| `domain/WebClipEngine.kt` | 773 | **无** |
| `speech/SpeechController.kt` | 772 | **重**（MediaPlayer + TextToSpeech + PlaybackParams） |
| `ui/AppIcons.kt` | 668 | 无 |
| `domain/CardStore.kt` | 597 | **无** |

---

## ② domain 层纯度结论

### 2.1 逐文件判定（命令：逐文件 `grep -c '^import android\.'`）

| 文件 | 行数 | `import android.*` | `androidx.compose.runtime.Immutable` | JVM API |
| --- | ---: | ---: | ---: | --- |
| `WebClipEngine.kt` | 773 | 0 | 0 | `java.nio.charset.Charset` |
| `CardStore.kt` | 597 | 0 | 0 | `System.currentTimeMillis`, `UUID` |
| `graph/KnowledgeGraphEngine.kt` | 452 | 0 | **4** | `java.util.Arrays`, `java.util.Collections` |
| `search/KnowledgeSearchEngine.kt` | 290 | 0 | 0 | 0 |
| `CardJson.kt` | 269 | 0 | 0 | `java.time.Instant`, `DateTimeParseException`, `System.currentTimeMillis` |
| `CardThemeResolver.kt` | 206 | 0 | 0 | `java.util.concurrent.ConcurrentHashMap` |
| `spaced/SpacedRepetitionEngine.kt` | 185 | 0 | 0 | `java.time.{Instant,LocalDate,ZoneId}`, `ChronoUnit` |
| `SubjectRegistry.kt` | 184 | 0 | 0 | **0** |
| `StudyScope.kt` | 182 | 0 | 0 | **0** |
| `search/PinyinHelper.kt` | 171 | 0 | 0 | `java.util.Collections`, `LinkedHashMap` |
| `QuizSession.kt` | 146 | 0 | 0 | `java.time.LocalDate` |
| `spaced/FsrsEngine.kt` | 129 | 0 | 0 | `System.currentTimeMillis` |
| `Card.kt` | 127 | 0 | **3** | `System.currentTimeMillis`, `UUID` |
| `LearningPlan.kt` | 122 | 0 | 0 | `java.time.{Instant,LocalDate,ZoneId}` |
| `CategoryRegistry.kt` | 110 | 0 | 0 | **0** |
| `StatsCalculator.kt` | 109 | 0 | 0 | `java.time.{Instant,LocalDate,ZoneId}` |
| `CardArrange.kt` | 70 | 0 | 0 | **0** |
| `Tombstone.kt` | 11 | 0 | 0 | **0** |
| `CardTextUtils.kt` | 8 | 0 | 0 | **0** |
| **合计** | **4141** | **0** | 7（2 文件） | 12 文件 |

**完整 import 证据**（`grep -rhE '^import ' domain | sort | uniq -c | sort -rn` 的归集结果）：

- `java.time.*`：`Instant`(4) / `LocalDate`(4) / `ZoneId`(3) / `ChronoUnit`(1) / `DateTimeParseException`(1)——**5 文件**（`LearningPlan`、`QuizSession`、`StatsCalculator`、`CardJson`、`spaced/SpacedRepetitionEngine`）
- `java.util.*`：`Collections`(2) / `LinkedHashMap`(1) / `Arrays`(1) / `UUID`（全限定调用 3 处）——**6 文件**
- `java.util.concurrent.ConcurrentHashMap`(1)
- `java.nio.charset.Charset`(1，`WebClipEngine.kt:592`)
- `System.currentTimeMillis()`：5 文件（`Card`、`CardStore`、`CardJson`、`FsrsEngine`、`SpacedRepetitionEngine`）
- `kotlinx.serialization.*`：38 处（`CardJson.kt` 主导）
- `androidx.compose.runtime.Immutable`：7 处（`Card.kt` 3 + `graph/KnowledgeGraphEngine.kt` 4）
- `kotlin.math.*`：8 处
- **`android.*`：0 处**
- **`kotlinx.coroutines.*`：0 处**
- **反向依赖 0**：`grep -rn 'com.knowflick.app.(data|ui|ai|sync|speech|widget|export|net)' domain` 仅命中一条**注释**（`CardStore.kt:31` 的 KDoc 提到装配方是 `CardStorage`），无实际 import。domain 对持久化完全无依赖 —— 由装配方注入。

**合计：19 个 domain 文件中，12 个含 JVM 专有 API（`java.*` 或 `System.currentTimeMillis`），7 个完全零 JVM API**：`CardArrange`、`CardTextUtils`、`CategoryRegistry`、`StudyScope`、`SubjectRegistry`、`Tombstone`、`search/KnowledgeSearchEngine`。

> 复核命令：`grep -rLE "java\.(time|util|nio|io)\.|System\.currentTimeMillis|System\.nanoTime" domain --include="*.kt"` → 7 文件命中。
> 含 JVM API 的 12 个：`Card`、`CardStore`、`CardJson`、`CardThemeResolver`、`LearningPlan`、`QuizSession`、`StatsCalculator`、`WebClipEngine`、`graph/KnowledgeGraphEngine`、`search/PinyinHelper`、`spaced/FsrsEngine`、`spaced/SpacedRepetitionEngine`。

### 2.2 domain 纯度结论

- **domain 是「纯 JVM Kotlin」，不是「纯平台无关 Kotlin」**。它没有 Android 框架依赖，但使用了 JVM 专有的 `java.time` / `java.util`。
- `androidx.compose.runtime.Immutable` **不构成阻碍**：它是 Compose Runtime 的通用注解，在 CMP 的 `commonMain` 中可用（`androidx.compose.runtime` 本身是共通 API）。
- **`androidx.compose.runtime` 之外，domain 对 Compose 零依赖**，对 IO 零依赖（`WebClipEngine` 是纯字节/字符串处理，`WebClipFetcher` 才碰网络）。
- 因此 domain 可以直接进 `commonMain`，**前提是双 target（`androidTarget` + `jvm`）下 `java.*` 可用**。这一点是本次调研**唯一需要实测的关键假设**：
  - Kotlin 官方文档明确写着 *"Kotlin doesn't currently support sharing a source set for these combinations: ... JVM + Android targets"*（[multiplatform-hierarchy](https://kotlinlang.org/docs/multiplatform/multiplatform-hierarchy.html)，版本日期 2026-10-01）。
  - 但实践中 `jvmAndAndroid` / `jvmCommonMain` 这类中间源集被 androidx 自己大量使用（如 `datastore-core/src/jvmAndAndroidMain/`），社区项目亦有（`src@jvmAndAndroid`）。
  - **判定：需实测**。安全路线有两条，任选其一：
    1. 把 `java.time` 换成 `kotlinx-datetime`（9 文件、约 25 处调用），`java.util.Collections/Arrays/LinkedHashMap/ConcurrentHashMap/UUID` 换成 Kotlin 标准库等价物 —— 之后 domain 可无条件进 `commonMain`；
    2. 保留 `java.*`，退到 `jvmMain` + `androidMain` 中间源集（workspace 内不共享到非 JVM 平台，Windows/macOS 桌面都是 JVM 后端，够用）。

---

## ③ 平台绑定清单

### 3.1 全仓 `android.*` 导入归集（命令：`grep -rhoE '^import android\.[a-z0-9._]+\.[A-Za-z0-9_]+' . | sort -u`，共 59 条）

分为六类：

| 类别 | 用到的 API | 所在包 / 文件 | 行数 |
| --- | --- | --- | ---: |
| **音频播放** | `android.media.MediaPlayer`, `PlaybackParams`, `AudioTrack`, `AudioFormat`, `AudioAttributes`, `AudioManager` | `speech/SpeechController.kt`、`ui/common/AudioEffectHelper.kt` | 772 + 235 |
| **语音 TTS** | `android.speech.tts.TextToSpeech`, `UtteranceProgressListener` | `speech/SpeechController.kt` | （同上 772） |
| **媒体播控/前台服务** | `android.app.Service`, `Notification`, `NotificationChannel`, `NotificationManager`, `PendingIntent`, `media.session.MediaSession`, `PlaybackState`, `MediaMetadata`, `os.IBinder` | `speech/SpeechPlaybackService.kt` | 400 |
| **加密存储** | `android.content.SharedPreferences` + `androidx.security.crypto.{EncryptedSharedPreferences,MasterKey}`（Android Keystore 支撑） | `data/SystemCredentialStore.kt` | 97 |
| **桌面微件** | `androidx.glance.*`（Glance AppWidget，生成 RemoteViews）+ `android.appwidget` 声明 | `widget/`（5 文件） | 536 |
| **系统集成（文件/分享/剪贴板/振动/位图）** | `content.Context`, `Intent`, `ClipData`, `ClipboardManager`, `ContentValues`, `net.Uri`, `provider.{MediaStore,OpenableColumns}`, `core.content.FileProvider`, `media.MediaScannerConnection`, `os.Environment`, `os.Vibrator(Manager)`, `os.VibrationEffect`, `graphics.{Bitmap,BitmapFactory,Canvas,Paint,...}`, `text.{Layout,StaticLayout,TextPaint}`, `util.LruCache`, `widget.Toast`, `content.BroadcastReceiver` | `export/`（3 文件）、`ui/`（12 文件）、`MainActivity.kt`、`KnowFlickViewModel.kt` | 772 + 5507 + 1614 |
| **无绑定（原生库）** | `androidx.glance` 之外无 | **`ai/` 8 文件 0 条 `android.*`**；`sync/` 0 条（裸 `java.net.Socket`）；`net/` 0 条 | — |

### 3.2 依赖清单与「天然平台绑定」判定

`app/build.gradle.kts` 关键依赖：

| 依赖 | 版本 | 跨平台可用性 |
| --- | --- | --- |
| `androidx.compose:compose-bom` | 2025.06.00 | Android 用 Google artifacts；desktop 用 `org.jetbrains.compose.*`，**需版本对齐** |
| `androidx.compose.material:material-icons-core` | (BOM) | ⚠️ **CMP 1.8.2 起不再传递依赖该库**，且 CMP 侧 `material-icons-core` 最后发布版本为 1.7.3 |
| `androidx.activity:activity-compose` | 1.13.0 | ❌ Android 专有（`setContent` / `BackHandler`） |
| `androidx.lifecycle:lifecycle-runtime-ktx` | 2.10.0 | ⚠️ 有 KMP 版 `lifecycle-viewmodel-compose`，当前用法（`AndroidViewModel`）需改 |
| `androidx.security:security-crypto` | 1.1.0 | ❌ Android 专有（已弃用，代码内有 TODO） |
| `androidx.glance:glance-appwidget` / `glance-material3` | 1.1.1 | ❌ Android 专有，Windows **无等价物** |
| `org.jetbrains.kotlinx:kotlinx-coroutines-android` | 1.9.0 | ✅ 换 `-core` 即多平台 |
| `org.jetbrains.kotlinx:kotlinx-serialization-json` | 1.7.3 | ✅ 多平台 |
| `com.squareup.okhttp3:okhttp` | 4.12.0 | ✅ JVM 库，桌面可用（非原生多平台，但 Windows 是 JVM 后端） |
| `androidx.baselineprofile`（`:baselineprofile` 模块） | 1.4.1 | ❌ Android 专有 |

**未使用的**：`androidx.work` / `WorkManager`（已确认 `grep` 无命中）；**无 Java 源码**；**无 View/XML 布局**（仅 5 个微件 `drawable` + 6 个 `xml/` 配置）；`R.string` 引用数为 **0**（7 条 strings.xml 仅服务微件），界面文案全部硬编码中文（90 个 kt 文件含中文）。

### 3.3 UI 层平台绑定比例（26 文件 12258 行）

判定规则：
- **CLEAN** = 无 `android.*` import、无 `LocalContext`、无 `Toast`/`Intent`/`Uri`、无 `getSystemService`
- **SOFT** = 仅 `androidx.activity.compose.BackHandler`
- **HARD** = 上述任一命中

| 类别 | 文件数 | 占比 | 行数 | 占比 | 文件 |
| --- | ---: | ---: | ---: | ---: | --- |
| **CLEAN** | 7 | 26.9% | 2226 | 18.2% | `AmbientAudioPlayerBar`, `AppIcons`, `CardFace`, `ImportRestoreDialog`, `Theme`, `common/MarkdownTextRenderer`, `stats/LearningHeatmap` |
| **SOFT** | 7 | 26.9% | 4525 | 36.9% | `AudioConsoleSheet`, `LibraryScreen`, `QuizScreen`, `SearchSheet`, `SettingsScreen`, `StatsScreen`, `clip/ClipSheet` |
| **HARD** | 12 | 46.2% | 5507 | 44.9% | `BackgroundImage`, `BackupExportSheet`, `CardFollowUpChatSheet`, `CardPosterExportSheet`, `DeckScreen`, `DetailScreen`, `LearningDay`, `common/AudioEffectHelper`, `common/HapticFeedbackHelper`, `graph/KnowledgeGraphScreen`, `map/LearningMapScreen`, `sync/SyncSheet` |

**UI 平台调用点总数**（`ui/` 目录内）：

| API | 调用点 |
| --- | ---: |
| `BackHandler` | 13（13 文件） |
| `LocalContext.current` | 12 |
| `Intent` | 8 |
| `Toast` | 5 |
| `getSystemService` | 4 |
| `Uri` | 3 |
| `context.startActivity` | 3 |

**HARD 12 文件的调用点密度**（关键：说明改动是「点状」而非「重写」）：

| 文件 | 行数 | 平台调用点 | 密度 |
| --- | ---: | ---: | --- |
| `ui/sync/SyncSheet.kt` | 503 | 17 | 1/30 行 |
| `ui/DeckScreen.kt` | 1050 | 14 | 1/75 行 |
| `ui/BackupExportSheet.kt` | 532 | 13 | 1/41 行 |
| `ui/CardPosterExportSheet.kt` | 370 | 10 | 1/37 行 |
| `ui/LearningDay.kt` | 65 | 10 | 1/6.5 行（整文件就是平台粘合） |
| `ui/graph/KnowledgeGraphScreen.kt` | 832 | 9 | 1/92 行 |
| `ui/DetailScreen.kt` | 446 | 8 | 1/56 行 |
| `ui/map/LearningMapScreen.kt` | 406 | 7 | 1/58 行 |
| `ui/BackgroundImage.kt` | 117 | 6 | 1/19.5 行 |
| `ui/CardFollowUpChatSheet.kt` | 843 | 6 | 1/140 行 |
| `ui/common/HapticFeedbackHelper.kt` | 108 | 4 | 整文件平台绑定（可降级 no-op） |
| `ui/common/AudioEffectHelper.kt` | 235 | 2 | 整文件平台绑定（可降级 no-op） |

**HARD 文件的平台调用高度集中**：`HapticFeedbackHelper` + `AudioEffectHelper`（343 行）被 `DeckScreen`、`graph`、`map`、`SyncSheet` 大量调用 —— 只要给这两个 helper 加一个「桌面 no-op 实现」，4 个 HARD 文件中大部分平台耦合立即消失。

### 3.4 Android 专有 Compose API 清单（CMP 桌面不可用）

| API | 使用点 | CMP 替代 |
| --- | ---: | --- |
| `androidx.activity.compose.BackHandler` | 13 处调用点 / 13 文件 | `org.jetbrains.compose.ui:ui-backhandler`（1.8.0-beta 起）；**CMP 1.7.3 无此模块** → 需自建 expect/actual 或升 CMP |
| `LocalContext` | 12 处 / 11 文件 | 平台能力注入（`expect`/`actual` 或接口 + 平台实现） |
| `LocalConfiguration.screenWidthDp` | 1 处（`DeckScreen.kt:172`） | `LocalWindowInfo.current.containerSize`（desktop） |
| `LocalClipboardManager` | 1 处（`CardFollowUpChatSheet.kt:100`） | CMP 1.7+ 已支持 |
| `LocalLifecycleOwner`（`androidx.lifecycle`） | 1 处（`LearningDay.kt:32`） | CMP 版 `lifecycle` 库或自行实现跨日刷新 |
| `enableEdgeToEdge` / `safeDrawingPadding` | `MainActivity.kt` | 桌面无意义，去掉 |
| `Icons.Filled.*` 等 15 个图标 | 16 文件 | CMP 1.8.2+ 需显式依赖或改手写（`AppIcons.kt` 已有手写 13 个的模式可复用） |

**注意**：`ui/AppIcons.kt` 已手写 13 个图标（`materialIcon()` builder），只有 15 个仍来自 `material-icons-core`（`ArrowBack`、`ArrowForward`、`Close`、`Refresh`、`Search`、`Share`、`Warning`、`AddCircle`、`Favorite`、`FavoriteBorder`、`MoreVert`、`Star` 等）—— 补齐成本极低（照抄现有 builder 即可）。

### 3.5 ⚠️ 直接平台 API ≠ 可平移（重要修正）

上面的 CLEAN/SOFT/HARD 只统计**文件自身**是否直接调用 Android API，不代表该文件能整体进 `commonMain`。还有一层**传递依赖**：若 UI 文件依赖了 Android 绑定模块中的类型，它同样无法共享。

`ui/` 对 Android 绑定模块的传递依赖：

| UI 文件 | 依赖的 Android 绑定类型 | 归属 |
| --- | --- | --- |
| `ui/ImportRestoreDialog.kt`（CLEAN） | `data.ArchivePreview`, `data.RestoreStrategy` | `data/ArchiveImportManager.kt`（含 `android.net.Uri` / `android.content.Context`） |
| `ui/AmbientAudioPlayerBar.kt`（CLEAN） | `speech.SpeechController` | `speech/SpeechController.kt`（MediaPlayer + TTS） |
| `ui/AudioConsoleSheet.kt`（SOFT） | `speech.SpeechController`, `SpeechChannel`, `SpeechPreset` | 同上（`SpeechPreset` 本身是纯的） |
| `ui/BackupExportSheet.kt`（HARD） | `export.ArchiveExportManager` | `export/ArchiveExportManager.kt`（MediaStore + FileProvider） |
| `ui/CardPosterExportSheet.kt`（HARD） | `export.CardPosterBitmapRenderer`, `PosterExportManager` | `export/`（Canvas + MediaStore） |
| `ui/clip/ClipSheet.kt`（SOFT） | `KnowFlickViewModel` | 根包（`AndroidViewModel` + `Application`） |

**因此「UI 可直接共享」的乐观上界是 CLEAN 7 + SOFT 7 = 14 文件 6751 行，但扣掉上述传递依赖后，第一轮真正能整体搬进 `commonMain` 的是**：

- `ui/Theme.kt`(150)、`ui/CardFace.kt`(280)（依赖 `domain.CardThemeResolver`/`CardSource`/`KnowledgeCard` — 全在 A 档）、`ui/AppIcons.kt`(668)、`ui/common/MarkdownTextRenderer.kt`(297)、`ui/stats/LearningHeatmap.kt`(214)（依赖 `domain.KnowledgeCard` + `ui.EditorialColor`）
- 加上 `ui/StatsScreen.kt`(824)、`ui/SearchSheet.kt`(941)、`ui/LibraryScreen.kt`(323)、`ui/QuizScreen.kt`(833)、`ui/SettingsScreen.kt`(534)（仅依赖 `domain.*` / `data.CategoryStampColor` / `ai.*` / `speech.SpeechSettings`，全在 A 档；只需处理 `BackHandler`）
- **≈ 10 文件 5064 行**可第一轮直接共享（占 UI 行数 41%）

其余 16 文件需先做 B 档抽象（`SpeechController` 接口化、`ArchivePreview` 等 DTO 下沉到共享模块、`ClipSheet` 依赖从 ViewModel 改为参数注入）。**这不改变总工作量量级，但改变实施顺序：必须先做 B 档，UI 才能成片搬迁。**


---

## ④ CMP 抽取工作量粗估

### 4.1 按「平移 / 抽象 / 各写」三档分类

#### A 档：**平移即可**（纯逻辑，改包名 + 源集搬迁 + 编译修正）

| 内容 | 文件数 | 行数 |
| --- | ---: | ---: |
| `domain/` 全部（19 文件） | 19 | 4141 |
| `data/` 纯逻辑 10 文件：`AppModel`(26), `CardStorage`(249), `CardFileIO`(61), `CardPersistenceQueue`(99), `CardArchiveEngine`(274), `CardExportEngine`(110), `ChatSessionStorage`(146), `CredentialStore`(接口,26), `WebClipFetcher`(113), `CategoryStampColor`(27) | 10 | 1131 |
| `ai/` 全部（0 条 `android.*`） | 8 | 1138 |
| `net/OkHttpAwait.kt` | 1 | 28 |
| `sync/` 全部（裸 Socket，JVM 库） | 3 | 609 |
| `speech/` 纯逻辑 5 文件：`RemoteSpeechClient`(74), `SleepFade`(36), `SpeechPreset`(81), `SpeechSettings`(85), `SpeechTextSegmenter`(87) | 5 | 363 |
| `export/` 纯逻辑 2 文件：`QrCodeEncoder`(299), `CardPosterStyle`(31) | 2 | 330 |
| **合计** | **48** | **7740** |

> 前提：`java.time` / `java.util` / `java.io` / `java.nio`（`Files`, `AtomicMoveNotSupportedException`）在双 JVM 后端可用 → **需实测**，或按 2.2 节方案一改 `kotlinx-datetime`。
> `data/CredentialStore.kt` 已是 interface + `InMemoryCredentialStore` 替身（好设计，无需改）。

#### B 档：**需要平台抽象层**（抽接口 + 两端实现）

| 内容 | 现有行数 | 说明 |
| --- | ---: | --- |
| 存储根目录注入 | — | Android `Application.filesDir` → Windows `%APPDATA%`。`CardStorage(baseDir: File)` 已是构造注入，改动小 |
| 凭据存储 | 97 | `SystemCredentialStore`（EncryptedSharedPreferences + Keystore）→ Windows DPAPI / Credential Manager |
| 剪藏 HTTP 出口 | 113 | OkHttp 桌面可用，但 UA 串硬编码 `Android 14; Pixel`（`WebClipFetcher.kt:23`）应按端区分 |
| 剪贴板 / 分享 / 文件选择 | ~20 处调用点（`grep -rnE "ClipboardManager|ClipData|FileProvider|startActivity|ACTION_VIEW\|ACTION_SEND\|Uri\." ` 命中 34 行，含 import 与注释） | `Intent` + `FileProvider` + `ACTION_VIEW`/`ACTION_SEND` + `ActivityResultContracts.OpenDocument` → 桌面各写；`ClipData`/`ClipboardManager` → CMP `LocalClipboardManager` |
| TTS / 播放控制 | 772 | `SpeechController` 的 TTS 通道需 `expect`/`actual`（Windows 无 `TextToSpeech` 等价物，需接 SAPI 或第三方）；音量/倍速/淡出逻辑可共享 |
| 触觉 / 音效 | 343 | 桌面可直接 no-op 降级（成本极低），或 Windows 接 XInput 震动（不建议） |
| **合计** | **~1300–2500** | 视抽象粒度 |

#### C 档：**必须两端各写**

| 内容 | 文件数 | 行数 | 原因 |
| --- | ---: | ---: | --- |
| `speech/SpeechPlaybackService.kt` | 1 | 400 | 前台 Service + `MediaSession` + 通知栏播控，Windows 需完全不同实现（SMTC / 托盘控制） |
| `export/CardPosterBitmapRenderer.kt` | 1 | 517 | `android.graphics.Canvas` + `text.StaticLayout`。**建议统一改写到 Compose `Canvas`/`DrawScope`** —— 这样反而变成 A 档共享 |
| `export/{ArchiveExportManager,PosterExportManager}.kt` | 2 | 255 | `MediaStore` + `FileProvider` + `MediaScannerConnection` → Windows 用 `SHFileOperation` / 直接写文件 |
| `widget/`（5 文件） | 5 | 536 | **Jetpack Glance 在 Windows 上无等价物** —— 建议 Windows 端直接不做，或改做托盘/置顶小窗 |
| `MainActivity.kt` + `KnowFlickViewModel.kt`（装配部分） | 2 | ~1614 | `AndroidViewModel` + `Activity` + `intent-filter`（分享接收入口）。ViewModel 的**业务逻辑**可大部分平移，`Application`/`Uri` 依赖部分各写 |
| `ui/` HARD 12 文件中的粘合部分 | 12 | 5507（其中纯 Compose 占绝大多数） | 按 3.3 的调用点密度，实际改写量估算 300–600 行 |
| `ui/common/{Haptic,AudioEffect}Helper.kt` | 2 | 343 | 整文件平台绑定（可由 B 档 no-op 覆盖） |
| **合计（可共享部分之外的净新增/重写）** | — | **~2000–3300** | |

### 4.2 人日粗估（单人，熟悉 Kotlin + Compose）

> ⚠️ 以下为**基于代码量的量级估算**，非实测。项目历史显示工具链升级曾多次被依赖锁卡住（见 `build.gradle.kts` 注释中 activity-compose 1.13 / lifecycle 2.10 的解锁记录、以及 `test/` 中 androidx.test 三件套「不升」的理由），因此阶段 2 的估算给了较宽区间。

| # | 阶段 | 人日 | 档位 |
| ---: | --- | ---: | --- |
| 1 | **KMP 模块创建**：新建 `:domain` / `:core` 模块，`androidTarget` + `jvm` 双 target，源集搬迁，双端编译通过 | 2–3 | 基础设施 |
| 2 | **工具链版本对齐**（最大风险）：Kotlin 2.0.21 → 2.1/2.2；CMP 版本选定；Compose BOM 对齐；`material-icons` 补齐；`BackHandler` 换 `ui-backhandler`；`Gradle 8.11.1` 与 KMP 插件兼容性 | **4–8** | 基础设施 |
| 3 | **纯逻辑平移**（A 档 7740 行）：包名/源集调整 + `java.time` 处理 + 测试迁移（domain 2850 行测试） | 3–5 | 平移 |
| 4 | **平台抽象层**（B 档）：路径、凭据、剪贴板/分享/文件选择、TTS 通道 | 5–8 | 抽象 |
| 5 | **UI 共享化**：SOFT 7 文件换 `BackHandler`；HARD 12 文件的平台调用抽成接口注入；`Haptic`/`AudioEffect` no-op 实现 | 6–10 | 抽象 |
| 6 | **Windows 端装配**：Compose Desktop `main`、窗口、导航壳（对齐 `MainActivity` 的 `Screen` 状态机）、字体与 DPI、jpackage/MSIX 打包 | 4–7 | 各写 |
| 7 | **桌面重写项**：TTS/SAPI 通道、播放控制（SMTC 或自建）、海报渲染统一到 Compose Canvas（可选） | 4–8 | 各写 |
| 8 | **测试与 CI**：`apps/wind` 接入 workflow、双端回归 | 2–4 | 基础设施 |
| | **合计** | **30–52** | |
| | **首版可用（砍掉微件；海报导出若不做）** | **22–35** | |

**若只做「domain 抽模块 + Android/Windows 共享」而不共享 UI**：约 **8–14 人日**（阶段 1–4 + 少量装配）—— 这是性价比最高的第一批交付，也是验证工具链风险的探针。

### 4.3 需实测项（无法从静态代码判定）

| # | 项 | 为什么需要实测 | 建议验证方式 |
| ---: | --- | --- | --- |
| 1 | `commonMain` 能否使用 `java.time` / `java.util` / `java.io.File`（当 target 仅为 `androidTarget` + `jvm`） | 官方文档称 JVM + Android 组合「不支持共享 source set」，但 androidx 自身在用 `jvmAndAndroidMain` | 搭一个双 target 的最小骨架模块，在 `commonMain` 里 `import java.io.File`，跑 `:domain:compileKotlinMetadata` / `:domain:build` |
| 2 | Kotlin ↔ CMP ↔ Compose BOM 的具体可行版本组合 | 项目 Kotlin 2.0.21 对应 CMP 1.7.3（Compose 1.7.6），而当前 BOM 2025.06.00（Compose 1.8.2）；CMP 1.8.0+ 要求 Kotlin ≥ 2.1.0 | 试三组：(a) 保 Kotlin 2.0.21 + CMP 1.7.3 + 降 BOM；(b) 升 Kotlin 2.1.x + CMP 1.8.x + 保 BOM；(c) 升 Kotlin 2.2.x + CMP 1.9.x。跑全量 JVM 测试（49 文件）判定 |
| 3 | Compose Desktop 上 `LocalConfiguration` / `LocalLifecycleOwner` / `LocalClipboardManager` 的实际可用性 | 官方「Android-only components」页把 `LocalConfiguration` 明确列为 Android 专有，但 `LocalClipboardManager` 在 1.7 已支持 | 在 desktop 源集编译上述 3 处调用点 |
| 4 | `ui/map/LearningMapScreen.kt`、`ui/graph/KnowledgeGraphScreen.kt` 的 `LocalContext` 是否只服务于 helper | 若只服务于 `HapticFeedbackHelper`/`AudioEffectHelper`，去掉后即变 CLEAN | 读 6 处调用点上下文（已抽样确认 graph 的 9 处全部是 helper 调用） |
| 5 | 本机构建环境 | `java` 不在 PATH（`which -a java` 仅 `/usr/bin/java` 报「Unable to locate a Java Runtime」）；实际可用 JDK 是 `/opt/homebrew/opt/openjdk@17` | 配置 `JAVA_HOME` 或让 Gradle 用 toolchain |

---

## 附录 A：现有 macOS 端作为参照

| 端 | 主源码文件 | 行数 | 语言/框架 |
| --- | ---: | ---: | --- |
| `apps/mac/Sources/KnowFlickCore` | 45 | 11355 | Swift（`Models/` 17 文件 4813 行） |
| `apps/mac/Sources/KnowFlick` | 45 | 17136 | SwiftUI |
| `apps/android/app/src/main/kotlin` | 91 | 24655 | Kotlin + Compose |

**关键背景**：`docs/CONTEXT.md` 明确记录 WebClipEngine 与 SubjectRegistry 是**双端逐条对齐**的（Swift ↔ Kotlin 各内嵌一份同表，由 parity 测试 + `tools/check_taxonomy.py` 守一致性）。**引入 Windows 端 = 第三份实现**，除非走 CMP 共享 —— 这是 CMP 路线最实质的收益点（`apps/mac` 是 Swift，无法被 CMP 覆盖，因此永远是「CMP 双端 + Swift 单端」的 2+1 结构）。

## 附录 B：CMP 路线的两个替代选项

| 路线 | 收益 | 成本 | 说明 |
| --- | --- | --- | --- |
| **A. 现有方案（Windows 端原生各写）** | 零工具链风险 | 需第三套 domain 实现（WebClipEngine 773 行 + SubjectRegistry 184 行 + 全部 parity 测试） | 与 mac 端现状一致，纯增量 |
| **B. 只抽 domain 为共享 JVM 模块** | 消除第三份 domain 实现；不动 UI 与工具链版本 | 8–14 人日；Windows UI 仍需从零写（Compose Desktop 或 WinUI） | **风险最低的第一批交付**，可作为 CMP 的探针 |
| **C. 全量 CMP（domain + UI 共享）** | Android/Windows 共享 7.7k 纯逻辑 + 最高约 45% 的 UI | 30–52 人日；Kotlin/CMP/BOM 三方版本对齐为硬前置且风险最高 | 本报告主体评估对象 |
