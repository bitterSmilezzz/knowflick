# 剪藏 → 提炼 → 复习 · 设计规格（2026-10-05）

> 面向决策与实现的单一文档。**本文件定规格，不含实现**。已确认的转向：放弃预置知识卡（`shared/assets/seed_cards.json` 214 张），
> 改为「你丢地址 → AI 解析成条目与知识点 → 在 App 里复习」。
> 决策全部经逐题确认（2026-10-05 至 10-06），不接受的条目请在本文件上直接改，不要另开一份。
> 术语落地后需同步进 [`CONTEXT.md`](../CONTEXT.md)（§1）。

---

## 0. 一页结论

| 事项 | 结论 | 依据 |
|---|---|---|
| 内容来源 | 预置卡退役；知识来自你自己剪藏的 URL | 用户 2026-10-05 |
| 事实分层 | 原文与长论证归 **仓外 markdown**（`ai-note`），**可复习的最小知识点**归 App 库 | markdown 可 Git、可被任何 agent 读写；卡拍平会断掉「凡数字必可回查」 |
| 新增单元 | **条目（Entry）**：类型 + 名称 + 一句话 + 关键事实[]（带取数日期）+ 我的判断 + N 张知识点卡 | 「magpie 是什么 / AGPL / 未实测」这种实体型知识套不进 5 字段卡 |
| 解析执行 | **双轨**：Agent 深档（大纲→逐块→实体 API→逐条核）+ App 快档（粘 URL/正文，一请求出条目+卡） | App 匿名抓取对 X/知乎结构性失败；纯 Agent 又让日常入库开一次 IDE |
| 入库必经 | **人工确认**：外部写入只进暂存队列，App 里批量接受/驳回 | 提炼有损且花额度；沿用现有「抽正文 → 预览 → 提炼」的两步哲学 |
| 复习 | 卡面改**问答式**；间隔**保留 +1/3/7 固定阶梯**；接受的卡**先读后考** | 卡量少 → 主动回忆的收益远大于自适应算法；`seenAt` 已驱动排程 |
| 阅读层 | App 内 **wiki**：实体页（叶子）+ 主题页（标签聚合）+ 原文只读渲染 | 已有学科地图/星图/全文搜索是它的底座 |
| 可移植性 | 一份 **agent 中立的标准文档** + `kf_ingest` 契约：任何 agent 读了都能产出合规卡片 | 用户明确要「把链接发给各种 agent」 |
| 平台 | mac 主改；Android **冻结**（新字段解 nil 忽略、不加新入口），LAN 同步协议 v2 **本期不动** | 双端 parity 成本高；但 Android 的 seed 断言与 CI 校验必须同步处理，不留红 |

---

## 1. 新增领域词汇（写进 CONTEXT.md 的口径）

- **条目（Entry）**：一个可被反复回看的对象——一篇文章、一个开源项目、一个 Skill、一个工具、一个人、一条帖子。
  它是 wiki 页的主体，也是若干知识点的归属。**条目不是卡片**：条目用来读，卡片用来考。
- **知识点（Card）**：最小可复习单元，问答式（正面回忆提示、背面答案）。仍沿用 `KnowledgeCard`，只加可选字段。
- **原文锚点（Anchor）**：知识点挂的一句原文摘录或段落定位。**存在理由**：`ai-note/README.md` 的硬规矩——
  「笔记里凡有具体数字、参数、接口名，都必须能在 `sources/` 里找到出处」。
- **核实状态（Verification）**：四档枚举 `source-verified | secondhand | untested | unsourced`
  （已核原文 / 二手转述 / 未实测 / 零出处）。来自用户笔记里反复出现的「被讨论不等于被验证」。
- **我的判断（Opinion）**：只属于用户的分区字段。**AI 不得写入**，也不得被提示词诱导生成；
  允许从 `ai-note/reflections/` 与 notes 的结论段落人工导入。
