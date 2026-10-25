# 修复登记（对应 [REPORT](REPORT.md) / [TASKS](TASKS.md)）

本文件只登记**已完成并有测试证据**的修复；状态与范围以提交为准，不在此重写审计结论。
分支 `workbench/second-brain-validation`，验证门禁 = `npm test` + `tsc` + `cargo test` + `check_doc_consistency`，每批推送后由 CI 四档复核。

## 已修复

### T01 · 笔记保存会话统一（KF-002 P0、KF-004 P1）→ `672aa0e`

- 新增 `noteSession.ts`：一篇笔记一个会话，拥有已确认修订、草稿、元数据补丁、串行保存泵与冲突态。
- KF-002 反例：冲突即冻结（不推进基线、不清 dirty、不自动重试），界面给三个显式动作
  （用我的版本覆盖 / 本地另存副本 / 加载远端内容）；冲突后继续输入不再获得覆盖资格。
- KF-004 反例：正文与元数据同源（服务端快照+补丁+草稿组装），属性后写正文不回退。
- 回执归属：editSeq/metaAtSubmit 比对，旧回执不把新草稿标成已保存；在途新输入合并进下一轮。
- 每次编辑写 localStorage 草稿镜像，意外退出重开可恢复（「已恢复上次未保存的草稿」）。
- 证据：`noteSession.test.ts` 12 项（含 KF-002/KF-004 原始反例）。

### T02 · 读取范围显式三段（KF-005 P1）→ `71a12dd`

- `note_list_scoped`（Rust）/ `readNotesPage`（TS）：active / deleted / all + offset 分页；
  旧布尔 true「只列回收站」被当「包含全部」用的歧义消除，桌面回收站由此恢复可见。
- 分页走完不设 10000 隐含上限；未知范围显式报错。`repository.readNotes` 分页合并全量。
- 证据：Rust `note_list_pagination_walks_all_pages`（翻页不重不漏、all = active + deleted 会计恒等）。

### T04 · 恢复专用契约（KF-003 P0、KF-006 P1）→ `71a12dd`

- `note_restore_upsert`（Rust）/ `restoreNoteRaw`（浏览器同语义）：按包内当前态**原样**落库——
  修订号、created/updated、删除态（回收站不复活）、收藏置顶归档来源全保留；
  处置五态 created/updated/skipped_local_newer/skipped_divergent/current；恢复后下一笔编辑 9→10。
- `kb_restore_membership`：added_at 保留包内值，逐条处置（added/existing/failed），幂等。
- `notesRestore.ts` 预检先行：知识库 id 映射（同名异 id 并入既有库、成员经映射迁移），
  结构化报告取代吞错假计数；Workspace 回执按处置如实展示，有失败明确「不是完整恢复」。
- 契约：NOTES_MODEL.md「恢复专用写入」一节。
- 证据：Rust `restore_upsert_preserves_revision_times_and_deleted_state`（KF-003 原始反例
  revision=9+deleted）、`restore_upsert_never_regresses_local_revision`；JS 领域 2 项、
  编排 5 项（同名异 id、幂等、不回退、失败上报）。

### T03 · 备份采集收口（KF-001 P0、KF-008 P1）→ `ff69165`

- 新增 `backupCollect.ts` 唯一采集入口：先处置草稿（会话冲刷，8 秒上限，失败如实上报），
  分页遍历权威层全部素材/卡片/笔记（含回收站）/库/成员/产物；界面是否打开过笔记页无关。
- `list_materials`/`list_artifacts` 补 offset 分页，1000/10000 隐含上限退役。
- 附件两路覆盖（素材 mediaPath + 笔记正文引用）；读失败进结构化清单，
  四个导出入口共用快照与「完整/部分」诚实回执。侧栏计数同改权威层。
- 证据：`backupCollect.test.ts`（冷启动不打开笔记页仍有全量笔记与成员关系、草稿缺口上报）。

### T06 · 备份包校验（KF-009 P1）→ `ff69165`

- schemaVersion 3；校验和 FNV-1a 32 位 → SHA-256（同步实现，FIPS 180-4 向量钉住）。
- 恢复写入前逐文件核对，不匹配整体拒绝——「篡改 notes 仍被接受」红转绿；
  v2 旧包按旧 FNV 校验（兼容不豁免）；计数对账、v2+ 缺 notes.json 拒绝、
  ZIP 截断/重复条目/未知压缩方式/未知未来版本拒绝；真 v1 ZIP 文件集用例取代「v2 空 notes 冒充」。
- 证据：`sha256.test.ts` 5 向量（含一百万 a 多块）、`systemBackup.test.ts` 负向 7 例。

### T07 · 浏览器笔记损坏保护（KF-010 P1）

