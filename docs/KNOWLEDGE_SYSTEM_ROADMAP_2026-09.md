# 知识体系 · 星图 · Agent 接入 —— 大方案（2026-09-21）

> 面向决策的一页纸 + 分阶段落地清单。当前状态：**方案待你确认，未动代码**。
> 上一轮已完成的独立工作：mac 语音听书控制台与 Android 能力同构（见文末"已完成"）。

---

## 0. 一页结论

你要的四件事，本质是**一条主线 + 三个支撑**：

| | 结论 | 依据 |
|---|---|---|
| **主线：内容体系** | 从"214 张零散冷知识"改成 **学科 → 分支 → 难度（L1–L5）** 三级体系；可"专学一条支线"也可"多选混合" | 现在分类是**单层字符串**，`category` 被 **406 处引用、跨 102 个文件**使用，改语义等于全仓重写；只能**加字段**，不能改字段 |
| **支撑 1：素材导入** | 你定素材格式，我修 `tools/import_lessons.py` 成正式管道（现在它把三级课程压成一级，英语课甚至被标成"冷知识"） | `tools/import_lessons.py:31-36` |
| **支撑 2：星图** | **降级为"概览"**：Android 端止血（加缓存 + 手势态下沉）+ 按分支**分片构图**。实测冷构图是超平方的：214 卡 0.46 s，2400 卡 **95.6 s** → 内容一多全景图必炸，这不是审美问题是性能问题 | 卡顿根因已定位：`KnowledgeGraphScreen.kt:108` 每次卡片变化全量重构图（mac 有缓存，Android 没有），`kt:103-105` 手势的 scale/pan 存在组合状态里 → 每个手势事件触发整树重组 |
| **支撑 3：Agent 接入** | **纯本地先做**：仓库内一个 Node stdio MCP server 直接读现有 JSON（你机器上已有 Node v24），零 App 改动；App 内 loopback HTTP 作为二期 | MCP 官方对同机场景推荐 stdio（无端口、无 Origin/令牌问题）；Qoder CLI 支持 `qoder mcp add` 与 `/mcp reload` |
| **上云** | **暂不需要**。唯一值得动用外部服务的是"语义向量"，而它可以是**一次性批量编码**（内容不出你控制的接口、结果落在本地文件），不等于上云 | 5k×1024 维 fp32 ≈ 20 MB，端侧暴力点积几十毫秒，**不需要数据库也不需要 ANN** |

**一句话**：先把"学科树 + 难度阶梯 + 你的素材"做实，星图退居概览并止血；Agent 用本地 MCP 读同一份数据；云只在"要多设备并发读写 / 手机也要连"时才引入。

---

## 1. 现状事实（可核查）

### 1.1 内容

- 种子卡 **214 张**（`shared/assets/seed_cards.json`）：冷知识 160、投资理财 13、中级会计 12、AI 10、AI 开发 10、AI Agent 9。**没有**：英语分级、会计初/高级、编程架构科普、金融报表分析的成体系内容。
- 单卡正文长度：中位数 **423 字**、均值 453、最大 890；全库约 **9.7 万字**（≈13.6 万 token）。这是估算 embedding 成本与包体的基准。
- 卡片字段（双端逐字段对齐）：`category / headline / summary / details / links / source / createdAt / seenAt / swiped / isFavorite / favoritedAt / reviewCount / masteryLevel / lastReviewedAt / repetition / intervalDays / easeFactor / stability / difficulty`。
  - 注意：`difficulty` 已被 FSRS 占用，含义是**记忆难度**，不是内容难度 → 新字段必须换名（见 §2）。
- `CategoryRegistry` 只支持"内置冷知识 + 扁平自定义列表"，且有一张别名归一表把「英语 → 语言」「会计 → 中级会计」硬压平（`CategoryRegistry.swift:17-59`、`.kt:16-58`）。

### 1.2 星图

- 构图算法：中文 2/3-Gram + 英文 token 抽关键词 → 分类角 + 确定性哈希散布坐标（**没有**逐帧引力迭代，坐标一次算完）→ 倒排索引找候选 → 每卡保留最强 2 条边。
- **Android 无图级缓存**：`KnowledgeGraphScreen.kt:108` `LaunchedEffect(cards)` → 划卡、收藏、复习都会重启全量构图。mac 有内容签名 + LRU（`KnowledgeGraphEngine.swift:453-516`）。
- **Android 手势状态放在组合层**：`kt:103-105` `var scale by remember { mutableFloatStateOf(1f) }`，每次手势事件让整棵 Composable 重算；画布内还有逐帧 `String.contains`（`kt:297`）与逐节点 `drawText`+substring（`kt:354-364`）。卡片堆那轮优化已经用过同一招（`swipeProgressProvider` 把高频值移进 `graphicsLayer` 延迟读取），星图**没有沿用**。
- Android 端候选发现里仍有一段对"后续同分类卡片"的线性扫描（`KnowledgeGraphEngine.kt:260-267`），当单分类卡数从 12 涨到 800 时，这一段和 top-2 排序会一起放大。
- 交互能力不一致：Android 有点选/搜索/单选分类/复位/置顶（`kt:564-574`），无缩放按钮与滚轮；mac 有 hover/±缩放/滚轮/空格复位/带计数的分类过滤，**缺"置顶进入卡堆"**。视觉底色两端各写一套（mac 硬编码深邃星空，Android 跟主题走）。

### 1.3 数据与传输

- 存储全是 JSON：`cards.json`(+备份) / `settings.json` / `chat_sessions.json` / `search_history.json` / `speech.json`。**全仓没有任何数据库、没有 embedding 痕迹**。
- 已有本机 HTTP 雏形：两端各自的 `SyncServer`，端口 8998（冲突则 +1）、`X-KnowFlick-Token` = 6 位配对码、`GET /api/info`、`GET/POST /api/cards`、25 MB 上限、POST 走字段级 `mergeCard` 对称合并。**但 mac 端监听 `INADDR_ANY`**（`SyncServer.swift:69`），只适合局域网配对码场景，不适合直接扩成 Agent API。
- 检索：自研多字段加权 + 拼音全拼/首字母（`KnowledgeSearchEngine.swift:67-276`）——**字面匹配强、语义弱**，"怎么看一家公司现不现金流健康" 搜不到 "经营活动现金流净额"。
- 导出出口已齐：JSON / 单文件 Markdown / Obsidian 双链包 / Anki TSV，双端对齐。

### 1.4 工程约束

