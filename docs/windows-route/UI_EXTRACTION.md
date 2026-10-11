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
> （`AppIcons` 被误判成依赖 `BackgroundImage`，只因两边都有个叫 `path` 的局部量）。
> 现在只认**从第 0 列开始**的行——Kotlin 顶层声明必然顶格。这个修正让 A 档从 12 文件 1720 行
> 变成 27 文件 5196 行，与 CMP-FEASIBILITY 独立估的「10 文件 5064 行可直搬」量级一致。

## 2. 分档结果

| 档 | 迁移前（2026-10-11 基线） | 当前（已迁 6 文件后） |
| --- | --- | --- |
| **A**（可直接搬） | 27 文件 / 5196 行 | 21 文件 / 2828 行 |
| **B**（被平台文件拖累） | 8 文件 / 2298 行 | 8 文件 / 2298 行 |
| **C**（自身带平台信号） | 36 文件 / 12941 行 | 36 文件 / 12949 行 |
| **已迁入 `:shared-ui`** | — | **10 文件 / 2707 行**（含 2 个测试文件） |

B 档只被**单个**平台文件拖累，抽象掉那个文件就能整片解锁，例如：
`ui/StatsScreen.kt`(825) ← `ui/LearningDay.kt`；`ui/CardFace.kt`(281) ← `ui/BackgroundImage.kt`；
`ui/ImportRestoreDialog.kt`(288) ← `data/ArchiveImportManager.kt`；
`sync/SyncClient.kt`(246) ← `sync/SyncServer.kt`。

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

1. **抽象 `data/CategoryStampColor` 之外的 `ui/LearningDay.kt`** → 一次解锁 `StatsScreen`(825) + `ui/stats/*`；
2. **`BackgroundImage` 的桌面实现**（expect/actual：Android 读 assets，桌面读文件/classpath）
   → 解锁 `CardFace.kt`(281) 与整个刷卡页视觉；
3. **`AiService` + `ai/*`（约 1100 行）**：A 档的「后端」半边，可随 `:shared-services` 或并入
   `:domain` 一起共享（模块归属需先定，见 ADR §5）；
4. **平台动作抽象**（分享 / 文件选择 / 剪贴板 / Toast）→ 解锁 `SettingsScreen`、`DetailScreen`、
   各 Sheet。
5. **打包**：Win/mac/Linux 三个 `package*` 任务接进 CI（需各端真机/runner 验证）。

## 6. 复现

```sh
python3 tools/classify_ui_portability.py            # 分档 + 已迁清单
python3 tools/classify_ui_portability.py --json     # 落 .scratch/ui-extraction/classification.json

cd apps/android
./gradlew :shared-ui:jvmTest :desktop:test          # 共享界面在桌面 JVM 上离屏渲染（只需 JDK 17）
./gradlew :app:testDebugUnitTest :domain:jvmTest :shared-ui:jvmTest :desktop:test :app:lintDebug
```
