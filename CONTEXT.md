# KnowFlick 领域词汇

> **2026-10-24 产品范围补充**：下方“新规划术语”用于[笔记 → 知识库 → 应用](docs/product/README.md)的新设计，不表示当前两端已实现新模型；后文实现描述保留其原有范围。平台分工不变，见 [ADR-0004](docs/adr/0004-notes-knowledge-applications.md)。

## 新规划术语（目标模型）

**笔记（Note）**：用户可以持续编辑、整理和引用的一份记录，可同时包含文字、图片、手写、音视频及其说明。笔记不必先转成卡片才能被查找或使用。

**来源与原件（Source / Original）**：内容从哪里来，以及某次采集保存的原始内容；它与用户之后写的说明和 AI 提炼可以分别保留。相同原件可被多份笔记引用，各自的来源关系仍独立。

**知识库（KnowledgeBase）**：为主题、项目或其他明确用途组织的笔记、选段与确认知识的范围。一份笔记可以属于多个知识库，加入知识库不要求复制原件。

**知识提炼（Extract）**：从一份或多份有出处的内容中形成的摘要、观点、事实或问题。知识卡是可用于学习的提炼形式之一。

**应用产物（Artifact）**：使用指定知识范围完成任务后保存的问答、纪要、复盘、草稿等结果，带有使用的来源。用户可以把产物保存成笔记，但生成内容不自动等同于已确认事实。

**个人记忆（PersonalMemory）**：有依据、适用范围、时间与确认状态的个人事实或偏好条目，用户可纠正、暂停和删除。行为统计与 AI 推测不等同于用户确认的事实。

**功能模块（Module）**：可以按需启用的产品能力。**AI 技能包（Skill）**是供适配的 AI 工具使用的指令与上下文入口，二者名称和授权不混用。

> 单文件领域术语表（无 ADR）。架构评审与实现以此语言为准。
> 覆盖范围：词条描述**两套共用的领域语言**——第一套是 `apps/workbench`（Windows / Linux / macOS 与稍后的网页，见 [ADR-0002](docs/adr/0002-desktop-web-split-from-android.md)），第二套是 `apps/android`（Kotlin / Compose）。两套读写同一份 `cards.json` / `settings.json` 结构，因此这里的口径对两边同时有效。
> 注意：Swift 的 `apps/mac` 已删除（2026-10-13）。文中保留的 Swift 类型与文件名**只作历史参照**；下面的实现归属已按删除后的现状逐条核对过，凡是只在某一套里存在的机制都标了归属。

## 卡片（Card）
一条领域知识（不限冷知识）：`category` / `headline` / `summary` / `details` / `links`，来源 `source`（`seed` 预置库遗留值 / `ai` 生成 / `imported` 剪藏与导入）；学科坐标 `subject` / `branch` / `level` / `track` / `orderKey` / `prereq` 全部可选（见「学科体系」）。内容与浏览状态在同一结构上（Android `KnowledgeCard`，第一套桌面 `src/domain/card.ts` 的同名类型），浏览状态字段见下。

> **预置库已退役（2026-10）**：仓库不再自带内容库，App 不会在任何启动路径往库里灌卡。`source = seed` 只作为**线格式历史值**保留（旧 cards.json / 旧归档解得出来），不再生成。

## 分类体系（CategoryRegistry）
**这一节描述 Android 侧的实现**（`com.knowflick.app.domain.CategoryRegistry`，在 `:domain` 的 `commonMain`）；第一套桌面没有注册表，分类列表直接从卡库里去重。
**内置「冷知识」分类（不可删改，预置库退役后作为别名表与未归类内容的兜底落点）+ 用户自定义分类**。`resolve(raw, custom)` 解析到有效分类（别名映射仅在目标分类存在时生效）；`normalize` 无法识别时兜底到第一个自定义分类（无自定义则冷知识）；AI 生成的白名单取 `allNames(custom)`。