- Android：minSdk 26 / target 35；依赖只有 Compose、coroutines、kotlinx-serialization、okhttp、security-crypto、Glance；R8 + 资源压缩。发布 APK 约 5.1 MB 量级（0.9.0 记录）。
- mac：SwiftPM，macOS 14+，Swift 6 严格并发，**零第三方依赖**。
- CI：`macos.yml` 跑 `./tools/test.sh` + 打包 + 种子一致性 + 启动自检；`android.yml` 跑 JVM 单测 + lint + debug/release APK + 共享资产校验。
- **本机验证边界**：这台机器只有 Command Line Tools、无 Xcode（缺 `libSwiftUIMacros.dylib`），**SwiftUI 层无法本地编译**，只能 `./tools/test.sh --core-only` + 语法解析。所有涉及 mac UI 的阶段都需要你在 Xcode 或 CI 上确认一次。

---

## 2. 数据模型：三级学科体系（加字段，不改语义）

```
Subject  学科   ：AI · AI 开发 · 英语 · 会计 · 金融 · 编程架构
Branch   分支   ：英语 > {语法, 词汇, 听力, 写作}      会计 > {存货, 固定资产, 收入, 财报}
Level    难度   ：L1 入门 · L2 基础 · L3 进阶 · L4 应试/实战 · L5 精通
                    （英语另挂标尺：高中 / CET-4 / CET-6 / 考研；会计：初级 / 中级 / 注会）
```

**卡片新增**（双端同步 + JSON 可选字段，缺省即视为 `subject=nil` 的旧卡）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `subject` | String? | 学科slug，如 `english` |
| `branch` | String? | 分支slug，如 `grammar` |
| `level` | Int? (1-5) | 内容难度；与 FSRS `difficulty`（记忆难度）**完全无关**，两个都要 |
| `track` | String? | 应试标尺名，如 `CET-6`、`中级会计` |
| `prereq` | [String] | 前置卡 id（学习路径的边，导入管道按分支内顺序自动填） |
| `orderKey` | String? | 分支内序号，决定"一点点看"的推进顺序 |

**`category` 保留**为展示用叶子名，由 `subject + branch` 派生（旧数据不动）。这样 406 处引用零改动，而新能力（选支线、混合、递进）读新字段。

**学科注册表升级**：`CategoryRegistry` 的扁平 `{name, description}` 变成 `{subjects: [{slug, name, color, branches: [{slug, name, levels, description}]}]}`，仍存 settings.json，仍向后兼容（老 JSON 走现有别名表兜底）。同时把「英语→语言」「会计→中级会计」这类**压平别名**改成"映射到学科"而不是"改写成另一个分类"。

---

## 3. 内容管道（你的选择：素材你喂，管道我搭）

### 3.1 需要你提供的三种素材之一（都支持，混着给更好）

1. **结构化课程 JSON**（已有基础）：`part → topic → lesson`，就是 `tools/import_lessons.py` 期望的形状；
2. **Markdown 目录**：一个学科一个目录，一级标题=分支、`##` =卡、正文=details，front-matter 里写 `level`/`track`；
3. **表格/词表**：CSV/TSV（如 CET-4/6 词表、会计科目表、财报科目），走"批量模板卡"生成。

### 3.2 管道要做的事（`tools/` 下一条命令搞定，CI 校验）

```
python3 tools/build_curriculum.py --source <素材目录> --subject english \
        --map subjects.yaml --out shared/assets/seed_cards.json
```

- **学科映射表** `subjects.yaml`：替代现在写死在 Python 里的 `CATEGORY_MAP`（当前把英语课标成"冷知识"就是这个表的问题）；
- **分级判定**：优先取素材里的显式 `level`；没有时按启发式（词汇量、句长、术语密度）给建议，并输出**待人工抽检清单**，不静默定级；
- **拆分与合卡**：一条 lesson 太长（>1200 字）自动按小标题切成多卡，保持 `orderKey` 连续；
- **前置边**：同分支内按顺序生成 `prereq`，跨分支只允许显式声明（避免编造关联）；
- **幂等与去重**：沿用 `CardImportEngine.normalizeHeadline` 的标题归一口径，重复导入只更新不新增；
- **CI 守门**：`android.yml`/`macos.yml` 现在已经在核对种子一致性，扩为：卡片必须落在注册表声明的 subject/branch 内、`level ∈ 1..5`、`prereq` 指向存在的卡、总卡数与体积预算（见 §9 红线）。

### 3.3 AI 生成：从"随便生成"改成"按阶梯补齐"

现有生成流水线（`AIService.swift:115-124, 266-310`、`AiTextUtils.kt:44-94`）提示词里只有"分类白名单 + 方向描述"。改法是给它三个新参数：`学科 + 分支 + 目标难度`，并让它**先出大纲再出卡**：

1. 第一步让模型输出该分支的 L1→L5 大纲（知识点列表 + 建议顺序）；
2. 你（或脚本）确认后，第二步按大纲逐点生成卡片，`orderKey/prereq` 用大纲的；
3. 硬事实类（词表、准则数字、公式）**禁止 AI 生成**，只能来自你导入的素材——管道里按 `source` 标灰，统计中心里能看出"AI 生成 vs 教材导入"占比。

**目标量级**：6 个学科 × 4–8 个分支 × 5 个难度 ≈ 1.2k–2.4k 张为第一阶段；上限 5k（超过就撞上 §4 的分片策略与 §9 的包体红线）。

---

## 4. 主线 UI：学科树 + 学习路径（星图退居概览）

**新主入口（双端）**："学习地图"

```
学科卡（AI / 英语 / 会计 / 金融 / 编程） 
  └ 分支列表（每条分支显示：卡数、已学/未学、当前难度、进度%）
       └ 支线模式：只刷这一条分支，按 orderKey 一级一级推进
       └ 混合模式：勾选多条分支/多个难度 → 交叉成一组卡堆
```

- **"一点点看"** = 把 `DeckDeriver` 的过滤条件从"preferredCategories 做 OR"（`DeckDeriver.swift:54-58`）升级为 `subject/branch/level` 的**选择集合 + 排序按 orderKey**，并加一条"未学优先、难度就近递进"的排序规则；
- **进度可见**：分支卡上显示"3/40 · L2"；学完 L2 才把 L3 的卡放进卡堆（可关，纯"混着刷"也支持）；
- **测验/统计跟着分层**：`QuizView/QuizScreen` 已有按分类出题的能力，扩成按"分支+难度"；`StatsCalculator` 增加"各学科掌握度分布、当前支线进度"；
- **星图定位**：从"全屏漫游一张大图"改成 **"当前学科/分支的邻域图"**——默认只画一条支线的星团 + 跨支线引力，进"全景"要看得到缩略图与帧率下限。视觉上跟主题走（沿用现有纸质主题 token），不再是 mac 端那层写死的深空底；
- **UI 浑然一致**：把现在散落在各文件的圆角/字号/间距硬编码收进已有 `EditorialRadius`/`EditorialFont`，两端建一份"设计契约"清单（同一控件同一命名），星图/详情页/测验/搜索的卡片样式统一由它出。

---

## 5. 星图止血清单（Phase 0，纯本地，收益最快）

Android（重点，手机卡的是这里）：

