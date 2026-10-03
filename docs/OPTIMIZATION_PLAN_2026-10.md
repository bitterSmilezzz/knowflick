# KnowFlick 深度优化方案（2026-10）

> 基线：mac v0.2.0（tag 2026-10-02）+ Android v0.10.3（versionCode 23）+ 去 AI 味补完（PR #45）。main CI 全绿，无未合并 PR。
> 依据：2026-10-03 双端全量深度审计（8 维度：架构/测试/正确性/同步/AI/性能/平台适配/发布链），P1 关键发现已逐条实锤复核。
> 定位：hourly 巡检轮已扫尽低垂果实（2026-10-01 起多数轮次「无活可干」），本方案升级为**专项波次**，按「正确性 → 数据与协议 → 架构与测试 → 产品化 → Windows」推进。
> 平台次序：**Mac 与 Android 先行收口，两端方案落地后再启动 Windows**（Wave E 前置条件）。

---

## Wave A — 正确性止血（✅ 已完成 2026-10-03：PR #46 mac + PR #47 android 均已合并，main CI 绿）

目标：消灭数据丢失 / 进程崩溃 / 用户可见缺陷级问题。全部有明确修复面，不需要拍板。
执行结果：mac 12 项新测试（361→373 全绿）、android 21 项新护栏（269→290 全绿）；复核中纠正审计误报一条（A6 Java FutureTask 本就捕获 worker 异常，真实缺陷是静默吞错而非杀进程）、排除一条不适用项（A1④ mac SyncClient 走 URLSession 无裸 socket）。

### macOS 端

| # | 问题 | 位置 | 说明 |
|---|------|------|------|
| A1 | 同步响应单次 write + 无 SIGPIPE 防护 | `SyncServer.swift:275-287` | `Darwin.write` 返回值不查（header/body 各一次），全库导出（上限 25MiB）远超 socket 缓冲时必部分写、对端收到截断 JSON；全仓 grep 无 `SO_NOSIGPIPE`/`MSG_NOSIGNAL`，对端提前断开时 SIGPIPE 直接杀进程。修：循环写 + `SO_NOSIGPIPE`。 |
| A2 | AI 增量扫描器未配对 `{` 漏扫 | `AIService.swift:415-417` | 代码注释自认「本轮未修，留待后续」：正文含未配对 `{` 时 depth 顶高，后续合法卡片被当嵌套对象漏扫，用户看到「AI 返回格式无法解析」而模型有产出。修：起点从单值改候选栈（`}` 弹栈尝试解码），配散文夹具测试。 |
| A3 | 搜索历史落盘绕过统一协调器 | `AppStore.swift:569-604`、`Storage.swift:277-279` | 直接 `persistenceQueue.async`，失败仅 NSLog 不上浮横幅；损坏时静默返回 `[]` 不留隔离副本。修：走 PersistenceCoordinator + 隔离副本 + 告警口径对齐。 |
| A4 | 启动时 settings 重复全库重排 | `AppStore.swift:260-264` | bootstrap 末尾 `settings = migratedSettings` 触发 didSet 全量重排（卡片已就位后第二遍）；且 `deck.count < 5` 自动消耗用户 API 额度无确认。修：迁移写入走不触发重排的路径；自动补卡加每次启动上限。 |

### Android 端

