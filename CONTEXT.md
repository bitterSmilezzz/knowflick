# KnowFlick 领域词汇

> 单文件领域术语表（无 ADR）。架构评审与实现以此语言为准。

## 卡片（Card）
一条领域知识（不限冷知识）：`category` / `headline` / `summary` / `details` / `links`，来源 `source`（seed 预置 / ai 生成）。内容与浏览状态在同一结构上（`KnowledgeCard`），浏览状态字段见下。

## 分类体系（CategoryRegistry）
**内置「冷知识」分类（不可删改，收纳 160 张预置卡）+ 用户自定义分类（可增删改，默认预置：AI / AI 开发 / AI Agent / 中级会计 / 投资理财，各带内容方向描述）**。`resolve(_:custom:)` 解析到有效分类（别名映射仅在目标分类存在时生效）；`normalize` 无法识别时兜底到第一个自定义分类（无自定义则冷知识）——偏好解析用 resolve（剔除未知），AI 生成用 normalize。AI 生成白名单 = `allCategoryNames`（内置+自定义），每类按描述定制内容方向。

## 刷卡（Swipe）
用户把当前卡片划走的行为，记录为 `seenAt` + `swiped`。
- `left`：不喜欢（用户明确表达）
- `right`：感兴趣（用户明确表达）
- `skip`：**系统跳过**——「换一批」等系统批量操作产生的浏览，仅计已刷，**不表达喜好**（v1.4 起引入，此前系统操作误写 `.left` 污染统计/历史）

规则：对 `seenAt`/`swiped` 的任何写入都必须经由 AppStore 的意图化方法（`swipe` / `undoLastSwipe` / `clearHistory` / `refreshDeck`），视图不得直接改字段。

**收藏（isFavorite）与喜好（swiped）解耦**：`isFavorite` 是独立布尔字段，取消收藏**不会**改写 `swiped`（避免把「感兴趣」污染成 `skip`、或抹掉「不喜欢」）。两条写入路径：① `toggleFavorite` 只翻转 `isFavorite`（不写 `seenAt`，收藏未读卡不等于已浏览）；② `swipe` 在写喜好意图的同时同步收藏态——`right` 加入收藏、`left` 移出收藏、`skip` 不动收藏。旧数据无该字段时按 `swiped == .right` 回填，保证老用户收藏阁内容不丢。

## 卡堆 / 队列（Deck）
未看过（`seenAt == nil`）的卡片，`deck.first` 为顶卡。**偏好分类开启时优先只刷偏好分类；偏好分类未看卡耗尽后回退全量**（不藏死其他卡）。偏好解析用 `CategoryRegistry.resolve`（无法识别的输入剔除，不做「科技」兜底——否则未知输入会伪装成真实科技偏好）。**来源开关（enableSeed/enableAI）在偏好过滤前生效**：只开其一则只看该来源，**全关则队列为空（含导入卡片）**。**卡堆输出前统一经 `CardThemeResolver.interleavedAndDeduplicated` 处理**：先通过确定性盐值哈希交错打散学科批次，再执行双向相邻防重安全扫描（Anti-Consecutive Duplicate Filter），严格保证连续两张卡片背景绝不相同（0 撞图），并最大化可见卡片栈（visibleStack 3 张）的视觉多元呈现。

## 历史（History）
看过（`seenAt != nil`）的卡片，按时间倒序。

## 统计（Stats）
从 `store.cards` 纯派生的快照（`LearningStats`，`StatsCalculator.compute`），视图只做格式化。连续天数按日去重、允许「今天未刷从昨天起算」的空档。`skip` 计入已刷，不计入喜欢。`dailyCounts` 提供近 7 天趋势（纯计算）。

## 分类主题（CategoryTheme）
卡片内容/分类名 → 视觉主题（背景图 key / accent / ambient）。采用**领域关联多图池（Thematic Multi-Image Pools）+ 细化语义识别 + 标题哈希兜底**的多维映射机制：划分计算机与 AI、商业财会金融、自然宇宙科学、人文心智四大领域多图池（每池 6~8 张专属摄影底图），即使在「中级会计」或「AI Agent」等单分类内刷卡也张张不同；配合确定性打散与相邻防重，彻底杜绝连续撞图。主窗口环境背景光（ambient）与当前卡片及划卡飞出动画实时深度联动。

## 存储（Storage）
`Storage` 实例可注入目录。卡片文件三级回退：cards.json → cards.backup.json（轮转保留上一版）→ 重播种。API key 单独存 Keychain，不入 JSON。AppStore 内所有落盘统一经 `persist()` 单入口：**350ms 节流合并 + Task.detached 后台执行**（连续刷卡只写最后一次，JSON 编码与文件 IO 不卡主线程）。应用启动时自动执行**种子库增量合并**，自动引入新版本内置扩充的卡片，老用户无缝获得全新内容。

## AI 服务与服务商预设（AIService / AIProviderPreset）
OpenAI 兼容端点客户端，**流式生成**：SSE 逐行接收 + 增量对象扫描，拿到目标数量即提前终止（省时省额度）；429/5xx 自动重试。失败通道统一为抛 `AIError`：传输/解析层失败抛对应 case；「请求成功但无可用产出」抛 `noUsableCards`。排除标题截断上限（100）由服务单点决定；max_tokens 按生成数量动态计算（≈900/张 + 400 缓冲）。

内置 AI 服务商预设（`AIProviderPreset`，共 16 档，清晰划分为在线 API 服务与本地部署运行）：
- **在线 API 服务**：DeepSeek (官方)、硅基流动 (SiliconFlow)、Kimi (月之暗面)、智谱 GLM / BigModel、阿里云百炼 (通义千问)、OpenCode Go、基元律动 (TokenRhythm)、小米 MiMo (Xiaomi)、LongCat (长猫科技)、蚂蚁百灵 (AntDigital)、NVIDIA NIM、AMD 开发者平台 (Token Factory)、OpenAI (官方)
- **本地部署运行**：Ollama (本地私有)、本地代理网关 (:31415)（自动识别无需输入 API Key）
- **自定义**：自定义服务商（灵活配置任意第三方 OpenAI 兼容网关与专有端点）

生成质量链：分类经 `CategoryRegistry` 归一化到受控 21 类（未知兜底「科技」）→ 字面去重（normalizeHeadline）→ 近重复抑制（bigram Jaccard > 0.35 丢弃）→ 内容 ≥80 字门槛。链接用「关键词 + 权威来源站名」构造 Bing 检索（AI 给的 `sources` 优先，缺失时用设置里 `aiSources` 站点偏好兜底）。`ping` 为轻量连通性探测（max_tokens=1，非流式）。

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