1. **图级缓存**：照搬 mac 的"拓扑字段签名 + LRU"，划卡/收藏不再重算（`KnowledgeGraphEngine.kt` 加 `graphSignature`）；
2. **手势态下沉**：`scale/pan` 从组合层移进 `graphicsLayer`/`drawScope` 的延迟读取（与 `CardFace.kt` 的 `swipeProgressProvider` 同招），拖拽时**零重组**；
3. **每帧零分配**：节点坐标预变换成屏幕坐标数组（`FloatArray`）、标签文本预先截好（不要在 `drawText` 里 `take(7)+"…"`）、可见性判定不查字符串（把 `headline.contains(query)` 换成预先算好的 `matchedIds: Set`）；
4. **候选扫描**：去掉"后续同分类线性扫描"（`kt:260-267`），改成分类内倒排 + 有限候选，并按分支分片；
5. 引力布局**不做**逐帧迭代（现在是一次定位，保持）。

mac：手势与 hover 的 `@State` 下沉 + 未 memoize 的 `connectedNodeIdsForSelectedOrHovered`（`swift:48-56`）、每分类计数（`swift:204`）加缓存；补"置顶进入卡堆"与 Android 对齐。

**分片（P1.5，已完成）**：构图输入从"全库"改成"当前学科那一片"（分区函数进 Core：`SubjectRegistry.subjectSummaries` / `cards(_:in:)`；视图侧 Android `GraphShard` / mac `GraphShard`）。默认视图是一片学科（亚秒级），**「全部星系」降级为显式选项**；胶囊栏两端统一成「学科名 (卡数)」并含「未分级」片；图缓存 2 → 6，来回切片不再重算。

**自适应视口（P1.5 之后追加，实测才是"很烂"的主因）**：世界画布固定 1400×1400（mac 1200×900），手机屏只有 320px 宽，**进图永远只看到左上角一块**。补 `fitToViewport`（纯函数，双端同口径 + 各 3 个用例）：按节点包围盒等比缩放并居中，「复位」按钮语义随之改成"重新自适应"。

**扇区铺开（同一轮）**：节点角度原来只在所属学科扇区中轴附近抖 ±0.45rad——只有 1~2 个学科的片会**塌成一条横线**。改为角度铺满整个扇区、半径按 `sqrt` 均匀覆盖面积（两个独立确定性哈希，坐标仍永远稳定）。

**标签 LOD 跟着改**：旧规则「缩放 <0.75 就不写字」与自适应冲突（19 个点的片屏幕很空却一个字不写）。改成按**屏上可见节点数**判定（≤40 个就写），实测 AI 片已能看到「ReAct：让…」「过拟合：模型把…」等标题。

**剩余问题（P5 处理）**：小分片内标签仍会互相压字（AI 片底部 3~4 条重叠）。正解是贪心避让——维护已占用的矩形数组，碰撞则跳过；需要固定容量数组以保持逐帧零分配。

**有意不做全景落盘缓存**：分片成为默认视图后，18s 级的全库构图只剩"显式看全景"这条低频路径。为它引入缓存文件、格式版本与失效逻辑是净负债；等全景真的变成日常路径再谈。

**验收指标**（写进 CI 性能测试）：手机拖动/缩放期间帧时间 < 16 ms（120Hz 机型 < 8.3 ms）；单片冷构图 < 1.5 s、增量重算 < 50 ms；全景冷构图**不阻塞 UI 且进度可见**；构图期间主线程 0 阻塞；划卡/收藏引发的重建必须命中缓存。

---

## 6. 检索升级：语义向量，但**不为它引入端侧 NN**

### 6.1 为什么本地端侧 embedding 现在不值得

- Apple `NLContextualEmbedding` 支持 `zh-CN`、下载完可离线（官方文档），但**模型资产要联网下载、中文检索质量无官方评测**，且资产在大陆的可达性属未实测项；
- Android 侧 ML Kit/Gemini Nano **不含 embedding 能力**且依赖 Play 服务（大陆基本不可用）；剩下只有 LiteRT/ONNX + 自搬权重（bge-small-zh 约 95.8 MB / 512 维），APK 增量 15–25 MB 起，直接顶穿你现在的"5.1 MB 包体"；
- 5k 卡规模下，**向量存下来 + 端侧点积**这件事本身极便宜：5k×1024 fp32 ≈ 20 MB，`vDSP`/Kotlin 暴力扫是几十毫秒级。难的从来是"谁来算向量"，不是"谁来存和查"。

### 6.2 推荐路线（一次外呼，结果永久本地）

1. **一次性批量编码**：用你已经配好的 SiliconFlow（`/v1/embeddings`，OpenAI 兼容，bge-m3，input 数组上限 32；定价页当前标免费 → **需实测确认**）把全库编码成 `vectors.bin` + `vectors.json`（cardId → offset）；
   - 备选：阿里云百炼 `text-embedding-v4`（默认 1024 维，**单批只 10 条**，0.0005 元/千 token，90 天内 100 万 token 免费 → 我们全库 13.6 万 token，**一次约几分钱到几毛钱**）；
2. **向量文件随现有局域网同步一起走**（新增一个 `/api/vectors` 端点），手机不需要再联网；
3. **端侧只做点积**：mac 用 Accelerate/vDSP，Android 用 Kotlin 循环或 `Float32Array`；结果与现有 `KnowledgeSearchEngine` 的 BM25/拼音分数做**混合排序**（推荐 0.6 语义 + 0.4 字面起步，可设）；
4. 新增卡时**增量编码**（设置里一个"补齐向量"按钮，明确显示本次将发送多少字）。

### 6.3 隐私：把话说清楚，不用"有风险"三个字糊过去

- 走云端编码 = **把知识库正文发给第三方接口**（9.7 万字起）。境内合规 ≠ 端到端加密；各家是否用请求数据训练需逐家核对条款；
- **可控降级**：只上传 `headline + summary`（约 6 万字里最靠前的信息密度部分），正文永不出本机，用 cardId 做映射——语义召回会损失"正文细节命中"，但覆盖你 90% 的"找那张卡"场景；
- 明确开关：设置里"语义检索：关闭 / 仅标题摘要 / 全文"，默认**关闭**，首次开启时显示将要发送的字数；
- 结论：**这件事不是"必须上云"，是"愿意为一次编码外呼吗"**。不愿意，就先停在字面检索（它已经够强），把预算花在地基上。

---

## 7. Agent / MCP 接入

### 7.1 协议事实（截至 2026-09，官方文档）