- **解析档位（IngestDepth）**：`fast`（App 内，单请求）/ `deep`（Agent，多请求）。
- **暂存队列（Staged）**：外部写入的唯一落点（`staged_cards.json` / 新增 `staged_entries.json`），
  经 App 人工确认后才进正式库。

---

## 2. 数据模型

### 2.1 兼容性总则（三条，违反即否）

1. **新字段全部可选，只在有值时写盘**——与 `subject/branch/level/track/orderKey/prereq` 同一策略；旧 `cards.json` 零改动可解。
2. **不改 `category` 语义**：它仍是展示用叶子名（全仓数百处引用），新能力读新字段。
3. **不新增必填枚举的默认兜底值**：`verification` 缺失即「未标注」，界面显示「未核」而不是猜 `source-verified`。

### 2.2 `KnowledgeCard` 新增可选字段

| 字段 | 类型 | 语义 | 缺失行为 |
|---|---|---|---|
| `entryID` | String? | 归属条目 id；wiki 实体页据此聚合 | 独立卡（历史卡、手工卡） |
| `recallPrompt` | String? | 复习正面显示的**问题**；背面是现有 headline/summary/details | 退化为认读（旧卡照刷） |
| `anchor` | {quote, locator, url}? | 原文摘录 + 段落定位（章节标题/行号/`#section`）+ 回链 | 无锚点，详情页不显示「回到原文依据」 |
| `verification` | String? | 四档枚举 raw 值 | 显示「未核」 |
| `opinion` | String? | 用户亲笔判断，与事实区分区渲染 | 不显示该分区 |
| `tags` | [String] | 开放标签（自动打 + 可改），主题页聚合键 | 只进「未分类」 |

> `source` 枚举保持 `seed | ai | imported` 三值，**不新增** `clipped`：剪藏与 AI 提炼的产物继续走 `imported`，
> 「AI 生成 vs 原文搬运」的区分已由 `verification` 表达，多一个枚举值要在双端 + MCP + 导出四处同时改。
> 第二期的清理动作是把 `seed` 分支从代码里删掉（§8），但线格式保留该 raw 值以解历史 JSON。

### 2.3 Entry 模型（新文件 `entries.json`，与 `cards.json` 同目录）

```
Entry {
  id, entityType, name, canonicalURL, oneLiner,
  sourcePath?        // markdown 原文相对路径（相对用户配置的根目录，不是绝对路径）
  facts: [ Fact ]    // 当前有效事实
  history: [ {asOf, facts} ]  // 追加式快照，不覆盖
  opinion, tags, status(未装/未实测/已试用/长期用)
  createdAt, updatedAt
}
Fact { key, value, origin: api | page | manual, asOf(取数日期), verification }
```

- **重复解析 = 快照追加**：重跑写 `history`，`facts` 换成新值；旧的星数/许可**仍可看见并带日期**，
  这样「6.3 万星里 66% 是 skill 分发副本」这类结论不会丢掉时间维度。知识点卡则**就地更新并标记改过**（复用 `CardImportEngine.mergeCardList` 的字段级合并）。
- **落盘走 `persist()` 单入口**（350 ms 节流 + 后台执行），三级备份/轮转/隔离与 `cards.json` 同构，不另造一套。

### 2.4 三处线格式必须同源

| 端 | 位置 | 处理 |
|---|---|---|
| mac | `apps/mac/Sources/KnowFlickCore/Models/KnowledgeCard.swift` + 新增 `Entry.swift` | 读写双方 |
| Android | `apps/android/domain/src/jvmAndAndroidMain/kotlin/com/knowflick/app/domain/Card.kt`（冻结，2026-10-10 随 KMP 探针迁入 `:domain` 模块）+ `Entry.kt`（只解不写） | 新字段解出 nil 即忽略 |
| MCP | `tools/knowflick-mcp/lib.mjs`（现 313-352 行的校验） | `kf_ingest` 的入参校验，非法值拒收 |