> **2026-10-13 审计更正**：旧版这一节写过「默认预置 AI / AI 开发 / AI Agent / 中级会计 / 投资理财 五个自定义分类，各带内容方向描述」「偏好解析用 resolve（剔除未知）」「AI 生成白名单 = `allCategoryNames`」——这三条在今天的代码里都**找不到落点**：没有默认自定义分类表，也没有「内容方向描述」这样的字段或参数；偏好过滤直接用原始 `preferredCategories` 集合；`normalize` 唯一的生产调用点传的是空列表（于是绝大多数输入落到「冷知识」）。这三条按**待裁定项**读（曾实现后丢失 / 从未实现），不要当成现行契约。

## 学科体系（SubjectRegistry）
**学科 → 分支 → 难度** 三级：`subject`（如 english）/ `branch`（如 grammar）/ `level` 1..5（内容难度，**与 FSRS 的 `difficulty`「记忆难度」是两个概念，不得混用**），另有 `track`（应试标尺：高中英语 / 大学英语四级 / 大学英语六级、初级 / 中级会计 / 注册会计师）、`orderKey`（分支内序号，决定「一点点看」的推进顺序）与 `prereq`（前置卡 id，学习路径的边）。

六个字段**全部可选且只在有值时写盘**：历史卡与旧同步包缺字段时解出 null/nil，行为与升级前完全一致；`category` 仍是界面展示用的叶子名，学科能力读 `taxonomyOf(card)` 的派生结果——**显式字段优先，缺失时按内嵌的 `legacyCategoryMap` 从 category 派生，未列入映射表的分类保持「未分级」，不臆测**。

**两处事实来源必须同源**：`shared/assets/taxonomy_map.json`（契约）与 `:domain` 内嵌的 `SubjectRegistry.kt`（各自内嵌、运行时不读文件，避开 APK 资产的历史坑）。一致性分两层守：Kotlin 侧的 parity 测试逐字段比对契约（`SubjectRegistryTest`），`tools/check_taxonomy.py` 在 CI 做契约自洽 + 两处条目集合一致。Swift 那份随 `apps/mac` 删除；第一套桌面只透传这六个字段，没有注册表（`taxonomy_map.json` 被 Vite 的 `publicDir` 顺带拷进 `dist/`，但没有任何代码读它）。

## 刷卡（Swipe）
用户把当前卡片划走的行为，记录为 `seenAt` + `swiped`。
- `left`：不喜欢（用户明确表达）
- `right`：感兴趣（用户明确表达）
- `skip`：**系统跳过**——「换一批」等系统批量操作产生的浏览，仅计已刷，**不表达喜好**（v1.4 起引入，此前系统操作误写 `.left` 污染统计/历史）

规则：对 `seenAt`/`swiped` 的任何写入都必须经由本端状态机的意图化方法——Android 是 `CardStore` 的 `swipe` / `undoLastSwipe` / `clearHistory`，第一套桌面是 `card.ts` 的 `swipeCard` / `undoSwipe` / `clearHistory`；视图不得直接改字段。卡堆重算在两端分别是 `CardStore.recompute()` 与 `deckSession.ts` 的 `refreshDeckIds`（mac 时代的 `AppStore` 及其 `refreshDeck` 已随端删除）。

## 学习范围与学习地图（StudyScope / StudyMap）
**「专学一条支线，一点点看」与「多选混合」是同一个模型的两面**。`StudyScope(subjects, branches, levels, sequential)`：三个维度都是**空集 = 不限**；`branches` 用 `subject/branch` 复合键，避免不同学科下的同名分支互相串（`trivia/assets` ≠ `accounting/assets`）。`sequential = true` 表示按 `orderKey` 顺序推进。
两条硬契约：① **范围生效时接管分类维度**（`preferredCategories` 让位），否则用户看不出"现在到底在学什么"；② **顺序模式跳过背景图防重打散**——推进顺序就是产品语义，打散会把它冲掉。作为代价，专学模式下撤销一张卡是回到它在 orderKey 上的原位，而不是队首。
学习地图是它的选择器：学科 → 分支 → 难度阶梯，动作只有「专学这条支线」和「加入混合」两个。范围**只在本次会话内生效、不落盘**（重启后卡堆"莫名变窄"很难排查）。
**归属**：这套能力今天只在 Kotlin 侧（`StudyScope.kt`，界面 `LearningMapScreen`，Android 与冻住的 `:desktop` 都渲染它）。**第一套桌面没有学习范围与学习地图**（ADR-0002 把它们列在第一版之外）。