- 当前稳定 spec **2026-07-28**：取消 `initialize` 握手与 `Mcp-Session-Id`，新增 MUST 级 `server/discover`，HTTP+SSE 正式废弃，标准传输只剩 **stdio + Streamable HTTP**；
- **同机场景官方推荐 stdio**（客户端自己 spawn 进程，没有端口、Origin、令牌这些面）；
- SDK 现状：TS v2.0.0（已实现 2026-07-28）、Python v2.2.0、**Swift 0.12.1 仍按 2025-11-25 实现**（无状态改造是 open issue）；
- 客户端接入：Qoder CLI `qoder mcp add <name> -- <cmd>`，配置在 `~/.qoder/settings.json` / `.mcp.json`，支持 `-t stdio|http` 与 `/mcp reload` 热加载；Claude Desktop 改 `claude_desktop_config.json` 后要重启；Cursor 用 `.cursor/mcp.json`。（本机 `~/.qoder/settings.json` 目前**还没有** `mcpServers` 键，接入时会新建。）

### 7.2 方案 A ✅ 已完成（App 零改动）

落地在 `tools/knowflick-mcp/`（零依赖 stdio JSON-RPC，Node ≥ 20；接入方式与安全边界见
`tools/knowflick-mcp/README.md`）。实测数据来自**你的真实卡库**（只读）：

```
cards 216 · 地图：冷知识:83, AI:25, 会计:24, 编程架构:16, 金融:13, AI 开发:10, 英语:2, 未分级:43
kf_search "存货跌价准备" → 5~8 命中；kf_learning_path(trivia) → 5 步
```

「未分级 43 张」正是你真实库里分类不在契约内的部分——`kf_browse_map` 把它单独成组，
下一步（P1.2 填内容）就是把这些和空白学科一起补齐。

CI 已加 `node --test tools/knowflick-mcp/test.mjs`（7 项，含两次真的 spawn server 走
initialize → tools/list → tools/call 往返）。

<details><summary>原设计（已按此实现）</summary>

### 7.2.1 设计

`tools/knowflick-mcp/` 一个 **Node stdio MCP server**，直接读同一份 `cards.json`。工具面：

| 工具 | 作用 | 读写 |
|---|---|---|
| `kf_search` | 字面 +（若有）语义检索，返回 cardId/标题/摘要/学科分支难度 | 只读 |
| `kf_get_card` | 取整卡 | 只读 |
| `kf_browse_map` | 导出学科树 + 每分支进度（已学/未学/当前 level） | 只读 |
| `kf_path` | 某分支的学习路径（按 orderKey + prereq 拓扑序） | 只读 |
| `kf_graph_neighbors` | 星图邻域（节点/引力边），给 Agent 当"知识地图"用 | 只读 |
| `kf_stats` | 你的掌握度分布、薄弱分支 | 只读 |
| `kf_stage_card` | Agent 生成的新卡进**暂存队列**（`staged_cards.json`），App 内审核后入库 | 写（隔离） |
| `kf_record_review` | Agent 陪练后回写复习评分 | 写（可选，默认关） |

关键设计：**Agent 不直接改 `cards.json`**。写入走 `staged_cards.json` 队列 → App 里像现在的"导入笔记"一样预览/合并（复用 `CardImportEngine` 的去重与字段级合并），这样永远不会出现"Agent 写了半条、App 又整表覆盖"的丢数据竞态。

### 7.3 方案 B（二期，真"知识库服务"）

把 mac App 变成 **loopback Streamable HTTP MCP server**：

- **另起一个只绑 `127.0.0.1` 的监听器**，与 8998 局域网同步服务分开（同步服务的 6 位配对码不适合当 API 凭据；现状 mac 端还绑在 `INADDR_ANY`，`SyncServer.swift:69`）；
- 凭据：设置里生成/存放随机长 token 到 **Keychain**，MCP 客户端配 `Authorization`；按规范 MUST 校验 `Origin`，不匹配 403（防 DNS rebinding）；
- 端点做细粒度：`GET /cards/{id}`、`POST /search`、`GET /map`、`POST /staged` —— 现在只有全量 GET/POST，Agent 拉一次就是整库；
- 用 Swift MCP SDK 嵌入（技术上可行：纯 Foundation 的 HTTP transport、macOS 13+），**但它目前实现 2025-11-25 版本**，而 Qoder/Claude 客户端接受哪些 revision 我没能核实 → 落地前先用 `mcp-proxy` 或直接手写 `initialize`/`tools/list`/`tools/call`（数百行）做一版兼容层验证。

### 7.5 方案 A 的第二条腿：CLI 与 Skill（✅ 已完成）

MCP 只对"支持 MCP 的客户端"有效。剩下三类场合——其它 Agent、CI/脚本、用户没注册 MCP——需要一条零配置入口，所以补了：

- **`tools/knowflick-mcp/kf.mjs`**：与 `server.mjs` 共用 `lib.mjs`，命令一一对应（`search/get/map/path/stats/stage/staged`）。默认输出**给模型读**的紧凑文本（摘要 96 字、正文 1200 字截断，`--json` 才给原始结构），避免一次检索灌满上下文。
- **`.qoder/skills/knowflick-kb/SKILL.md`**：把"怎么用这个库"的工作流固化下来——先看 `map` 建地形、引用论断前必须 `get` 全文并带卡片 id（这是"引用已学知识"与"编得像已学知识"的唯一区别）、路径类问题交给 `path` 不自己重排、沉淀一律走 `stage` 且**必须告知用户还要在 App 里确认**。

一致性不是口头承诺：`test.mjs` 里有一条断言 CLI 与 MCP 对同一查询返回**同样的 id、同样的顺序、同样的 score**，还有一条断言 `stage` 之后 `cards.json` **一个字节都没变**。写入口只有暂存队列这一条，Agent 毁不掉用户的学习记录。

### 7.4 哪些必须上云、哪些不必（明确划界）

| 诉求 | 本地能否做 | 说明 |
|---|---|---|
| Agent 检索/读知识 | ✅ 能 | 方案 A 当天可用 |
| Agent 写回新卡 | ✅ 能 | 走暂存队列 + App 审核 |
| 语义检索 | ⚠️ 半 | 向量文件本地查；**算向量**要么端侧（重、包体大）、要么一次外呼 |
| 手机上的 Agent 也连 | ❌ 不能（跨网段） | 需要 VPS/NAS 上的 HTTP MCP + Tailscale/IPv6 |
| 多设备并发写、冲突可审计 | ❌ 不宜 | 文件级 JSON + 局域网两两同步不适合三方并发 |
| 公开分享/多用户 | ❌ 不能 | 需要账号与 OAuth（MCP Registry 明确不收 private/home-hosted） |

---

## 8. 里程碑（建议顺序与交付物）