| # | 问题 | 位置 | 说明 |
|---|------|------|------|
| A5 | 微件收藏整库写回竞态 | `WidgetCardRepository.kt:94-108, 23-35` | 独立 `CardStorage` 实例读-改-写 `saveCards(allCards)`，与 App 内 350ms 节流队列 last-writer-wins，微件侧旧快照整库写回可冲掉刚发生的刷卡/收藏。修：微件路径复用统一持久化队列（或 ContentProvider/广播委托 VM 侧）。 |
| A6 | 同步线程池未捕获异常杀进程 | `SyncServer.kt:77-79, 117-119, 191, 207` | `pool.submit { handleClient }` 无 try/catch，`readHttpLine` 的 `error()`、畸形 JSON 解码抛出即成线程池未捕获异常——Android 直接杀进程。持配对码的对端（或截断大包）可稳定触发崩溃。修：submit 包 try/catch + 400 响应。 |
| A7 | 前台服务三连 | `SpeechPlaybackService.kt:341-357, 155-167`；Manifest | ① `stopService` 用 `startService(ACTION_STOP)`，后台播完时 O+ 抛 IllegalStateException 被吞 → 通知与 MediaSession 残留；② `startForeground` 全体 try/catch 吞错（13+ 通知权限被拒即失前台保护无感知）；③ `POST_NOTIFICATIONS` 运行时权限从未请求（API 33+ 默认拒绝）。修：startForegroundService/stopService 正确路径 + 失败上报 + 启动时请求权限。 |
| A8 | dueCardsCount 每次访问全库三遍扫描 | `KnowFlickViewModel.kt:882-883` | getter 每次 `LearningPlan(...)` 新建（completedToday 逐卡时区转换 + mastered + 排序），每次刷卡 version++ 重组即触发主线程 O(n log n)。修：按 version 缓存派生值（`derivedStateOf` 或显式 memo）。 |
| A9 | 菜单字符串插值 bug | `DeckScreen.kt:422` | `${'$'}studyScopeLabel` 输出字面 `$studyScopeLabel`，应为 `${studyScopeLabel}`。一行修。 |
| A10 | TTS 长卡静默截断 | `SpeechController.kt:501-511, 537` | 系统音色整卡一次 `speak()`，超 `getMaxSpeechInputLength`（≈4000 字符）静默截断；resume 按字符比例截文本可能切断代理对。修：按句分段排队 + 代理对安全切分。 |
| A11 | executeBidirectionalSync 吞取消 | `KnowFlickViewModel.kt:396-408` + `SyncClient.kt:184` | `runCatching` 包 suspend 调用，关面板取消时 CancellationException 被吞成假错误回调。修：rethrow CancellationException。 |
| A12 | 同步服务静默停摆 | `SyncServer.kt:73-85` | accept 循环 `catch { break }`，fd 耗尽等异常后 `isRunning` 仍 true，UI 显示「服务已启动」。修：异常上浮状态。 |

验收：双端全部既有测试绿 + 新增夹具（A1 部分写、A2 散文夹具、A5 并发写、A6 畸形请求不崩、A10 长文分段）——已达成（mac 373/373，android 290/290）。

**A5 残留（✅ 已随 Wave B 收口，android PR #50）**：微件写回与 App 汇入同一把 CardStorage 实例锁（Wave A），Wave B 补上内存态同步（WidgetSyncBus 事件 → VM 按 id 重读回灌内存 store）。

---

## Wave B — 数据完整性与同步协议升级（✅ 已完成 2026-10-03：协议定版 PR #49/#52 + mac PR #51 + android PR #50，main CI 绿）

> 协议已定版 `docs/SYNC_PROTOCOL.md`（v2），**Windows 端照此对接**。双端同轮实现，mac 373→400、android 290→332 全绿；F1-F4 双端夹具对照、墓碑交换律双端落地。复核中裁定两个规格未定义点并补入 §4.5/§4.6（未知 id 墓碑照记、合并产物 editedAt 取较新者），android 端已按裁定对齐（13f7aae）。
> **待用户验收**：mac ↔ Android 真机各一轮同步（本机无模拟器，实机轮无法无人值守执行）。
> **发版注意**：归档导出/ZIP 备份包已切 v2 信封——旧版本 App 导入新导出文件会报「未检测到有效数据」，两端需同版升级；新端读旧文件已兼容。

| # | 项 | 说明 |
|---|----|-----|
| B1 | 协议版本字段 | 双端 `/api/info` 与 cards 载荷均无 schema 版本（grep 0 命中），兼容全靠 `ignoreUnknownKeys`。加 `protocolVersion` 握手 + cards `schemaVersion`；旧端缺字段按 1 解读。未来破坏性变更有回退通道。 |
| B2 | 删除墓碑 | `mergeCardList` 只做新增/升级，一端删除的卡下次同步被对端灌回（删除不可传播）。加 `deletedCardIds` 墓碑列表（带时间窗）。 |
| B3 | 正文合并口径 | 「createdAt 较新者为主 + **details 取更长一方**」——用户手动缩短过的正文被旧长文覆盖（`CardImportEngine.swift:368-377`）。改为统一按编辑时间戳，或 details 引入 `editedAt`。 |
| B4 | executeSync 推送快照 | mac `SyncSheetView.swift:441-451` 推送**合并前**的 localCards 快照：拉→合→推三步间，刚合并进来的卡不回推、期间本地改动不在推送里。改为合并后再取快照推送。 |
| B5 | 超时与重试对齐 | Android connect 5s/read 15s vs mac 6s/20s；Android read 超时重试重新全量拉取、POST 重试 25MiB×3 重发（对端 merge 幂等所以无数据错，纯浪费）+ `Thread.sleep` 占 IO 线程（`SyncClient.kt:152`）。统一参数 + 改挂起 delay。 |
| B6 | 配对码防暴力枚举 | mac 侧 6 位数字码普通比较、无速率限制（`SyncServer.swift:197-200`），局域网 10^6 空间可穷举。加连续失败退避/锁定。 |
| B7 | 备份纵深 | mac 备份仅一代（`Storage.swift:145-187`），「主坏+备坏」即重播种；`*.corrupt-<ts>-<uuid>` 隔离副本只增不减无上限。备份扩到 2-3 代 + 隔离副本上限清理。 |
| B8 | 同步完成强制落盘 | Android 同步中 kill app：合并后推送前被杀，350ms 节流窗口内数据可能未落盘。同步完成点（合并后/推送后）显式 flush。mac 侧 flush 在主线程 `sync` 等待全库编码（`PersistenceCoordinator.swift:102`，大库退出可感知停顿）→ 顺手移后台。 |
| B9 | 服务生命周期语义 | mac 同步服务仅在 SyncSheet 打开期间存活，面板一关中断对端（对端还在推）。**需拍板**：面板常驻最小化 vs 明示「关闭即中断」的文案与对端提示。 |

