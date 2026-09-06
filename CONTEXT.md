# KnowFlick 领域词汇

> 单文件领域术语表（无 ADR）。架构评审与实现以此语言为准。

## 卡片（Card）
一条冷知识：`category` / `headline` / `summary` / `details` / `links`，来源 `source`（seed 预置 / ai 生成）。内容与浏览状态在同一结构上（`KnowledgeCard`），浏览状态字段见下。

## 刷卡（Swipe）
用户把当前卡片划走的行为，记录为 `seenAt` + `swiped`。
- `left`：不喜欢（用户明确表达）
- `right`：感兴趣（用户明确表达）
- `skip`：**系统跳过**——「换一批」等系统批量操作产生的浏览，仅计已刷，**不表达喜好**（v1.4 起引入，此前系统操作误写 `.left` 污染统计/历史）

规则：对 `seenAt`/`swiped` 的任何写入都必须经由 AppStore 的意图化方法（`swipe` / `undoLastSwipe` / `clearHistory` / `refreshDeck`），视图不得直接改字段。

## 卡堆 / 队列（Deck）
未看过（`seenAt == nil`）的卡片，`deck.first` 为顶卡。

## 历史（History）
看过（`seenAt != nil`）的卡片，按时间倒序。

## 统计（Stats）
从 `store.cards` 纯派生的快照（`LearningStats`，`StatsCalculator.compute`），视图只做格式化。连续天数按日去重、允许「今天未刷从昨天起算」的空档。`skip` 计入已刷，不计入喜欢。

## 分类主题（CategoryTheme）
分类名 → 视觉主题（背景图 key / accent / ambient）。specs 表是唯一视觉事实源，未知分类统一回退 tech 主题。**分类身份的模型层事实源是 `CategoryRegistry`**（受控 21 类 + 别名归一化，AI 生成卡片在服务内即完成归一化，UI 侧几乎不会遇到未知分类）。

## 存储（Storage）
`Storage` 实例可注入目录。卡片文件三级回退：cards.json → cards.backup.json（轮转保留上一版）→ 重播种。API key 单独存 Keychain，不入 JSON。AppStore 内所有落盘统一经 `persist()` 单入口。

## AI 服务（AIService）
OpenAI 兼容端点客户端，**流式生成**：SSE 逐行接收 + 增量对象扫描，拿到目标数量即提前终止（省时省额度）；429/5xx 自动重试。失败通道统一为抛 `AIError`：传输/解析层失败抛对应 case；「请求成功但无可用产出」抛 `noUsableCards`。排除标题截断上限（100）由服务单点决定；max_tokens 按生成数量动态计算（≈900/张 + 400 缓冲）。

生成质量链：分类经 `CategoryRegistry` 归一化到受控 21 类（未知兜底「科技」）→ 字面去重（normalizeHeadline）→ 近重复抑制（bigram Jaccard > 0.35 丢弃）→ 内容 ≥80 字门槛。链接用「关键词 + 权威来源站名」构造 Bing 检索（AI 只给来源名不给 URL，防幻觉）。`ping` 为轻量连通性探测（max_tokens=1，非流式）。