| 阶段 | 内容 | 影响面 | 需要你提供 | 风险 |
|---|---|---|---|---|
| **P0 星图止血** ✅ **已完成** | Android：图签名缓存 + 关键词缓存 key 修正 + 去掉同分类线性扫描 + 视口状态移出手臂相位 + 画布变换替代逐点数学 + 预计算标签/颜色/命中掩码；mac：邻接表与学科计数随图一次算好 + 补「置顶进入卡堆」 | `KnowledgeGraphEngine.kt`、`KnowledgeGraphScreen.kt`、`KnowledgeGraphView.swift` + 5 个新 JVM 用例 | 无 | 已验证：Android 198/198、mac 267/267、模拟器功能链路通过 |
| **P1 学科体系地基** ✅ **已完成** | 卡片 6 个可选字段（双端模型 + 线格式 + 合并语义）、`SubjectRegistry` 双端内嵌 + `shared/assets/taxonomy_map.json` 契约、导入管道产出学科坐标与 orderKey、`tools/check_taxonomy.py` 入 CI | 模型/线格式/合并/导入/CI | 素材目录（用于**填内容**，不是建管道） | 已验证：mac 277、Android 208、Python 6、契约守门通过 |
| **P1.2 内容填充** ⏳ 待你给素材 | 用管道把英语词表/考纲、会计、金融报表、编程架构材料导入并分级 | shared/assets | **素材路径 + 样例** | 低 |
| **P1.5 星图分片 + 自适应** ✅ **已完成** | 按学科分片（默认单片、全景显式）、胶囊栏双端统一「名称 (卡数)」含未分级、图缓存 2→6、**视口自适应 fit**、**扇区铺开（不再塌成线）**、标签 LOD 改按可见节点数 | 星图两端 + SubjectRegistry + 11 个新用例 | 无 | 已验证：mac 285、Android 215、模拟器三张实拍（全景/分片/标签） |
| **P2 主线 UI** 🟡 **Android 已完成，mac 视图待补** | 学习地图（学科→分支→难度三级 + 「专学这条支线」/「加入混合」+ 难度阶梯）、卡堆按范围收窄、顶栏范围徽标与退出 | Android `StudyScope.kt`/`LearningMapScreen.kt`/`CardStore`/`DeckScreen` + 11 个新用例 | mac 侧确认交互后平移 | Android 已实测；mac 视图本机编译不了，故未动 |
| **P3 Agent 接入 A** ✅ **已完成** | `tools/knowflick-mcp` Node stdio server（只读 4 工具 + 暂存写回 1 工具）+ 接入文档 | 新目录，App 零改动 | 确认允许 Agent 读全库 | 已验证：7 项协议往返测试通过，含对你真实卡库（216 张）的检索 |
| **P7 听书体验** 🟡 **档位与淡出已完成，mac 后台播控待做** | 四档听书预设（精读标准/温和真人/通勤清醒/睡前轻缓，数值双端逐条一致）+ 睡前淡出（结束前 30 s 音量与语速一起收）+ 控制台档位胶囊 | 双端 `SpeechPreset`/`SleepFade` + `SpeechController`/`SpeechSynthesizerService`/`AppStore` + 31 个新用例 | 无 | 已验证：模拟器实拍（0.85x/低沉/2.5 秒/剩余 19:44 + 系统音色实话提示）、冷启动后档位仍认得 |
| **P3.5 Agent 接入 B** ✅ **已完成** | 零依赖 CLI `kf.mjs`（与 MCP 共用 `lib.mjs`）+ Qoder Skill `knowflick-kb`（工作流：先地图→检索→引用前取全文带 id→沉淀走暂存）+ CLI/MCP 结果一致性测试 | `tools/knowflick-mcp/{kf.mjs,test.mjs}`、`.qoder/skills/knowflick-kb/SKILL.md`、README | 无 | 已验证：9 项 MCP 测试（含 2 项新增 CLI 断言）、对真实 216 张库跑通 7 个命令、真实 `cards.json` 未被写入 |
| **P8 随手收集** 🟡 **Android 完成，mac 视图待补** | 网页剪藏：分享/粘贴 → 抽正文 → 预览 → AI 提炼 → 确认入堆 | 双端 `WebClipEngine` + `WebClipFetcher`、Android 分享入口与面板 + 49 个新用例 | 无 | 已验证：mac 25、Android 24、模拟器端到端实拍（见 §14.2） |
| **P9 桌面与常驻** ⏳ **需要你决策（见 §14.3）** | Windows 客户端路线、后台常驻形态、Skill 打包 | 新平台或新进程 | 选一条路线 | 高（新平台）/低（Skill 打包） |
| **P4 检索与语义** | 混合排序落地；一次性云端编码（含隐私开关与"仅标题摘要"降级）；向量随同步分发 | 检索引擎 + 同步端点 | **是否允许一次外呼** | 中（依赖大陆可达性实测） |
| **P5 星图重做成概览** | 邻域图视觉与主题统一、缩略图导航、帧率预算入 CI | 星图两端 | P1.5 完成后 | 中 |
| **P6 上云（可选）** | VPS/NAS 单进程服务（SQLite+FTS5+向量）对外 HTTP MCP；或先用现成知识库做影子备份 | 新服务 | 明确要多端并发/远程访问后再做 | 高（新增运维与密钥面） |

**当前进度**：P0、P1 地基、P1.5、P3（MCP server）、P2 与 P8 的 **Android 侧**已完成并验证（mac 侧这两项的**内核**同样完成，只差视图——本机没有 Xcode，见 §13.1）；**内容填充等你的素材**，**P9 桌面路线等你选**（§13.3）。
**下一步建议做 P7 听书体验**（§13.2）：它不依赖素材、不依赖新平台，且直接对上你说的「通勤与睡前打开 App 听」。

P0 遗留一项**有意推迟**的活：mac 端拖拽/悬停仍会重建整棵 `body`（含逐节点热区 ForEach）。正确修法是把画布子树提取成自持状态的子 View，属于对 660 行文件的结构性改动，本机无法编译验证，放到 P5（星图重做成概览）一起做。

---

## 9. 红线与不做清单（防过度设计）

- **包体**：Android release APK 现约 5 MB 量级。不为 embedding 引入 ONNX/tflite（+15–25 MB）。若将来必须端侧算向量，先讨论"按需下载模型"而不是打进 APK。
- **零依赖**：mac SwiftPM 目标保持零第三方依赖；Swift MCP SDK 若要引入需单列一次决策（§7.3）。
- **图规模预算**：单次构图输入 **≤400 卡**（对应 §10 的 0.1–1.5 s 区间）；全库上限第一阶段 2.4k、硬上限 5k。分片已把默认视图压进预算；若某单片超 400 卡（例如英语词汇整片），下一步是**片内再按分支分片**，而不是回到全库构图或加落盘缓存。
- **不做**：多用户账号、OAuth 授权服务器、MCP Registry 收录、公开分享链接、云数据库（RDS/PolarDB pgvector 对"个人自用"月成本数百起，明显过配）、ANN 索引（5k 规模暴力扫足够）、逐帧力导向布局（现在的确定性定位更快也更稳）。
- **不重写** `category`：406 处引用摆在那，任何"把 category 改成对象"的方案都要被否。

---

## 10. 实测数据（补空中）