---

## Wave C — 架构与测试债（解锁 1.0 开发速度）

> hourly 备忘既有大项（三巨档 de-nesting、VM 拆域）+ 本轮审计新发现，合并成体系。这波不改变行为，以「测试先行护栏 + 等价搬迁」为纪律。

### macOS 端
> **进展（2026-10-03，PR #54 已合并，main CI 绿）**：① 测验选题 → `QuizBuilder` 纯函数已下沉（选题语义测试 7 项补齐）；② SettingsView → `SettingsEditBuffer`（Core 纯类型）已落地——18 个设置 @State 收敛为一处字段清单，字段漂移有守卫测试；③ DetailView `store` 收紧必传（5 处 nil 路径消除）；④「够数即停」不再丢弃已扫描完整对象（红→绿：前几张过筛失败时误报 noUsableCards 的场景修复）。测试 400→412 全绿。
> **用户拍板：Android 端暂停，等 mac 完善后再恢复；三巨档 de-nesting 与 i18n 待另一会话的 mac 交互简化 WIP（InsightMainView/InsightShell/LearningWorkspaceView）落地后再做。**
> **C2 已销账（2026-10-03，PR #58 合并，main CI 绿，CI 全量 443 项）**：GenerationCoordinator 下沉 + bootstrap 拆段 + RetryPolicy 统一（生成/追问两路逐条等价）；重排 >256 张才下沉后台（216 现状同步不变）；背景图未命中改后台解码 + 主线程回填（**已知残留**：PosterExportManager 冷缓存离屏渲染可能少背景图，正常流程经预览预热）；聊天会话内存态表（每条消息不再全量 decode）；**app 层测试 target `KnowFlickAppTests` 起步**（ActiveSheet 路由 3 项 + 背景图缓存 5 项，本地与 CI 均可跑）。
> 剩余项（mac）：AI 生成编排已完成；三巨档 de-nesting 待 WIP；视图层测试继续扩面；`arrangeWithMinDistance` 的 ≤256 同步路径保持现状（实测 216 张无害）。
1. **AppStore 域下沉**（634 行）：测验选题算法（`generateQuizCards`，AppStore.swift:396-432，0 测试）→ `QuizBuilder` 纯函数 + 补齐选题/混池/打乱语义测试 ✅ 已做；AI 生成编排（445-485）→ `GenerationCoordinator`；bootstrap 84 行四件事（三级回退/种子合并/钥匙串迁移/自动补卡）拆阶段函数。
2. **SettingsView 编辑缓冲重构**（1098 行）：29 个 `@State` + onAppear 全量拷入 + save() 手工逐字段拷出——`AISettings` 每加一个字段必须同步改两处，漏一处静默丢配置。改为 struct 驱动的编辑缓冲（copy-with 语义），消除字段漂移。✅ 已做（SettingsEditBuffer + 字段漂移守卫）
3. **三巨档 de-nesting**（SettingsView/InsightMainView 1027/DetailView 845）：按 hourly 既定方案配合视图层测试做。DetailView 顺手修 `store = nil` 兜底新建 `SpeechSynthesizerService()` 的潜伏陷阱（DetailView.swift:658, 686）。✅ 陷阱已修；de-nesting 本体待 WIP 落地
4. **mac 视图层测试从 0 起步**：`Package.swift` 只有一个 Core 测试 target，App 层 41 个视图文件 0 覆盖。先给路由（ActiveSheet）、手势判定、SettingsView 缓冲等纯逻辑建 target，CI 可跑（**本机已装完整 Xcode：本地全量 swift build/test 可跑**）。
5. **AI 重试策略统一**：生成 429/5xx×3、追问 3 次「yield 后不重试」、SyncClient 0.5s/1s 抖动——三套口径收成一个 RetryPolicy 类型；「够数即停」`prefix(targetCount)` 丢弃已扫描完整对象（AIService.swift:557）顺手回收。✅ 够数即停已修；重试统一待做
6. **主线程大活挪走**：`arrangeWithMinDistance` 在 MainActor（1080 张 0.69s）、`BackgroundImageCache` 未命中同步解码在主线程（CategoryTheme.swift:197-207）、聊天全量 load+encode 每条消息（Storage.swift:243-254）。