## 听书档位与睡前淡出（SpeechPreset / SleepFade）— 仅 Android
**档位不落盘，由「语速 + 音调 + 翻卡停顿」三个数值反推**（`SpeechPreset.match`）。存 `presetID` 迟早和滑块打架——用户手调后界面还顶着「睡前轻缓」的名字；改成反推后手调任一旋钮自然回落到「自定义」，且冷启动、换设备仍然认得。四档数值（`apps/android/app` 的 `SpeechPreset.kt`）：精读标准 1.00/1.00/1.5、温和真人 0.92/0.95/2.0、通勤清醒 1.18/1.00/0.8、睡前轻缓 0.85/0.90/2.5（后者额外挂 20 分钟睡眠定时并开启淡出）。档位**不改音色通道**（那涉及密钥与服务配置），依赖真人音色的档在系统音色下要显示实话提示。
**淡出只对做得到的路径承诺**：音量在 `MediaPlayer` 上能实时生效；语速对系统合成路径按句生效，而**云端通道的语速是请求时烘进音频的**，那一路只有音量在淡。系统 TTS 无音量接口，`setSpeechRate` 只影响之后排队的 utterance，所以是「下一张开始变轻变慢」而不是当前这张平滑淡出。曲线是纯函数 `SleepFade.plan(remaining, window)`：窗口外满音量，窗口内线性收到 0.15 音量 / 0.9 语速（留余声，避免突然安静把人弄醒）。
**归属**：只有 Android 有语音通道，第一套桌面不朗读（ADR-0002 把语音列在第一版之外）；mac 时代的 `AVSpeechUtterance` 那一路已随端删除。

## 网页剪藏（WebClipEngine / WebClipFetcher）
**「抽正文」和「提炼成卡片」是两步，中间必须让人看一眼**：抽取是无损的、提炼是有损且花额度的，所以面板先给正文预览，点「AI 提炼成卡片」才写库（`source = imported`，来源链接排在 `links` 最前以便回到原文）。
内核是**按同一份规则表实现的两套代码**：Kotlin `domain/WebClipEngine.kt`（Android 与 `:desktop`）与 TypeScript `apps/workbench/src/domain/clipEngine.ts`（第一套桌面）。规则：UTF-8 字节扫描、丢脚本/导航/页眉页脚/表单/评论子树、`<article>`/`<main>`/id-class 候选挑正文（否决词优先，占整页不足一半则退回整页）、实体解码、样板行过滤、**按行截断 4000 字**（与提炼提示词既有预算同档，不单开 token 档）、charset 按「HTTP 头 → `<meta charset>` → UTF-8」解析（中文站 GBK/Big5 不能出）。
三条边界：① 链接只收 http/https，带 `user:pass@` 的**直接拒**（否则凭据会被写进卡片来源链接）；② 抓取是匿名只读（不收不发 Cookie、不落盘缓存、4 MB 上限、15 s 超时），并**沿用 App 既有的明文策略**（只对回环放开 HTTP），不为剪藏放宽；③ 判定下沉成纯函数（Kotlin `WebClipFetcher.digestFromBytes`、TS `clipEngine.digest`），网络层只搬字节。
入口：Android 是 `ACTION_SEND text/plain`（**不注册 `ACTION_VIEW`**，否则本 App 会被列成系统默认浏览器候选）+ 卡堆 ⋮ 菜单；第一套桌面是侧栏「剪藏」页（贴地址 → 抓取并预览 → 提炼 → 选卡入库）。两端提炼后的卡片都把原文链接放在 `links` 首位。
> ⚠️ **规则表要对齐的部分是「token 表 + 阈值」**：`isJunkLine` 比对前先把整行 `lowercase()`，所以两端的样板行 token **必须全小写**——Kotlin 侧曾有 `APP下载` / `Cookie` / `JavaScript` 三条写成大写、永不命中（2026-10-13 修正，有回归钉着）。