星图构图成本曲线（**本机实测**，mac 引擎含缓存路径，Apple Silicon 后台线程，词表分散的合成卡）：

| 卡数 | 冷构图（全量重算） | 命中签名缓存后重算 |
|---|---|---|
| 214（现状） | 0.46 s | 0.001 s |
| 600 | 3.24 s | 0.003 s |
| 1200 | 13.49 s | 0.007 s |
| 2400 | **95.56 s** | 0.022 s |

**结论：冷构图是超平方的（约 O(N^2.5–3)）**——卡数翻倍，耗时 ×4.2 到 ×7.1。这带来三条硬约束：

1. **内容扩到第一阶段目标（1.2k–2.4k 张）时，全景构图要 13–96 秒。** 这还是一台 Mac 上、且是"已优化 + 有缓存"的引擎。Android 端**没有缓存**、且 `LaunchedEffect(cards)` 让划卡/收藏都重算 → 手机上不是"卡"，是"打不开"。你的体感问题会随内容变多而指数恶化。
2. **星图降级为"概览"因此不是审美选择，是性能必须**：按学科/分支**分片构图**后，单片回到 100–400 卡 → 0.1–1.5 s，且只在切换支线时算一次、结果可缓存。
3. **全景不该是默认视图**。P1.5 的实际做法是把构图输入按学科分片、全景改为显式选项，配合内存签名缓存（容量 6）与手势态下沉；**没有**做全景落盘缓存——低频路径不值得引入缓存文件与失效逻辑（见 §5 的"有意不做"）。

顺带一个正面事实：命中缓存后的重算是 **1–22 毫秒**，说明 mac 那套"拓扑签名 + LRU"设计是对的，P0 只要把它移植到 Android 就能解决绝大部分痛点。

### 10.1 P0 已完成后的 Android 实测（同一 JVM 基准，Apple Silicon）

| 卡数 | 冷构图（首次/内容真变化时） | 命中缓存的重算 | **划一张卡后**（拓扑无关变化） |
|---|---|---|---|
| 214 | 1197 ms | 0.74 ms | **0.67 ms** |
| 1200 | 5551 ms | 1.26 ms | **1.25 ms** |
| 2400 | 18087 ms | 2.24 ms | **2.01 ms** |

修复前，"划一张卡"走的就是**冷构图**那条路（无缓存 + 每次 `cards` 变化都重建），所以手机上每一次刷卡都要付 1.2 s（214 卡）到 18 s（2400 卡）；现在这条路变成亚毫秒级，且手势期间不再触发 Composable 树重组、逐帧零分配。

冷构图本身仍是超平方（214→2400 约 15 倍卡数、15 倍耗时），这正是 §9 里"单片 ≤400 卡"与 P1.5 分片存在的理由。

> 基准文件是临时产物，跑完已删除（`TempGraphScaleBenchmark.swift` / `TempGraphBenchTest.kt` 均不在仓库里）。
> **设备侧帧率没有可信结论**：本机 Android 模拟器是 320×640 + swiftshader 软件 GPU，`gfxinfo` 的 99 分位（1200 ms）与 GPU 直方图（4950 ms）是模拟器自身噪声，不能当性能证据；设备侧只用于功能验证（见 §10.2）。

---

### 10.1.1 P1 落地后的实测分布（`tools/check_taxonomy.py` 输出）

```
学科内容分布: {"trivia": 160, "ai": 19, "finance": 13, "accounting": 12, "ai-dev": 10}
未分级卡片: 0
```

即：现有 214 张卡在**不改动一行数据**的前提下，全部通过 `legacyCategoryMap` 派生出学科坐标；
`level` 一律为空（不臆造难度），等导入管道按真实素材补齐。

### 10.2 P0 设备侧功能验证（headless 模拟器，已验证项）

- 进入星图：`214 知识星宿 · 419 关联引力`，与历史基线数字一致（坐标变换重写没有改变视觉结果）；
- 轻点节点：命中并弹出预览卡（分类胶囊 + 「引力关联 5 处」+ 标题摘要 + 两个动作）；
- 分片切换：点「AI (19)」→ 顶栏与 contentDescription 同步变成 `19 知识星宿 · 35 关联引力`，再点一次回到 `214`（缓存命中，无重算）；
- 自适应前后实拍：修复前 AI 片是**屏幕外的一条线**；修复后全景 214 个点完整落在屏内、AI 片铺成面且标题可读。
- 「置顶进入卡堆」→ 回到卡堆且顶卡即为该卡（端到端通过）；
- 拖动、复位视口、返回：全程 logcat 无 `FATAL`、无 `ANR`、无 `Skipped N frames` 告警。

## 11. 需要你定的 5 件事

> 2026-09-22 更新：第 3、5 条已由 §13.4 的三件事取代（素材、云端编码许可、P9 桌面路线）。

1. **素材在哪、什么格式**：会计（我看到 `~/workspace/accounting` 这个目录，是否是素材？）、英语词表/真题、金融报表笔记、编程架构文章——给我路径或一份样例即可；
2. **是否允许一次性云端编码**（§6.3 三档：关闭 / 仅标题摘要 / 全文）；默认我按**关闭**推进，先把地基做完；
3. **难度阶梯的标尺谁定**：你给（如"高中→四级→六级"）还是让模型出大纲你审？
4. **星图保留到什么程度**：只留"当前分支邻域图"，还是仍要能一键看全景（全景必须带缩略图与帧率下限）；
5. **手机是否需要连 Agent**：需要 → P6 提前；不需要 → 只做本机 MCP。

---

## 12. 已完成（本轮，独立于本方案）

mac 语音听书控制台与 Android 能力同构：音调（替掉硬编码 1.0）、进度定位（`seek`/快退快进/重新朗读）、睡眠定时器、可拖拽进度条控制台面板，入口接在磨耳朵悬浮条/详情页/菜单（⌥⌘P）/设置，语速档位统一补到 2.0x。顺带修了三处先前遗留：mac 测试目标在 HEAD 上**根本编译不过**（`SearchHistoryTests` 缺 `@MainActor`、`QuizGuardTests` 调了不存在的 `store.currentCard` 且用例前提写错），以及 267 项测试在并发下 4 个套件因墙钟轮询超时误报（`tools/test.sh` 改为串行）。当前 `./tools/test.sh --core-only` 267/267 绿。

---

## 13. 理想场景对账（2026-09-22 追加）

你补的那段场景——通勤/休息日/睡前听、声音温和像真人、工作或学习时在 Win 或 Mac 用桌面端、轻量后台常驻、作为 Agent 的 MCP 或 Skill 接入、浏览网页时随手收集——逐条对到代码上：

