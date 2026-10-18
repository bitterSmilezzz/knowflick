# mac 端收敛与退役：功能对等清单

> 判定口径来自 [ADR-0001 §5.1](adr/0001-desktop-tri-platform-shared-kotlin.md)：`apps/mac` 的 Swift/SwiftUI
> 是**过渡态的第二实现**——冻结新增能力，**按功能清单逐项核对**，对等后退役。
> 本文件就是那份清单：**谁已经对等、谁还没对等、退役还缺什么**。
>
> 维护方式：每完成一次共享端迁移，勾掉对应行并更新「共享端状态」列。**不按时间点宣布对等**。

## 1. 现状量化

| | 规模 | 说明 |
| --- | --- | --- |
| `apps/mac`（Swift） | **90 文件 / 28,491 行**（Core 45/11,355 + App/Views 45/17,136） | 第二实现，已冻结新增能力 |
| 共享端 `:domain` + `:shared-data` + `:shared-ui` | 见 [MULTI_PLATFORM §共享代码](MULTI_PLATFORM.md) | 四个端（Android + Win/mac/Linux）共用同一份 |
| 共享端**整屏** | 6 个：刷卡主页 / 收藏阁 / 详情 / 测验 / 统计 / 设置 | 桌面端已全部可用 |
| 共享端逻辑层 | 卡片模型、卡库状态机、间隔复习、测验编排、统计、搜索索引、图谱引擎、剪藏抽取、相关推荐、AI 服务（含流式解析）、归档导入导出 | 平台无关部分基本已收进共享层 |

**共享端自有代码只剩平台边界**：数据目录、原生文件对话框、菜单栏、通知条、凭据存储、音效/触觉/底图/日期的 actual。

## 2. 功能对等清单

图例：✅ 已对等（共享端可用）· ⚠️ 部分对等（逻辑已共享，界面或某端能力缺失）· ❌ 未对等 · 🔒 平台能力（按第一原则**允许各端各写**）

| mac 能力 | mac 实现（行数） | 共享端状态 | 差距 / 备注 |
| --- | --- | --- | --- |
| 刷卡主页 | `InsightMainView` 1329 | ✅ `DeckScreen` | 手势、飞出动画、音效接缝均已迁 |
| 卡片详情 | `DetailView` 889 | ✅ `DetailScreen` | 外链走 `LocalUriHandler`；两个 Sheet 为宿主槽位 |
| 知识测验 | `QuizView` 655 + `QuizCardView` 358 | ✅ `QuizScreen` + `:domain QuizCycle` | 编排共享，评分口径一致 |
| 学习统计 | `InsightStatsView` 433 | ✅ `StatsScreen` | 日期快照接缝（Android 广播 / 桌面轮询） |
| 设置 | `SettingsView` 1178 + `SpeechSettingsEditor` | ✅ `SettingsScreen` | 主题/音效/AI/语音配置；`settings.json` 线格式跨端同一份 |
| 收藏阁 / 历史 | `InsightFavoritesView` 501 + `HistoryView` | ✅ `LibraryScreen` | 收藏与历史两个分段 |
| AI 生成新卡 | `GenerationCoordinator` + `AIService` | ✅ `:domain AiService` | 桌面端已可用（含连接测试）；流式解析在共享层 |
| 音效 | `AudioEffectManager` | ✅ 接缝 `PlatformSounds` | Android 用合成音；桌面 no-op（**桌面未设计音效**，属可接受的端差） |
| 全局搜索 | `GlobalSearchModalView` 610 | ✅ `SearchSheet` | 检索引擎与历史都在共享层，桌面端可用 |
| 知识图谱 | `KnowledgeGraphView` 727 | ❌ | 引擎 `graph/*` 已在 `:domain`，但渲染用 `android.graphics.Paint` 在 Canvas 上量文字——**要迁移得先改写绘制层**（`TextMeasurer`/`DrawScope`） |
| 学习地图 | `LearningMapView` 333 | ✅ `LearningMapScreen` | `StudyScope`/`StudyMap` 与范围状态都在共享层，桌面端可用 |
| 局域网同步 | `SyncSheetView` 528 + `SyncClient/Server/Protocol` | ❌ | 见 ADR 待决 2：四端之后是否沿用同一协议需单独设计，**不要为每端各写一套同步** |
| 网页剪藏 | （Swift 已删） | ✅ `ClipSheet` | 共享面板按 mac 三步：正文预览 → 卡片多选（可重炼）→ 确认导入，置顶可关。抓取在 `:shared-data` 的 `WebClipFetcher` |
| 笔记导入 | （Swift 已删） | ✅ `NotesImportSheet` | 规则解析 `NoteMarkdownParser` + JSON 走 `NoteImport`；AI 提炼复用 `transformNoteToCards`；先勾选再入库 |
| 卡片导出选择 | （Swift 已删） | ✅ `BackupExportSheet` | 引擎共享。面板在 `:shared-ui`，`ArchiveExporter` 接缝：Android 保存到 Downloads 并可系统分享，桌面「另存为」、不显示分享 |
| 海报导出 | `CardPosterRenderer` 561 + `CardPosterExportSheet` | 🔒（Android 槽位） | 需要光栅化；共享端以槽位注入，桌面暂缺 |
| AI 追问聊天 | `CardFollowUpChatView` 424 + `CardChatInsightDeriver` | ✅ `CardFollowUpChatSheet` + `ChatStateHolder` | 会话编排（`:shared-data ChatStateHolder`，含流式与 `chat_sessions.json`）、面板与洞见提炼都共享；桌面端可用 |
| 语音朗读 | `SpeechConsoleView` 496 + `SpeechSynthesizerService` + `RemoteSpeechClient` | 🔒 | TTS/音频通道属平台边界；Android 用系统 TTS，mac 用 AVSpeech，桌面待定 |
| 环境音 | `AmbientAudioPlayerBar` 331 | ❌（B 档） | 受 `speech/SpeechController` 拖累；与语音同属音频通道 |
| 帮助 | （Swift 已删） | ✅ `HelpSheet` | 快捷键文案按原 `HelpView` 搬入共享层 |
| 凭据存储 | `KeychainHelper` | 🔒 | 各端各写：Android Keystore / 桌面 0600 明文文件（**未接 OS 钥匙串**，单列技术债） |