契约夹具放 `shared/assets/`（与 `taxonomy_map.json` 同批风格），双端各加一条 parity 测试逐字段比对，
沿用 `SubjectRegistryTests` / `SubjectRegistryTest` 的写法。**契约测试断言行为，不断言参数形状**：
`kf_ingest` 的失败分支必须留下「未写入任何文件」的可观察证据（`cards.json` 与 staged 文件的字节不变），
而不是只测参数被拒。

---

## 3. 摄入链路

### 3.1 状态机

```
URL / 正文
  → ① 取正文（按 §3.2 路由；失败落兜底，绝不静默）
  → ② 大纲（小节级要点 + 硬事实清单）        ← fast 档跳过
  → ③ 人工勾选要提炼的块                     ← fast 档跳过
  → ④ 产出 Entry + 知识点卡草稿（问答式，带锚点与核实状态）
  → ⑤ 实体补数（api.github.com，带 asOf）    ← 仅 repo/skill 类条目
  → ⑥ 写暂存队列（staged_*）
  → ⑦ App 待处理屏：预览 / 改 / 批量接受 / 驳回
  → ⑧ 接受后：卡进「待读」，条目进 wiki
  → ⑨ 读完一遍（seenAt 落）→ 才进入 +1/3/7 排程
```

**⑦ 不是可选步骤。** App 内 fast 档也走同一队列（同一次提炼直接开预览面板，等价于跳过持久化的一轮）。

### 3.2 取正文路由（2026-10-05 本机实测，匿名 curl 无代理）

| 站点形态 | 直连实测 | 取数策略 |
|---|---|---|
| 公众号 `mp.weixin.qq.com` | **200**（假 slug 也 200；正文在 `js_content`，图片懒加载） | App 直取；抽取内核需能吃 `js_content`（现规则表按 `<article>`/`<main>`/id-class 挑正文，公众号是 `div#js_content` —— 加候选 id，不是改算法） |
| 普通文档站 / 博客 / Bing | **200** | App 直取，沿用现有 4 MB / 15 s 上限 |
| GitHub 仓库**页面** `github.com` | **000**（连不上；经代理仍 000） | 仓库类条目**不抓页面**，走 `api.github.com` + 文档/README |
| `api.github.com` | **200** | star / fork / license / 语言 / 最近推送 / open issues + 文件树计数 |
| `raw.githubusercontent.com` | **000**（时通时不通） | 单文件走 `gh api repos/<r>/contents/<path>`；拿不到就标「未核」 |
| 知乎 `zhihu.com` / `zhuanlan` | **403** | 登录墙 + 反爬，**只有已登录浏览器能取**；App 侧不尝试 |
| X `x.com` / `twitter.com` | **000**（经系统代理曾 200，连续复跑全 000） | 同上，走浏览器 |
| 任意失败 | — | ① 用户在 App 里**粘贴正文** ② 只存链接并标「未取回」，条目 `verification=unsourced` |

**代理口径**：**跟随系统代理，不新增 App 设置项**（macOS URLSession 默认继承系统配置；本机系统代理 = `127.0.0.1:10808`，xray）。
`curl` 不读系统代理，所以「curl 000」不等于「App 内 000」——**两侧行为要各自实测，别互相推断**。
代理不稳定是已知事实，任何依赖它的取数都必须有失败分支与「未取回」出口，**不得把代理写成链路的唯一底座**。

**登录态红线**：只有 Agent 侧经 browser-use / 已登录 Chrome 用会话；**App 永不收发 Cookie**，
现有明文策略（只对环回放 HTTP）不为剪藏放宽。带 `user:pass@` 的 URL 继续直接拒（凭据会被写进来源链接）。

### 3.3 长文预算（正文现有 4000 字硬截断，实际最长 7.4 万字符）

- **deep 档**：大纲先行 → 勾选 → 逐块提炼。单块 6000 字、相邻块重叠 200 字，块数上限 12；
  大纲每块 ≤200 字要点 + 硬事实清单（数字、接口名、许可、版本号原样列出）。