- 损坏隔离与写保护：`browserNotes` 遇到非 JSON、截断 JSON 或非法结构（notes 非数组、条目缺 id、membership 非键值映射）时抛出 `BrowserNotesCorruptError`，自动将原始数据隔离备份到 `knowflick.notes.corrupted`，置内部写保护锁；后续任何新建或保存拒绝写入，防止静默覆盖损坏数据。
- 运维入口：`readCorruptedNotesBackup()` 导出原始未损坏数据，`clearCorruptedNotesLockAndReset()` 供用户显式确认重置。
- 证据：`repository.browserNotes.test.ts` 6 项（非法 JSON / 截断 / 错误形状 / 缺 id 条目 / 锁定写阻止覆盖 / 重置后正常）。

### T08 · 向量空间、内容失效与重算任务（KF-011 P1）

- 内容变更使旧向量失效：`upsert_card_inner` 在更新卡片时检查 `category` / `headline` / `summary` / `details` / `tags_json`；任何正文相关内容改变，同步执行 `DELETE FROM card_embeddings WHERE card_id = ?1`，卡片立即可被 `list_unembedded_card_ids` 发现并重算；纯复习评分变化（repetition / interval_days / ease_factor / favorite）**不删除向量**，避免无意义重算。
- 软删同步清理：`delete_card` 同步清理 `card_embeddings`，被删卡片不再参与向量检索与 stale 判定。
- 远端未知维度安全判定：`list_stale_embedding_card_ids` 在 `dim <= 0` 时按 `(provider, model)` 身份安全判断，避免误将同模型有效向量判为 stale。
- 全量 stale 循环排空：`syncCardEmbeddings` 改为 `while(true)` 循环，超过 20 条（单个 batch）的过期数据全部重算，不再只跑一个批次就退出。
- 证据：Rust `card_content_change_invalidates_embedding_while_review_change_keeps_it`（正文变向量失效、评分变保留、删除清理、零维身份判别）；前端 `embeddingEngine.test.ts` 批量 stale 循环排空测试。

### T09 · 官方模块开关生命周期（KF-012 P1）

- 开关**改变执行**，不只是隐藏入口：
  - `official-inbox-sniff`：`fetchPage` 执行层拒绝抓取并说明如何在设置里重新启用；
  - `official-doc-extractor`：文档导入路径执行层拒绝并说明；
  - `official-cognitive-brief`：简报页显示「模块已关闭」说明页，已收集素材与卡片不受影响；
  - `official-review-fsrs`（复习）、`official-speech-asr`（ASR）：沿用既有接线（旧 `reviewPluginEnabled` 键仍兼容）；
  - `official-mcp-server`：嵌入式 MCP 停用时请求被拒（`-32000`「已停用」），独立进程同样读取库目录下的 `settings.json` 判定停用并阻断。
- 旧内容不变式：关闭模块后既有素材/卡片/笔记仍可读、可导出；停用只影响新执行。
- 证据：`moduleLifecycle.matrix.test.ts` 8 项（6 个模块的默认态与启停判定、MCP 停用拒绝与启用放行）。

### T10 · 安装后可用的 MCP 接入（KF-013 P1）

- 配置指向**真实存在的绝对入口**：新增 `mcp_server_paths` 命令返回服务端脚本与库目录的绝对路径；
  设置页用它生成配置（浏览器模式无绝对路径时退回相对路径并如实说明前提）。
- 库目录显式传递：配置片段带 `--dir <库目录>`；`mcp-server.mjs` 支持 `--dir` 参数，
  优先级高于环境变量——两个进程不再各读各的库。
- 随包分发：`tauri.conf.json` 的 `bundle.resources` 带上 `tools/mcp-server.mjs`，
  安装用户不用有源码仓库。
- 停用吊销：独立 MCP 进程读库目录下的 `settings.json`，`official-mcp-server` 关闭即拒绝外部请求。
- 证据：`tools/mcp_install_smoke.mjs` 10 项（任意 cwd 启动、initialize/list/search/read、
  默认只读拒绝、显式授权写入并落进指定库、模块停用被阻断、重新启用恢复）——已接入 `verify_workbench.sh`。

### T05 · 整份恢复的一致性与失败报告（KF-007 P1）

- 新增 `backupRestore.ts`：恢复拆成「预检 → 执行」两段，写入依赖由调用方注入
  （服务不绑定具体仓储，浏览器与桌面同一条规则）。
- **附件失败不再伪装成功**：附件先暂存；素材的附件没恢复成功时**这条素材不落库**
  （旧实现把 mediaPath 改成 null 继续报告完成——半条记录看起来正常、附件实际丢了）。
- **逐条处置、失败逐条记录**：素材/卡片/产物/笔记/知识库/成员/设置各自 try/catch，
  失败进结构化清单（kind + id + 原因），不再捕获后继续假计数。
- **回执与真实副作用一致**：部分恢复时明确说「本地内容已经改变，不会自动回滚」，
  并把失败明细复制到剪贴板 + 下载为 Markdown；解包/校验失败（写入之前）才说
  「尚未写入任何内容」——旧实现一律写「本地内容未受影响」，写入中途失败时那句话是假的。
