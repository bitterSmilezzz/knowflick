# KnowFlick 领域词汇

> 单文件领域术语表（无 ADR）。架构评审与实现以此语言为准。
> 覆盖范围：当前词条只描述 mac 端（`apps/mac`）的领域词汇；Android 端（`apps/android`）尚未收录，其语言以该端源码与发布记录为准。

## 卡片（Card）
一条领域知识（不限冷知识）：`category` / `headline` / `summary` / `details` / `links`，来源 `source`（seed 预置 / ai 生成）；学科坐标 `subject` / `branch` / `level` / `track` / `orderKey` / `prereq` 全部可选（见「学科体系」）。内容与浏览状态在同一结构上（`KnowledgeCard`），浏览状态字段见下。

## 分类体系（CategoryRegistry）
**内置「冷知识」分类（不可删改，收纳 160 张预置卡）+ 用户自定义分类（可增删改，默认预置：AI / AI 开发 / AI Agent / 中级会计 / 投资理财，各带内容方向描述）**。`resolve(_:custom:)` 解析到有效分类（别名映射仅在目标分类存在时生效）；`normalize` 无法识别时兜底到第一个自定义分类（无自定义则冷知识）——偏好解析用 resolve（剔除未知），AI 生成用 normalize。AI 生成白名单 = `allCategoryNames`（内置+自定义），每类按描述定制内容方向。

## 学科体系（SubjectRegistry）
**学科 → 分支 → 难度** 三级：`subject`（如 english）/ `branch`（如 grammar）/ `level` 1..5（内容难度，**与 FSRS 的 `difficulty`「记忆难度」是两个概念，不得混用**），另有 `track`（应试标尺：高中英语 / 大学英语四级 / 大学英语六级、初级 / 中级会计 / 注册会计师）、`orderKey`（分支内序号，决定「一点点看」的推进顺序）与 `prereq`（前置卡 id，学习路径的边）。

六个字段**全部可选且只在有值时写盘**：历史卡与旧同步包缺字段时解出 null/nil，行为与升级前完全一致；`category` 仍是界面展示用的叶子名（全仓数百处引用），学科能力一律读 `taxonomy(of:)` 的派生结果——**显式字段优先，缺失时按 `legacyCategoryMap` 从 category 派生，未列入映射表的分类保持「未分级」，不臆测**。

三处事实来源必须同源：`shared/assets/taxonomy_map.json`（契约）、mac `SubjectRegistry.swift`、Android `SubjectRegistry.kt`（各自内嵌，运行时不读文件以避开 SwiftPM bundle / APK 资产的历史坑）。一致性分两层守：两端各自的 parity 测试逐字段比对契约（`SubjectRegistryTests` / `SubjectRegistryTest`），`tools/check_taxonomy.py` 在 CI 做契约自洽 + 种子内容合法 + 三处条目集合一致。

## 刷卡（Swipe）
用户把当前卡片划走的行为，记录为 `seenAt` + `swiped`。
- `left`：不喜欢（用户明确表达）
- `right`：感兴趣（用户明确表达）
- `skip`：**系统跳过**——「换一批」等系统批量操作产生的浏览，仅计已刷，**不表达喜好**（v1.4 起引入，此前系统操作误写 `.left` 污染统计/历史）

规则：对 `seenAt`/`swiped` 的任何写入都必须经由 AppStore 的意图化方法（`swipe` / `undoLastSwipe` / `clearHistory` / `refreshDeck`），视图不得直接改字段。

**收藏（isFavorite）与喜好（swiped）解耦**：`isFavorite` 是独立布尔字段，取消收藏**不会**改写 `swiped`（避免把「感兴趣」污染成 `skip`、或抹掉「不喜欢」）。两条写入路径：① `toggleFavorite` 只翻转 `isFavorite`（不写 `seenAt`，收藏未读卡不等于已浏览）；② `swipe` 在写喜好意图的同时同步收藏态——`right` 加入收藏、`left` 移出收藏、`skip` 不动收藏。旧数据无该字段时按 `swiped == .right` 回填，保证老用户收藏阁内容不丢。

## 学习范围与学习地图（StudyScope / StudyMap）
**「专学一条支线，一点点看」与「多选混合」是同一个模型的两面**。`StudyScope(subjects, branches, levels, sequential)`：三个维度都是**空集 = 不限**；`branches` 用 `subject/branch` 复合键，避免不同学科下的同名分支互相串（`trivia/assets` ≠ `accounting/assets`）。`sequential = true` 表示按 `orderKey` 顺序推进。
两条硬契约：① **范围生效时接管分类维度**（`preferredCategories` 让位），否则用户看不出"现在到底在学什么"；② **顺序模式跳过背景图防重打散**——推进顺序就是产品语义，打散会把它冲掉。作为代价，专学模式下撤销一张卡是回到它在 orderKey 上的原位，而不是队首。
学习地图（Android `LearningMapScreen`）是它的选择器：学科 → 分支 → 难度阶梯，动作只有「专学这条支线」和「加入混合」两个。范围**只在本次会话内生效、不落盘**（重启后卡堆"莫名变窄"很难排查）。mac 端视图待补，Core 侧同一模型可平移。