- **fast 档**：一次请求，正文上限提到 **12000 字**（不再沿用 4000，也不做无限）。超限在预览面板**明示截断位置**，
  并提示「要完整提炼请走深档」。
- **硬事实禁止由模型生成**（roadmap §3.3 沿用）：许可、星数、文件数、价格、条款原文只能来自抓取或 API，
  否则 `verification` 只能填 `untested`。

### 3.4 去重口径要改一处（重要）

现有近重复抑制是 **bigram Jaccard > 0.35 丢弃**，作用域是全库。新链路下这会把
「magpie 的 5 篇材料」剪成 1 篇——恰恰丢掉用户最想要的横向对照。

**改为：去重作用域限定在同一个 `entryID` 内**；跳条目的近重复**不丢弃**，而是并列挂到同一实体页下，
冲突不抹平（`07` 那张对照表就是这个形态）。全库标题归一口径继续用 `normalizeHeadline`。

---

## 4. 提炼契约（提示词规格，实现时放 `CardImportEngine`）

**输入**：正文（按 §3.3 预算）+ 页面元信息（标题/作者/发布日期/取数日期）+ 条目类型候选 + 现有标签白名单 +
学科候选（仅当内容落在 `taxonomy_map.json` 声明的学科内才给）。

**输出**：单个 JSON 对象（不是数组）：

```json
{
  "entry": { "entityType": "...", "name": "...", "oneLiner": "...", "facts": [...], "tags": [...] },
  "cards": [
    { "role": "entity", "recallPrompt": "...", "headline": "...", "summary": "...", "details": "...",
      "anchor": {"quote": "...", "locator": "..."}, "verification": "source-verified", "links": [...] },
    { "role": "detail", "...": "..." }
  ]
}
```

**硬约束（写进提示词并在解析侧校验，不合规的条目直接丢弃并在 UI 计数）**：

1. `role=entity` 恰好 1 张；`role=detail` **≤ 12 张**；
2. 每张卡**必须有 `anchor.quote`**（原文摘录）与 `verification` 四档之一；
3. **`opinion` 字段必须为空**——模型不得填写用户判断；
4. 中文为主，术语/代码/接口名/宣传语保留原文；
5. 原文链接排在 `links` 首位（沿用 `WebClipDigest.attributing(_:)` 现有行为）；
6. 数字、许可、版本号只能照抄输入正文，**不得改写或换算**。

**两档的调用次数**：fast = 1 次；deep = 1（大纲）+ N（勾选块）+ 可选 1（实体补数后合并）。
设置里显示预计调用次数，让额度是可见成本。

---

## 5. 可移植标准与 `kf_ingest`

**交付物三份**，让「把链接发给任何 agent」这句话有落点：

1. `docs/INGEST_STANDARD.md` — agent 中立：§2 schema、§4 提示词硬约束、核实状态枚举、去重口径、失败与「未取回」出口、
   以及**样例输入输出**（一条公众号 + 一个 GitHub 仓库 + 一条 X 推文的完整往返 JSON）。
2. `tools/knowflick-mcp` 新增 `kf_ingest`（MCP 工具）与 `kf.mjs ingest`（CLI 子命令）：
   入参 = §2 的 JSON 对象，校验后**只写暂存文件**（`staged_cards.json` + 新增 `staged_entries.json`），
   沿用现有 `.lock` + tmp + fsync + rename 与 64 MiB 上限；幂等键 = `entryID` + `normalizeHeadline`。
   **失败分支必须只删自己刚建的临时文件**，绝不动已有队列（现有锁语义已如此，新增路径不得例外）。
   同时把 `lib.mjs:349` 硬编 `source: "ai"` 改为按入参判定（原文搬运 = `imported`）。
3. `.qoder/skills/knowflick-kb/SKILL.md` 增补「剪藏入库」工作流：读标准 → 取正文（按 §3.2 路由）→ 大纲 →
   `kf_ingest` → **必须告知用户还要在 App 里确认**。