| 场景 | 已经有什么（可核查） | 缺什么 | 归到 |
|---|---|---|---|
| 通勤/睡前听，声音温和像真人 | Android：`SpeechPlaybackService`（前台服务 `mediaPlayback` + 锁屏/通知播控）、云端 `/v1/audio/speech`（CosyVoice2-0.5B 与本地 Kokoro 两档已内置）、听书控制台（语速/音调/进度定位/睡眠定时）；mac：同一套控制台（上一轮补的） | ~~① 没有「一键温和真人」预设；③ 睡前没有淡出~~ ✅ 本轮已做（四档预设 + 结束前 30 秒淡出，见 §13.2.1）；② mac 没有系统媒体键/控制中心集成，关窗即断 —— 仍未做 | **P7** |
| 工作/学习时在 Win 或 Mac 用桌面端 | mac 端完整 | **Windows 客户端不存在**：仓库只有 `apps/android` + `apps/mac` | **P9** |
| 轻量级后台运行 | Android 前台服务只在播放期间存活；MCP server 是客户端按需拉起的 stdio 进程 | mac 侧「常驻」目前只有那个 stdio 进程，App 本体没有后台模式；Windows 侧无从谈起 | **P9** |
| 作为 Agent 的 MCP 或 Skill 接入 | `tools/knowflick-mcp` stdio server：`kf_search / kf_get_card / kf_browse_map / kf_learning_path / kf_stats / kf_stage_card`，只读默认 + 暂存后人工确认入库；**本轮补了 CLI `kf.mjs` 与 Qoder Skill `knowflick-kb`**（见 §7.5） | MCP 的 HTTP 形态属 P6 | **P3.5** ✅ |
| 浏览网页时随手收集喜欢的知识和页面 | 无（Manifest 只有 LAUNCHER 与桌面微件） | 整条剪藏管道 | **P8** ✅ 本轮 Android 已通 |

### 13.1 P8 这一轮做了什么，以及实测到什么

三层，全部零新依赖：

1. **抽取内核** `WebClipEngine`（Swift + Kotlin 双端逐条对齐的规则表）：链接校验（只放 http/https，`javascript:` / `mailto:` / `tel:` 与带 `user:pass@` 的一律拒），HTML 按 UTF-8 字节扫描，丢掉脚本/样式/导航/页眉页脚/表单/评论子树，按 `<article>`/`<main>`/id-class 候选挑正文容器（否决词优先；占比不足整页一半则退回整页，维基这类内容分散页不吃亏），实体解码（具名 + 十进制 + 十六进制，未配对的 `&` 原样保留），样板行过滤，**按行截断到 4000 字**（与既有提炼提示词同预算，不为剪藏单开一档 token 成本）。字符集按「HTTP 头 charset → `<meta charset>` → UTF-8」解析，GBK/Big5 中文站不再是一串 ``。
2. **抓取出口** `WebClipFetcher`：匿名 GET（不发也不收 Cookie、不落盘缓存）、15 s 超时、4 MB 上限、只接受 HTML 类响应；所有判定下沉成纯函数，离线可测。
3. **入口与确认** Android：Manifest 注册 `ACTION_SEND text/plain`（**不**注册 `ACTION_VIEW`，否则本 App 会被列成系统默认浏览器候选）→ 分享进来直接开面板并自动抽取；卡堆 ⋮ 菜单「剪藏网页…」是同一面板的手动入口。抽到正文**先给你看**，点「AI 提炼成卡片并置顶入堆」才写库；卡片 `source=IMPORTED`、来源链接排在最前，详情页能一键回到原文。

实测（headless 模拟器 + 本机 HTTP 夹具）：

- **分享链路**：`am start -a SEND -t text/plain` → 系统分享面板出现 **KnowFlick** → 选中 → `onNewIntent` 复用实例（singleTop 生效）→ 面板自动抽取 → 预览显示「财商示例站 · 335 字 · 标题（`&amp;` 已解码）· 描述 · 四段正文」，导航/登录/侧栏推荐/评论区/版权页脚全部不在结果里。
- **明文策略**：`http://10.0.2.2:8899` 被 App 既有的 network security config 挡下（只对回环放开明文），面板给的是可读中文而不是一串 Java 栈；换 `http://127.0.0.1:8899`（`adb reverse`）即通过。**没有为了让夹具跑通而放宽策略。**
- **提炼按钮**：模拟器未配 API Key，点击后原位提示「未配置 API Key，请到设置里填写」。AI 真实调用这一步没在设备上跑（不拿你的密钥进模拟器），提示词与解析路径由单测覆盖。
- **耗时**：12k 字整页抽取 5 ms；4 MB 极限页 0.49 s（mac，含 4 MB UTF-8 解码）。剪藏不是性能敏感路径。
- 全程 logcat **0 FATAL / 0 ANR**。首帧 `Skipped 52 frames` 出在 swiftshader 软 GPU 的窗口动画上，按 §10 的口径不作为帧率证据。
- 测试：mac 25 项（内核 17 + 抓取层 8）、Android 24 项（内核 18 + 抓取层 6），两端夹具 HTML 与期望值逐字相同，就是双端契约本身。

**设备实测抓到两个真 bug**（都不是编译能发现的）：

1. `okio.readByteString(n)` 的语义是「读满 n 字节」，正文短于 n 直接抛 `EOFException` → 站点已经返回 200，App 却报「网络异常」。改成先 `request(n)` 到 EOF 或攒够上限，再按缓冲区实际大小读；回归用例已加。
2. 反馈落在滚动区外面：小屏（320×640）上主操作被正文挤出屏幕，报错更是「沉底等于没报」。改成面板固定三段——头部 / 中间可滚正文 / 底部动作与反馈，动作和它的错误文案同屏。

mac 端内核与抓取层同批落地并测过，**唯独视图没接**：本机没有 Xcode，SwiftUI 编译不了（见项目记忆），所以 mac 的剪藏入口留到你在 Xcode/CI 上确认时一起做（`WebClipFetcher.clip` 已是 async，接一个 `.sheet` 即可）。

### 13.2 P7 听书：档位与睡前淡出（🟡 已完成，仅剩 mac 后台播控）

- **音色预设 ✅ 已完成**：四档打包了「语速 + 音调 + 切卡停顿」，睡前档还含睡眠定时与淡出。
- **睡前淡出 ✅ 已完成**：定时结束前 30 秒音量与语速一起收（详见 §13.2.1）。
- **mac 后台播控 ⏳ 仍待做**：`MPNowPlayingInfoCenter` + 命令中心（媒体键、控制中心），以及「关窗继续播」的显式开关。Android 已有等价物（前台服务 + 锁屏播控），这是双端唯一没对齐的地方；它在 App 层（SwiftUI/AppKit），本机编译不了，留到有 Xcode 的机器上做。

### 13.2.1 P7 落地细节与实测

**四档（双端数值逐条相同，`SpeechPreset.match` 反推）**：