## 听书档位与睡前淡出（SpeechPreset / SleepFade）
**档位不落盘，由「语速 + 音调 + 翻卡停顿」三个数值反推**（`SpeechPreset.match`）。存 `presetID` 迟早和滑块打架——用户手调后界面还顶着「睡前轻缓」的名字；改成反推后手调任一旋钮自然回落到「自定义」，且冷启动、换设备仍然认得。四档数值双端逐条相同（`SpeechPreset.swift` ↔ `SpeechPreset.kt`）：精读标准 1.00/1.00/1.5、温和真人 0.92/0.95/2.0、通勤清醒 1.18/1.00/0.8、睡前轻缓 0.85/0.90/2.5（后者额外挂 20 分钟睡眠定时并开启淡出）。档位**不改音色通道**（那涉及密钥与服务配置），依赖真人音色的档在系统音色下要显示实话提示。
**淡出只对做得到的路径承诺**：音量在 `MediaPlayer` / `AVAudioPlayer` / `AVSpeechUtterance` 上都能实时或按句生效；语速对系统合成路径按句生效，而**云端通道的语速是请求时烘进音频的**，那一路只有音量在淡。系统 TTS 无音量接口，`setSpeechRate` 只影响之后排队的 utterance，所以是「下一张开始变轻变慢」而不是当前这张平滑淡出。曲线是纯函数 `SleepFade.plan(remaining, window)`：窗口外满音量，窗口内线性收到 0.15 音量 / 0.9 语速（留余声，避免突然安静把人弄醒）。

## 网页剪藏（WebClipEngine / WebClipFetcher）
**「抽正文」和「提炼成卡片」是两步，中间必须让人看一眼**：抽取是无损的、提炼是有损且花额度的，所以面板先给正文预览，点「AI 提炼成卡片并置顶入堆」才写库（`source = IMPORTED`，来源链接排在 `links` 最前以便回到原文）。
内核是**双端逐条对齐的规则表**（Swift `KnowFlickCore/Models/WebClipEngine.swift` ↔ Kotlin `domain/WebClipEngine.kt`，夹具 HTML 与期望值两边逐字相同）：UTF-8 字节扫描、丢脚本/导航/页眉页脚/表单/评论子树、`<article>`/`<main>`/id-class 候选挑正文（否决词优先，占整页不足一半则退回整页）、实体解码、样板行过滤、**按行截断 4000 字**（与提炼提示词既有预算同档，不单开 token 档）、charset 按「HTTP 头 → `<meta charset>` → UTF-8」解析（中文站 GBK/Big5 不能出 ``）。
三条边界：① 链接只收 http/https，带 `user:pass@` 的**直接拒**（否则凭据会被写进卡片来源链接）；② 抓取是匿名只读（不收不发 Cookie、不落盘缓存、4 MB 上限、15 s 超时），并**沿用 App 既有的明文策略**（只对回环放开 HTTP），不为剪藏放宽；③ 所有判定下沉成纯函数（`digest(fromBytes:contentType:)`），网络层只搬字节。
Android 入口是 `ACTION_SEND text/plain`（**不注册 `ACTION_VIEW`**，否则本 App 会被列成系统默认浏览器候选）+ 卡堆 ⋮ 菜单；分享进来直接开面板并自动抽取。

## 卡堆 / 队列（Deck）
未看过（`seenAt == nil`）的卡片，`deck.first` 为顶卡。**偏好分类开启时优先只刷偏好分类；偏好分类未看卡耗尽后回退全量**（不藏死其他卡）。偏好解析用 `CategoryRegistry.resolve`（无法识别的输入剔除，不做「科技」兜底——否则未知输入会伪装成真实科技偏好）。**来源开关（enableSeed/enableAI）在偏好过滤前生效**：只开其一则只看该来源，**全关则队列为空（含导入卡片）**。**卡堆输出前统一经 `CardThemeResolver.arrangeWithMinDistance(minDistance: 5)` 处理**：先按确定性盐值哈希全局打散，再贪心排布保证同背景图 key 间隔 ≥ 5 张（key 多样性充足时成立；候选不足时退化为「最大化间隔」的贪心选择，不保证严格间隔），杜绝日常刷卡连续撞图，并有性质测试护栏（CardThemeResolverTests）。

## 历史（History）
看过（`seenAt != nil`）的卡片，按时间倒序。

## 统计（Stats）
从 `store.cards` 纯派生的快照（`LearningStats`，`StatsCalculator.compute`），视图只做格式化。连续天数按日去重、允许「今天未刷从昨天起算」的空档。`skip` 计入已刷，不计入喜欢。`dailyCounts` 提供近 7 天趋势（纯计算）。