---

## 6. App 侧改动

| 屏 | 改动 |
|---|---|
| **待处理队列**（新） | 扩现有 `ImportNotesModalView`（⇧⌘I，已有「规则解析 / AI 智能提炼」双 Tab、勾选与「确认导入 (N 张)」）加第三个 Tab「暂存队列 (N)」：条目分组预览、就地改问答、批量接受/驳回。接受走 `store.importCards(...)`，**不置顶**。 |
| **wiki**（新，侧栏一级） | 实体页：条目头（名称/类型/一句话/status）+ 事实表（含 `asOf` 与核实状态）+ 我的判断分区 + 下属知识点 + 原文回链；历史快照折叠可见。主题页：标签聚合 + 计数。 |
| **原文只读渲染** | 设置页新增「原文目录」= `~/workspace/01-学习备考/ai-note`。安全边界：只允许配置根目录**之内**的相对路径（拒 `..`、拒绝对路径、拒 symlink 逃逸），只读、不外发、不进同步包。 |
| **今日学习 / 复习计划 / 知识库** | 保留为主屏；卡面正面 `recallPrompt`，无则退化为 headline 认读。 |
| **刷卡 / 星图 / 学习地图 / 听书 / 测验 / 海报** | 降为工作台入口，代码与测试不动（先降级不删）。 |
| **设置** | 删 `enableSeed` 与「启用预置精选知识库」文案；加 `解析默认档`、`原文目录`、`标签管理`；`enableAI` 保留。 |

**分类体系**：剪藏自动打开放标签（不进 `CategoryRegistry` 白名单，避免与自定义分类打架）；
`subject/branch/level/track/orderKey/prereq` **保留**给「01 六个月路线」和应试材料（`orderKey` 支撑的「一点点看」是真需求）；
`冷知识` builtin 壳保留当兜底与别名表落点（不可删，且全仓数百处引用依赖它）。

---

## 7. 复习口径

- **问答式**：`recallPrompt` 优先；测验三档（忘了/犹豫/掌握）与 `masteryLevel` 语义不变。
- **固定阶梯不变**：+1/3/7 天（`LearningPlan.reviewDate(for:)`），**mac 不上 FSRS**——几十张卡喂不出有意义的参数，
  `easeFactor/stability/difficulty` 继续只作为线格式字段存在。文档维持「不宣称使用自适应记忆算法」。
- **先读后考**：接受的卡 `seenAt == nil` → 进「待读」；读完一遍（写 `seenAt`）后 `LearningPlan` 才排入 +1 天。
  现有剪藏「提炼后置顶入堆」的行为改为不置顶（`insertAtTop: false`）。
- **喜好语义不变**（`left/right/skip` 与 `isFavorite` 解耦那一整套照旧），但文案改口径：
  `right` = 「这条值得再回来」，不是「有趣」。只改文案不改字段。

---

## 8. 预置卡退役清单（分两步）

**第一步（PR-1，不断则红）**

- `AppStore.bootstrap()` 的播种与增量合并（`apps/mac/.../AppStore.swift:231-300, 661-683`）
- `enableSeed`（`AISettings.swift:76,99,238`、`SettingsEditBuffer.swift:20,41,67`、`SettingsView.swift:655` 文案）
- 卡堆来源门（`DeckDeriver.swift:100-108`）与空态判定（`InsightMainView.swift:42-44`）——**「全关即空」的语义要重写**，
  否则关掉 seed 后新链路会被老门禁挡住
- 测试：`SeedMergeTests.swift:24`（断言 214）、`:50`（215 算术）、`EmptyLibraryRecoveryTests.swift:97-110`；
  Android `SeedLoaderRobolectricTest.kt:24`、`SeedThemeDistributionTest.kt`
- CI 与构建守卫：`.github/workflows/macos.yml:113-127`、`android.yml:135-150`、`build_app.sh:68-69`、
  `tools/sync_shared_assets.sh:21-22,28-35`