- **可取消**：执行期间检查取消令牌，取消即停止后续写入，报告标记取消且为部分恢复。
- 证据：`backupRestore.test.ts` 7 项（全部成功、第 1 条失败、最后一条失败、附件缺失、
  附件成功换路径、中途取消、失败明细导出）。

### T13 · 笔记进入全局检索与引用闭环（G01）

产品路线要求交付的一个完整增量：**选定知识库 → 搜原文 → 打开笔记 → 应用引用**。

- **笔记进入全局检索**（此前笔记只在笔记页里能搜到，长文笔记的结论等于没有）：
  `entriesFor` 增加 note 类条目（正文、标题、标签、笔记本都进搜索文本；
  回收站里的不进检索）；来源筛选页签新增「笔记」。
- **知识库范围**：列表工具条新增「按知识库筛选」选择器，选定后只保留该库的
  笔记（`filterByKnowledgeBase`，成员关系来自 kb_membership）。
- **打开笔记**：全局检索命中笔记 → 点条目跳到笔记页并按 id 打开那篇
  （`NotesView` 新增 `openNoteId`，工作台只传「要看哪一篇」，不复制笔记内容）。
- **应用引用**：笔记页新增「引用另一篇笔记」——从其它笔记选一段插进当前笔记，
  引用块带 `knowflick://note/<id>` 的「回原件」链接；预览里该链接是可点的
  内部导航（MarkdownRenderer 新增 `onOpenNote`），点得回源笔记。
  引用格式与解析见 `domain/noteReference.ts`：可回原件、可读、可解析；
  改标题不破坏引用（靠 id），源笔记被删时引用可被识别为失效。
- 证据：`noteReference.test.ts` 10 项（含失效识别与改标题不破坏引用）、
  `note_retrieval_smoke.mjs` 13 项（端到端：检索命中 → 笔记筛选 → 知识库范围
  → 打开笔记 → 引用插入 → 引用落库 → 回原件可点 → 跳回源笔记），已接入门禁。

### T11 · 职责收口（KF-014 P2）

把「哪些决定只能有一处做」写成静态守卫 `tools/check_responsibility.py`：

- **恢复规则只有一个入口**：`domain/restoreRules.ts` 判定哪些条目该放回，
  界面不得再直接调用这些函数（`backupRestore.ts` 是唯一的恢复编排层）。
- **备份采集与回执只有一个入口**：顶栏与设置页共用 `collectBackupSnapshot`，
  回执判定收敛为 `backupReceipt`（此前两处各写一遍完整/部分文案，改一处就漂）。
- **恢复失败文案只有一个判定入口**：界面不再出现「本地内容未受影响」——
  写入中途失败时那句话是假的；只保留「尚未写入任何内容」（写入之前失败）。
- **笔记保存由会话拥有**：`NotesView` 不再自己维护 `savedRevision`。
- **纯规则模块不依赖宿主**：`RawMaterial` / `Goal` 的定义移到 `domain/dto.ts`，
  宿主从领域层取并再导出——domain 不再 import `shell/store`。
- 反向验证：`tools/test_check_responsibility.py` 6 项——把每个不变量都破坏一次，
  对应断言必须报出（守卫「绿」不等于「在守东西」）。已接入门禁。

### T12 · 证据收口

`docs/product/ACCEPTANCE_RUN.md`：门禁与冒烟的实际 PASS/FAIL/SKIP、断言数、
平台与工具版本、审计项 ↔ 反例测试绑定表、外部条件缺口清单（真实邮箱/模型/
物理麦克风/Windows-Linux 安装首启/真实 WebDAV/检索基准语料/真机外部写入），
以及复核命令。SKIP 项写明缺什么——不拿合成测试冒充真实验收。

## 有意未动 / 后续批次

- **T13 剩余**：反向链接视图、引用失效的显式标记（当前只在点击时提示）、
  选段引用的精确选区（当前取正文开头）；G01 的「素材统一转笔记」未做——
  既有素材不自动变笔记，按 R2 口径由用户显式触发「转为可编辑笔记」。
- **T05 剩余**：附件暂存目前直接落本机 media 目录（没有独立暂存区与补偿清理）；
  空间不足/磁盘故障只做了可控注入验证，未对真实磁盘做危险试验；
  「恢复任务的可中断续跑」未做（取消后重跑靠用户的包幂等性兜底）。
- **T09 剩余**：正在执行的任务被停止/完成、旧内容的索引重建策略、模块级并发上限未做；
  独立 MCP 进程的吊销只做了「读 settings 判定」，未做进程级撤销凭据。
- **T12**（证据收口）：桌面端「保存/关闭可等待路径」需要 Tauri 侧窗口关闭拦截，与 T12 一起验；
  本批的草稿镜像 + beforeunload 冲刷是降级保护，不声称等价。
- 真实 WebDAV 服务、Windows/Linux 安装首启：保持「待真实验收」，不以合成测试冒充。