## 分类主题（CategoryTheme）
卡片内容/分类名 → 视觉主题（背景图 key / accent / ambient）。采用**领域关联多图池（Thematic Multi-Image Pools）+ 细化语义识别 + 标题哈希兜底**的多维映射机制：划分计算机与 AI、商业财会金融、自然宇宙科学、人文心智四大领域多图池（计算机与 AI 15 张、自然宇宙科学 15 张、人文心智 10 张、商业财会金融 8 张，共 42 张专属摄影底图），即使在「中级会计」或「AI Agent」等单分类内刷卡也张张不同；配合确定性打散与相邻防重，彻底杜绝连续撞图。主窗口环境背景光（ambient）与当前卡片及划卡飞出动画实时深度联动。

## 存储（Storage）
`Storage` 实例可注入目录。卡片文件三级回退：cards.json → cards.backup.json（轮转保留上一版）→ 重播种。API key 单独存 Keychain，不入 JSON。AppStore 内所有落盘统一经 `persist()` 单入口：**350ms 节流合并 + Task.detached 后台执行**（连续刷卡只写最后一次，JSON 编码与文件 IO 不卡主线程）。应用启动时自动执行**种子库增量合并**，自动引入新版本内置扩充的卡片，老用户无缝获得全新内容。

## AI 服务与服务商预设（AIService / AIProviderPreset）
OpenAI 兼容端点客户端，**流式生成**：SSE 逐行接收 + 增量对象扫描，拿到目标数量即提前终止（省时省额度）；429/5xx 自动重试。失败通道统一为抛 `AIError`：传输/解析层失败抛对应 case；「请求成功但无可用产出」抛 `noUsableCards`。排除标题截断上限（100）由服务单点决定；max_tokens 按生成数量动态计算（≈900/张 + 400 缓冲）。

内置 AI 服务商预设（`AIProviderPreset`，共 16 档，清晰划分为在线 API 服务与本地部署运行）：
- **在线 API 服务**：DeepSeek (官方)、硅基流动 (SiliconFlow)、Kimi (月之暗面)、智谱 GLM / BigModel、阿里云百炼 (通义千问)、OpenCode Go、基元律动 (TokenRhythm)、小米 MiMo (Xiaomi)、LongCat (长猫科技)、蚂蚁百灵 (AntDigital)、NVIDIA NIM、AMD 开发者平台 (Token Factory)、OpenAI (官方)
- **本地部署运行**：Ollama (本地私有)、本地代理网关 (:31415)（自动识别无需输入 API Key）
- **自定义**：自定义服务商（灵活配置任意第三方 OpenAI 兼容网关与专有端点）

生成质量链：分类经 `CategoryRegistry.normalize` 归一化到受控分类（未知兜底第一个自定义分类，无自定义则「冷知识」）→ 字面去重（normalizeHeadline）→ 近重复抑制（bigram Jaccard > 0.35 丢弃）→ 内容 ≥80 字门槛。链接用「关键词 + 权威来源站名」构造 Bing 检索（AI 给的 `sources` 优先，缺失时用设置里 `aiSources` 站点偏好兜底）。`ping` 为轻量连通性探测（max_tokens=1，非流式）。

**AI 内容标记（showAIMark）**：AI 卡片正面显示橙色徽章、详情页显示「由 AI 生成，请核实」提示条、历史列表标注 AI；关闭开关后全部隐藏。

## 设计系统（EditorialDesignSystem / ThemeTokens）
全局统一的语义化视觉规范。采用**暗色人文画报风（Dark Editorial）**：以 `Songti SC Black`（宋体粗体）为主标题字模，正文辅以系统衬线体，界面标签采用 SF Pro；色彩分层统一为底色、半透明磨砂表面（Glass Surface）、分类强调色与文字层级阶梯。

## 动态遮罩（DynamicScrim）
覆盖在卡片与详情页摄影背景图上的多阶非线性暗化渐变层，旨在弱化背景复杂纹理对前景文本的干扰，确保宋体大标题与正文达到高对比度可读。

## 触觉反馈（HapticFeedback）
macOS 触控板在刷卡交互中的实体感知回馈。当卡片滑动位移/速度达到划出判定门槛，或松手触发磁吸回弹时，由系统触觉引擎（NSHapticFeedbackManager）触发瞬态震动。

## 模态路由（ActiveSheet）
统一管理主界面的所有模态弹窗（设置、统计、历史、快捷键）。macOS SwiftUI 下多 `.sheet` 链式挂载会发生覆盖冲突，通过 `enum ActiveSheet: Identifiable` 单一状态入口调度，彻底杜绝按钮点击失效。

## 悬浮飞出层（FlyingCardOverlay）
划卡瞬间将目标卡片移入顶层独立悬浮渲染层（ZIndex 999），并在无动画事务中立即向 AppStore 提交状态变更与归零底层位移。底层新顶卡平稳就位，飞出卡片独立飞离淡出，彻底消除卡片瞬跳与换卡背景闪烁。

## 原生应用图标（AppIcon）
遵循 macOS Sonoma / Sequoia 几何规范制作的原生超椭圆（Squircle）图标（母版 1024×1024，内含标准投影与微质感光边），经 `iconutil` 生成覆盖全档 Retina 分辨率的 `AppIcon.icns`。