- **本机库先导出归档**（`~/Library/Application Support/KnowFlick/cards.json` → 仓库外带日期的备份目录），再清

**第二步（PR-2/PR-4 附带）**

- `tools/check_taxonomy.py:75-88` 的种子内容校验改为校验「条目与知识点契约」
- `tools/import_lessons.py`（它直接 append `seed_cards.json`）改目标或退役
- `GenerationCoordinator.swift:112-122` 的「卡不足自动补卡」：改为按标签补齐，或删除
- `shared/assets/seed_cards.json` 与 Android `SeedLoader` / `AppModel.kt:29-44` 最终移除（Android 冻结期可暂留文件，只断 mac 链路）

> **更正一条过期事实**：roadmap §1.4 写「本机只有 Command Line Tools、无 Xcode，SwiftUI 无法本地编译」。
> 2026-10-06 实测：`xcode-select -p` = `/Applications/Xcode.app/Contents/Developer`，Swift 6.4。
> 所以本期的 SwiftUI 改动**可本机编译**，不再需要「等 CI 确认」这条借口；构建仍需 `DEVELOPER_DIR` 与 `SDKROOT` 同源。

---

## 9. 平台与同步边界

- Android：`domain/Entry.kt` 只解不写，新字段解 nil 忽略；不加剪藏新入口、不加 wiki 屏；本文件口径写进 `CONTEXT.md`。
- LAN 同步协议 v2（端口 8998+、6 位配对码、25 MiB 上限）：**本期不动**。条目与原文路径不进同步包。
- 后续若要让 Android 读条目，先加协议版本字段再谈，不做兼容性猜测覆盖。

---

## 10. 验收（每个 PR 都要落到测试）

1. **线格式 parity**：双端对同一份契约夹具逐字段比对（含全空新字段的旧 JSON）。
2. **暂存不脏写**：`kf_ingest` 成功/失败两分支后，`cards.json` 字节不变（现有 `test.mjs` 已有同类断言，扩到 entries）。
3. **提炼契约校验**：缺锚点、缺核实状态、detail > 12 张、`opinion` 非空的模型输出被丢弃并在 UI 计数，不静默入库。
4. **路由行为断言**：知乎/X 在 App 侧走「未取回」出口（断言的是**产出**——条目存在且 `verification=unsourced`，
   不是断言请求参数没带 Cookie）。
5. **去重作用域**：同一实体下两篇材料的近重复卡**都保留**；同条目内近重复被抑制。
6. **先读后考**：接受的卡不出现在当日到期队列，读完一遍后出现在 +1 天。
7. **wiki 路径安全**：`..`、绝对路径、symlink 逃逸三种输入均被拒。
8. **UI 自证**：mac 侧改完我自己拉起 App 走一遍剪藏 → 确认 → 复习 → wiki 回链，按窗口截图，不交无边框浮窗。

---

## 11. 风险与未决

| 风险 | 处置 |
|---|---|
| 模型不遵守锚点约束（幻觉摘录） | 解析侧做「摘录必须在正文中出现」的字面校验，不过就丢 |
| 公众号 `js_content` 含未渲染占位 | 抽取加候选 id；取回正文 <200 字即判「疑似未取全」，提示走粘贴 |
| `api.github.com` 匿名限流 60 req/h | 每条实体最多 2 次请求 + 结果带 `asOf` 落缓存，重解析同一天不重复取 |
| 暂存队列积压无人确认 | 待处理屏显示队列年龄与条数；不做自动过期删除（暂存是用户资产） |
| 深档多请求的成本失控 | 设置显示预计调用次数；块数硬上限 12 |
| 未决：Android 何时补 wiki 只读屏 | 等 mac 侧条目模型稳定一版后单独决策，不在本期 |

---

## 12. 里程碑