## 卡堆 / 队列（Deck）
未看过（`seenAt == nil`）的卡片，顶卡是队列第一张。**偏好分类开启时优先只刷偏好分类；偏好分类未看卡耗尽后回退全量**（不藏死其他卡）。**来源开关只剩 `enableAI`（预置库退役）**：关闭时只屏蔽 `ai` 生成卡，剪藏/导入与历史来源照常进堆——旧「全关则队列为空（含导入卡片）」的口径作废，因为把用户自己存的东西藏起来比少看几张 AI 卡危险得多。
**卡堆输出前经防重排布处理**（Android `CardArrange.arrange(cards, minDistance = 5, …)`、第一套桌面 `cardArrange.arrange(pool, 5, …)`）：先按确定性盐值哈希全局打散，再贪心排布保证同背景图 key 间隔 ≥ 5 张（key 多样性充足时成立；候选不足时退化为「最大化间隔」的贪心选择，不保证严格间隔），杜绝日常刷卡连续撞图，并有性质测试护栏。**例外**：专学顺序模式按 `orderKey` 推进，故意跳过排布。

## 历史（History）
看过（`seenAt != nil`）的卡片，按时间倒序。

## 统计（Stats）
从卡库纯派生的快照（Android `LearningStats` / `StatsCalculator.compute`，第一套桌面 `computeStats`），视图只做格式化。连续天数按日去重、允许「今天未刷从昨天起算」的空档。`skip` 计入已刷，不计入喜欢。`dailyCounts` 提供近 7 天趋势（纯计算）。

## 分类主题（CategoryTheme）
卡片内容/分类名 → 视觉主题（背景图 key / accent）。采用**领域关联多图池 + 细化语义识别 + 标题哈希兜底**：划分计算机与 AI、商业财会金融、自然宇宙科学、人文心智四大领域多图池（计算机与 AI 15 张、自然宇宙科学 15 张、人文心智 10 张、商业财会金融 8 张，共 42 张专属摄影底图），即使在「中级会计」或「AI Agent」等单分类内刷卡也张张不同；配合确定性打散与相邻防重，杜绝连续撞图。两端各有一份实现（`CardThemeResolver.kt` / `cardTheme.ts`），池的划分与 key 集合逐条相同。
> 旧版这一节还写过「主窗口环境背景光（ambient）与当前卡片及划卡飞出动画实时深度联动」——**两端都没有这个实现**，已删。注意 Android 里的 `ambient` 是另一个意思：磨耳朵连续播报。

## 存储（Storage）
持久化目录由宿主注入。卡片文件**三档回退**：cards.json → cards.backup.json → cards.backup.2.json（两代轮转）→ 隔离损坏文件后如实保持空库（预置库退役，已无重播种路径）。
- **API 密钥单独存**，不进卡片 JSON、不进设置 JSON、不进导出包：Android 走 EncryptedSharedPreferences + Keystore；第一套桌面是数据目录旁 `credentials/apiKey.credential` 的 0600 明文文件（**未接系统钥匙串**，设置页如实显示降级提示）。mac 时代的 Keychain 已随端删除。
- **落盘节流**：Android 在宿主层做 350ms 节流合并（连续刷卡只写最后一次，退出前 flush）；第一套桌面不节流，每次改动即刻 await 写盘。

## AI 服务（AiService / AiProviderPreset）
OpenAI 兼容端点客户端。**只连用户自己的端点**：不做 KnowFlick 账号、不代管模型、不代管密钥。**两套各有一份实现，能力并不相同**：
- **Android**（`:domain` 的 `ai/AiService.kt`）：**流式**（SSE 逐行接收 + 增量对象扫描，拿到目标数量即提前终止），429/5xx 自动重试；标题截断上限 100、max_tokens 按生成数量动态算（≈900/张 + 400 缓冲）；`ping` 探测 max_tokens=1。内置 **16 档服务商预设**（13 在线 + 2 本地 + 1 自定义，`AiProviderPresets.kt`）。
- **第一套桌面**（`src/domain/aiChat.ts` + 壳里的 `complete_chat`）：**一次性请求**（非流式），无自动重试；max_tokens 固定 3200、无标题截断；**没有任何服务商预设**——设置页只填 Base URL / 模型 / 密钥。