### Android 端
1. **VM 拆域**（1035 行）：剪藏域（ClipStage 状态机，656-780）与测验域（817-938）按 ChatStateHolder 先例拆出；LAN 同步编排、导入恢复、AI 生成内联段随之归位。
2. **DeckScreen 拆分**（1050 行、33 参数）：顶栏 13 项菜单、微件 pin、手势/飞出、复习按键拆子组件；`CardStore`/`List` unstable 参数与无 remember 包装的回调收敛（重组热点）。
3. **学习地图整屏重挂载**：MAP 分支 `key(viewModel.version)`（MainActivity.kt:304）任何 mutation 都销毁重建地图；进度计算无 remember（LearningMapScreen.kt:126）。
4. **搜索主线程逐键全量检索**：SearchSheet 无防抖（MainActivity.kt:362-371 组合期同步计算），mac 同名功能已有 120ms 防抖先例——对齐。
5. **聊天流式 O(delta×n)**：每 delta `launch(Main)` + 全列表 indexOfFirst + 整列表拷贝（ChatStateHolder.kt:114-126）。改 conflation/批量合并。
6. **AI 生成双端对齐**：Android 多批并行各持同一 exclude 快照（AiService.kt:106-122，请求 20 实得可能 <20）vs mac 顺序分批；exclude 窗口语义分叉（android `takeLast(100)` vs mac `prefix(100)`）。以 mac 语义为准收敛，测试夹具共享。
7. **测试补齐**：SyncClient 重试/退避/私有地址白名单、SyncServer 畸形请求（配合 A6）、SpeechController 状态机（Robolectric 可测未测）、ArchiveExportManager/ShareFileWriter/CardArrange（防重排布无约束断言）。
8. **轻量日志层**：全工程 0 条日志，所有 catch 吞错不可诊断。引入统一 logger（debug 构建输出 + release 环形缓冲可导出），静默吞错集中处（VM 273-276、SystemCredentialStore 63-75、CardStorage 162-166、AppModel 78-84）先行接线。
9. **baseline profile 重采**：现包命中的是 0.8.6 时代 profile，历经四个版本 + 工具链大升级 + 星图改造；`baselineprofile` 模块 compileSdk 35 与 app 36 已错位，重采前对齐。

---

## Wave D — 1.0 产品化门槛（两端共性，多数需拍板）

| # | 项 | 现状证据 | 备注 |
|---|----|----------|------|
| D1 | 崩溃上报 | 双端零收集（mac grep Sparkle/Sentry/MetricKit 0 命中；Android 无 firebase/crashlytics/sentry）+ Android mapping 仅本地归档 + 全工程零日志 → 线上完全不可观测。**选型需拍板**（外部服务 vs MetricKit/本地引导导日志）。 | 与 C-8 日志层配套 |
| D2 | 更新机制 | mac 无 Sparkle/appcast/in-app 检查（仅 GitHub 外链）；Android 无应用内更新提示。 | mac 推 Sparkle |
| D3 | mac 发布链 | 无 entitlements（无 App Sandbox）、codesign 无 `--options runtime`（无 Hardened Runtime）、无公证——分发给他人被 Gatekeeper 拦；adhoc 签名回退致 Keychain ACL 每次启动失效（build_app.sh:140-163 自证）。**App Sandbox 需拍板**（要做需补 `network.server` entitlement，牵动同步监听）。 | |
| D4 | 数据 schema 版本 | cards.json/settings.json/导出 JSON 均无版本字段；mac settings.json 损坏即整体重置用户偏好（Storage.swift:196-203，仅 Keychain 幸存）。加 version 字段 + 迁移框架承接 1.0 后破坏性变更。 | B1 完成后顺手 |
| D5 | i18n | 双端全中文硬编码（mac NSLocalizedString 0 处、无 .lproj）。进不进 1.0 需拍板——量大，可降级为「文案中心化」为将来铺路。 | |
| D6 | Android 平台适配 | 非 adaptive icon（单文件矢量，无遮罩/主题图标）；微件 `updatePeriodMillis=1800000`「每日卡片」实为 30 分钟轮换（需 WorkManager 改造）；无 WindowSizeClass/平板折叠屏断点；`enableOnBackInvokedCallback` 未声明（预测性返回）。targetSdk 36 升级需同步升 Robolectric（4.14.1 上限 SDK 35）。 | |
| D7 | 首启动引导与帮助 | mac 无 onboarding（仅空状态文案）；HelpView 仅快捷键清单；无诊断/日志导出面板。 | |
| D8 | 密钥备份 | Android 签名机是单台开发机，keystore 丢失=无法更新（README 自警）。 | 运维项非代码项 |