| 档位 | 语速 | 音调 | 翻卡停顿 | 附加 | 场景 |
|---|---|---|---|---|---|
| 精读标准 | 1.00 | 1.00 | 1.5 s | — | 逐条读懂，适合坐下来看 |
| 温和真人 | 0.92 | 0.95 | 2.0 s | 依赖真人音色 | 略慢半拍、音调压低，像有人在旁边讲 |
| 通勤清醒 | 1.18 | 1.00 | 0.8 s | — | 抵得住路上的碎注意力 |
| 睡前轻缓 | 0.85 | 0.90 | 2.5 s | 自动 20 分钟定时 + 淡出 | 最慢最轻 |

两个设计决定值得说明：

1. **档位不落盘，由三个数值反推**。存一个 `presetID` 迟早会和滑块打架（用户手调后界面还顶着"睡前轻缓"）；改成 `match(speed, pitch, gap)` 之后，手调任一旋钮自然回落到「自定义」，而且**跨设备重启后仍然认得**——模拟器实测冷启动后档位仍显示「睡前轻缓」，因为 0.85/0.90/2.5 就是那一档。
2. **淡出只对能做到的路径承诺**。音量：Android `MediaPlayer.setVolume` 与 mac `AVAudioPlayer.volume` / `AVSpeechUtterance.volume` 都实时生效；语速：系统合成路径可以作用到下一句，**云端通道的语速是请求时烘进音频的**，所以那一路只有音量在淡。系统 TTS 没有音量接口，`setSpeechRate` 只影响之后排队的 utterance——所以 Android 系统音色下是「下一张开始变轻变慢」，不是当前这张平滑淡出。代码与文档都按这个口径写，不假装做不到的事。

实测：

- 模拟器走通：控制台顶部新增「听书档位」四胶囊 → 点「睡前轻缓」→ 语速显示 0.85x、音调「低沉」、翻卡停顿 2.5 秒、睡眠定时「剩余 19:44」并逐秒倒数；同时出现实话提示「当前是系统音色，这一档只能近似……」。
- 冷启动后档位仍为「睡前轻缓」（数值反推的效果），而定时器不复活（kill 后不该继续倒计时）。
- 全程 0 FATAL / 0 ANR。
- 测试：mac 新增 20 项（档位表 / 数值反推 / AppStore 回灌与落盘 / 淡出曲线 / tick 逐格驱动音量），Android 新增 11 项，两端断言同一组数字（全量：mac 330、Android 263）。
- **没在设备上验证的一件事**：Android 淡出的**听感**需要等到定时最后 30 秒（UI 只有 15/30/60 分钟档），设备实测只跑到「定时在倒数」这一步；淡出的状态推进由与 mac 同形状的 `advanceSleepTimer()` 承担，mac 侧那条路径有逐格 tick 的断言。


### 13.3 P9 桌面与常驻：三条路线与推荐

| 路线 | 做法 | 成本 | 判断 |
|---|---|---|---|
| A. Swift 上 Windows | 用 swift-on-windows 编译 Core，UI 重写 | UI 100% 重写（SwiftUI 不可用），大陆网络下工具链获取困难 | 否 |
| B. Compose Multiplatform 桌面端 | Android 的 `domain/` 是纯 Kotlin（学科体系、卡库、图引擎、学习范围、剪藏都在里面），抽成独立模块后加 desktop target，UI 用 Compose Desktop 重写 | 一次模块拆分 + 一套桌面 UI；带 JVM 运行时（安装包 ~70 MB） | 只有当桌面要长期做重交互（星图、刷卡动画）才值得 |
| **C. 本地 Web 客户端 + 常驻进程** | 复用 `tools/knowflick-mcp/lib.mjs` 那层 JSON 读取，加一个局域网 HTTP 与一个静态页面；Windows / Mac / 手机浏览器都是客户端 | 最小（数据层已存在、零新依赖、不出你的机器）；代价是不是原生 App，刷卡动画与快捷键体验弱一档 | **推荐先做**：一次回答「Windows 能用 + Agent 常驻 + 手机远程连」，安全模型与既有局域网同步一致（配对码、不上传） |
| D. Electron/Tauri 重写一个 App | — | 等于新 App | 否 |

**推荐先 C，再评估 B。** C 不新增平台承诺，且复用的正是已经写完并通过往返测试的那层读取代码；B 只在桌面端要长期承担重交互时才划算。**这条要你点头，因为它决定后面几个月往哪投。**

顺带回答「轻量后台运行」：C 路线下常驻的就是那个 MCP/HTTP 进程（几十 MB 内存、只读你的 JSON），App 本体不需要后台；纯 mac 路线下常驻 = 现有 stdio server 由客户端按需拉起、随客户端退出，不留守护进程。

### 13.4 现在卡在你手上的三件事（取代 §11 的第 3、5 条）

1. **素材**（P1.2）：英语 / 会计 / 金融 / 编程的原始材料路径或一份样例。
2. **一次性云端编码的许可**（P4）：关闭 / 仅标题摘要 / 全文，默认按关闭推进。
3. **P9 路线**：C（本地 Web + 常驻，推荐）、B（Kotlin 多端），还是先不做 Windows。

---

## 14. 来源与验证边界

**官方文档确认**：MCP spec 2026-07-28 传输与安全要求；TS/Python/Swift SDK 版本与实现代际；Qoder CLI / Claude Desktop / Cursor 的 MCP 配置方式；Apple `NLContextualEmbedding`（含 zh-CN、需 `requestAssets` 下载、可离线）；sqlite-vec 发布物含 macOS/iOS/Android 预编译产物；ModelScope 托管 bge-small-zh-v1.5（95.8 MB / 512 维）；阿里云百炼 embedding（v4 默认 1024 维、单批 10 条、价格量级）；SiliconFlow `/v1/embeddings`（数组上限 32、bge-m3 8192 token）。

**需实测（多数依赖中国大陆网络）**：Apple 模型资产下载可达性与中文检索质量；GitHub/SourceForge/dl.google.com 取 sqlite-vec 与 BundledSQLiteDriver 产物；ModelScope/hf-mirror 速度；SiliconFlow 免费额度政策；各客户端对 MCP revision 的实际支持面。

**未验证**：SwiftUI 层改动本机无法编译（无 Xcode），需你在 Xcode/CI 确认。

**主要链接**
- https://modelcontextprotocol.io/specification/2026-07-28/changelog
- https://modelcontextprotocol.io/specification/2026-07-28/basic/transports
- https://modelcontextprotocol.io/specification/2026-07-28/basic/security_best_practices
- https://github.com/modelcontextprotocol/swift-sdk · https://github.com/modelcontextprotocol/typescript-sdk
- https://docs.qoder.com/cli/mcp-servers
- https://developer.apple.com/documentation/naturallanguage/nlcontextualembedding
- https://github.com/asg017/sqlite-vec/releases
- https://modelscope.cn/models/BAAI/bge-small-zh-v1.5
- https://help.aliyun.com/zh/model-studio/embedding
- https://docs.siliconflow.com/cn/api-reference/embeddings/create-embeddings