共同的产出质量链：分类归一化（仅 Android）→ 字面去重（`normalizeHeadline`）→ 内容长度门槛（≥80 字）；Android 另有近重复抑制（bigram Jaccard > 0.35 丢弃）。第一套桌面不做分类归一化，模型没给分类时填「随手笔记」（这是它与 Android 兜底到「冷知识」的一处已知差异）。

**AI 内容标记（showAIMark）**：AI 卡片在卡面显示徽章（两端）、详情与历史列表带来源提示（Android）；关闭开关后隐藏。

## 设计系统（Design tokens）
**这一节是历史记录**：mac 时代的 `InsightDesignSystem.swift` / `ThemeTokens` 家族（`InsightColor` / `InsightFont` / `InsightShell` / `InsightCard` …）以及更早的 Editorial 体系随 `apps/mac` 一起删除，全仓已无引用。
**今天两端各自实现视觉，唯一共享的开关是 `paperTheme`**（5 档、取值名一致：Android `Theme.kt` 的四套 `PaperTheme`、第一套桌面 `App.tsx` 的 `data-paper`）。摄影底图仍是产品个性：刷卡主卡片为整张分类摄影底图 + 多阶暗化 scrim + 白字排版（无图分类退化为 accent 渐变），底图池同时服务收藏缩略图与列表行。

## 动态遮罩（Scrim）
覆盖在摄影底图上的多阶非线性暗化渐变层，目的是弱化背景纹理、保证标题与正文可读。**两端各自实现、取值一致**：Android `CardFace.kt` 的四档垂直渐变与第一套桌面 `CardSheet.tsx` 的同档 CSS 渐变（0.14 / 0.28 / 0.58 / 0.82）。

## 触觉反馈（Haptics）
**只有 Android 有分级触觉**：`PlatformHaptics` 接缝（共享层）在 Android 侧用 `Vibrator` 预设实现 tick / click / success / warning 四档，卡片滑动达到划出判定门槛或松手磁吸回弹时触发；`:desktop` 与第一套桌面为 no-op（ADR-0002 认可的端差，第一套桌面未设计触觉）。mac 时代的 `NSHapticFeedbackManager` 已随端删除。

## 卡面飞出（Flying card）
划卡瞬间把目标卡移入顶层独立渲染层、立即提交状态并归零底层位移；底层新顶卡平稳就位、飞出卡独立飞离淡出——消除卡片瞬跳与换卡背景闪烁。**两端各自实现**：Android `DeckScreen` 的飞出层（按卡 id 保持组合身份），第一套桌面 `App.tsx` 的 drag/fly 状态与 `.fly` 样式。
> mac 时代那套「`ActiveSheet` 单一状态入口调模态」的描述（SwiftUI 多 `.sheet` 链式挂载会覆盖冲突）随端删除，不再是本仓库的领域词汇。

## 应用图标（AppIcon）
**美术只有一份**：`shared/icons/AppIcon.iconset/`。各打包器各取所需，产物随仓库分发：
- `tools/generate_app_icons.py` 派生 `shared/icons/AppIcon.{icns,ico,png}`（`.icns` 要 macOS 的 `iconutil`，非 macOS 跳过），服务冻住的 JVM 桌面打包；
- 第一套桌面用自己的 `apps/workbench/src-tauri/icons/`（`npx tauri icon` 从同一份美术派生，含 `.icns` / `.ico` / 各档 PNG）；
- Android 用矢量 drawable，不用 `.icns`。

圆角与投影由美术决定（生成脚本只做 26% 圆角掩码）；「Sonoma 超椭圆规范」那类描述属美术说明，不是代码契约。