---

## Wave E — Windows 启动（前置：Wave B 完成 + C 关键项销账）

1. **前置条件**：B1 协议版本字段定版（Windows 直接接对）、B2/B3 合并语义复用、C 波域逻辑边界清晰（避免第三端复制巨档）。
2. **路线 C 落地**（2026-09-30 已推荐未动工）：本地 Web + 常驻进程；域逻辑/契约一套（`shared/assets/taxonomy_map.json` 三端同源先例 + WebClipEngine 双端逐条对齐先例直接扩成三端）。
3. Tauri 仅作打包壳（既定裁定）；先做刷卡/收藏/历史/统计最小闭环，再接 LAN 同步与 AI。

---

## 决策项清单（开工前需拍板）

| # | 决策 | 选项与建议 |
|---|------|-----------|
| 1 | 崩溃上报选型 | 建议：mac 用 MetricKit（系统原生、无三方依赖）+ Android 短期「日志层+mapping 导出」、中期 Sentry/Crashlytics 二选一（涉及隐私承诺）。 |
| 2 | mac App Sandbox | 要做（分发正规化，牵动同步端口 entitlement 与 keychain 权限，工作量 1-2 波）vs 暂不做（保持 adhoc 直发，仅个人/测试用途）。 |
| 3 | i18n 进 1.0 | 全量本地化 vs 仅文案中心化（extract 到常量表）铺路。 |
| 4 | 同步服务生命周期 | 面板关闭即停（现状，加明示文案）vs 最小化常驻。 |
| 5 | Windows 路线 C | 确认「本地 Web + 常驻进程」作为 Windows 端架构（2026-09-30 推荐项）。 |

## 执行纪律

- 每波 = 分支 → PR → CI → 显式核对 CI 结论 → 合并 → 需要发版时 tag（沿用既定授权链路）。
- Wave A 双端可并行各开一个 PR（纯止血、无协议变更）；Wave B 起双端必须同轮互相验收（mac ↔ android 真机各一轮同步）。
- 每波销账后同步更新 [[knowflick-improvement-backlog]] 记忆与本档勾选状态。
- 全仓扫描类工作严禁 head 截断后下「清零」结论（PR #45 教训）。

---

## UI 品质迭代（获奖级，2026-10-03 起）

用户验收标准：达到 Awwwards / Webby / FWA 获奖级品质；流程 = 实屏截图自检 → 缺陷清单 → 修复 → 再截图，循环直到达标。

**艺术方向「纸与墨」**（第一轮已定案，PR #57）：
- 主强调 = **黛青墨**（浅 #274C8B / 深 #5578C7）；**朱砂印记色**（#B33729）只用于「今天/当下」级独一时点，一次界面最多一处。
- 工具界面无衬线（Cutline 延续）；**阅读面用衬线**（`InsightFont.display`，宋体基因）。
- 热力图 = 墨密度（accent 四级）；浅色画布偏暖（纸感）；彩色数字除非有「当下」语义一律回归墨色。

**轮次**：
- 第 1 轮 ✅（PR #57）：token 艺术方向 + 统计页图表工艺（分布条、7 天预测基线/刻度、图例形状、热力图墨密度）。
- 第 2 轮（待做）：详情页阅读面（衬线 + 阅读节奏 + scrim）、测验页、知识库/收藏/历史列表工艺。
- 第 3 轮（待做）：全局搜索面板、微交互语言（hover/press/转场曲线审计）。
- **阻塞项**：shell（InsightShell/InsightMainView）与学习工作台（LearningWorkspaceView）被另一会话 MAC_INTERACTION_SIMPLIFICATION WIP 占用——待其落地后接续；i18n 同理。

**自检工作流**（实测可用）：`build_app.sh` → 直接跑 `dist/KnowFlick.app/Contents/MacOS/KnowFlick` → 菜单命令导航（学习与探索 → 统计/测验/星图…）→ 按窗口 ID `screencapture -x -l <id>`（窗口 ID 用 CGWindowListCopyWindowInfo 列出；`screencapture -R` 与 `CGWindowListCreateImage` 均不可靠）。