**统计**：22 项能力里 **12 项已对等**、4 项部分对等、4 项未对等、2 项属平台能力。删 Swift 仍只等剪藏面板、笔记导入、帮助页。

## 3. 退役前置条件（exit criteria）

> **2026-10-13 收窄，同日完成。** `apps/mac` 已删除。四个界面洞都在共享层：导出选择、网页剪藏（mac 三步）、笔记导入、帮助页。
> 图谱、局域网同步、环境音留到删除之后，不作为把 Swift 加回来的理由。

1. **导出选择** —— ✅
2. **网页剪藏面板** —— ✅ mac 三步，Android 一键置顶已去掉。
3. **笔记导入** —— ✅
4. **帮助页** —— ✅
5. **删除 `apps/mac`** —— ✅

## 4. 本机（macOS）能验证到什么程度

| 验证 | 状态 |
| --- | --- |
| mac Core 测试 | ✅ 本机 `./tools/test.sh --core-only`：**461 项通过**（453 + 8 两个 test run），退出码 0 |
| mac UI 层编译 | ⚠️ 本机只有 CommandLineTools，缺完整 Xcode → 交 [macos.yml](../.github/workflows/macos.yml)（CI 已绿） |
| 共享端全量测试 | ✅ `./tools/build_android.sh`：361 项（app 132 + 领域层 183 + `:shared-data` 27 + `:shared-ui` 6 + 桌面 13） |
| 桌面端三系统安装包 | ⚠️ 本机只能出 DMG；MSI/DEB 由 CI 三台 runner 出（`desktop.yml`） |
| 桌面端导入/导出/测验/统计/详情/设置 | ✅ 本机端到端用例覆盖（无头 Compose 测试） |
| AI 生成全链路 | ✅ 本机用假服务器（MockWebServer）跑通，不碰真实网络 |

**必须换 Windows / Linux 机器才能做的**（本清单的边界）：

- MSI / DEB 的**安装与首次运行**（数据目录落地、开始菜单/桌面项、卸载、静默安装）；
- Windows 原生文件对话框的行为与编码；Linux 下 X11/Wayland 的窗口与文件对话框差异；
- 三系统安装包的**体积/冷启动/内存**对比（[RESOURCE-REPORT](windows-route/RESOURCE-REPORT.md) 的桌面侧数据）；
- 若要做「一次开包」的发布核对：在对应系统上装完跑一遍导入 → 刷卡 → 测验 → 导出的冒烟；
- 同步协议的跨端互通（需要两台机器在同一局域网）。

## 5. 下一步

删除门槛已完成。图谱、局域网同步、环境音是删除之后的后续，不是把 Swift 加回来的理由。
换 Windows / Linux 机器才能做的事仍以第 4 节为准。