| PR | 内容 | 影响面 | 验证 |
|---|---|---|---|
| **PR-1 断预置链路** ✅ 已落地 2026-10-06 | §8 第一步：播种/门禁/开关/测试/CI 守卫；本机库先归档再清 | mac Core + Views + Android 测试 + 两条 workflow | mac 全量 Swift 测试绿、Android 330 项 JVM + lint 绿、`build_app.sh` 启动自检通过、空库首屏实拍 |
| **PR-2 条目模型 + App 内提炼** | `Entry` 双端线格式 + `persist` 接入；快档 12000 字预算 + 契约校验 + 去重作用域改造；`recallPrompt` 问答式复习 + 先读后考 | KnowFlickCore + Android domain + `CardImportEngine` | 契约 parity + 提炼校验用例 |
| **PR-3 Agent 入库通道** | `docs/INGEST_STANDARD.md` + `kf_ingest`（MCP + CLI）+ `staged_entries.json` + 待处理 Tab（接受/驳回/不置顶） | `tools/knowflick-mcp` + `ImportNotesModalView` + SKILL.md | 暂存不脏写 + 端到端一次真实公众号 |
| **PR-4 wiki 阅读层** | 实体页 + 主题页 + 原文只读渲染（路径可配 + 安全边界）+ 四屏为主与降级入口 + README/CONTEXT 文案改叙述 | mac Views + `CONTEXT.md` + `README.md` | 路径安全用例 + 我自己开 App 走完链路 |

### 12.1 PR-1 落地时对规格的三处偏离（后续 PR 以此为准）

1. **`tools/check_taxonomy.py` 从第二步提到 PR-1**：两条 workflow 都在跑它，默认路径指向已删除的
   `shared/assets/seed_cards.json` 会当场红。改法是「给定路径存在才做内容校验」，契约自洽与三处同源校验不变。
2. **`AppStore.isLoadingSeed` 更名 `isLibraryLoading`**：这个守卫的真实语义一直是「卡库快照是否可信」，
   预置库退役后名字在说谎。两处正则护栏测试（`StoreWriteContractTests` / `AppStoreDeckCharacterizationTests`）
   的属性清单同步更名——它们本来就是为「改名要留痕」而存在的。
3. **来源开关的语义不是「删掉一档」而是「不再藏用户的东西」**：旧实现里 `enableSeed` 与 `enableAI`
   任一关闭就会把 `imported`（剪藏/导入）一起挡在卡堆外。双端同时改为只有 `enableAI` 生效、
   且只屏蔽 `ai` 来源；搜索的来源筛选项「预置精选」相应换成「剪藏导入」。
   顺带把两处空态拆开：「还没有第一批知识」（给剪藏/导入入口）与「这一轮读完了」（给重新探索），
   工作台快捷区加「网页剪藏」入口——空库从异常状态变成正常起点，文案必须跟着变。

**本机数据处置**：`~/backups/knowflick-pre-clip-pivot-2026-10-06/`（216 张卡的 `cards.json`、`settings.json`，
两份轮转备份在 `raw/`）。App 目录下三个卡片文件已移出；启动实测确认不再自动生成 `cards.json`。

---

## 13. 底层素材（仓外，本期只读）

| 路径 | 内容 | 用法 |
|---|---|---|
| `~/workspace/01-学习备考/ai-note/notes/` | 15 篇消化后的中文笔记 | **建条目**（一篇一条目），知识点随条目产出 |
| `~/workspace/01-学习备考/ai-note/sources/` | 16 篇原文全文存档（只增不改） | **只挂路径**，不拍平成卡 |
| `~/workspace/01-学习备考/ai-note/reflections/` | 空（用户亲笔感悟位） | `opinion` 字段的导入源 |
| `~/workspace/01-学习备考/note/AI个人学习知识库/` | 8 篇主题 md（约 9,720 字） | 主题页骨架 |

第一批范围：**15 篇 notes**（结构最整、天然一篇一条目）；`sources/` 挂 `sourcePath`；8 篇知识库进主题页。
不一次性把 39 个文件全拍平成卡。
