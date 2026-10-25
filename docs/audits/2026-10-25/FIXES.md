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

## 有意未动 / 后续批次

- **T05**（整份恢复一致性/失败报告）、**T07**（浏览器笔记损坏保护）、**T08**（向量空间与内容失效）、
  **T09**（模块开关生命周期）、**T10**（MCP 安装分发）、**T11**（职责收口）、**T13**：依赖顺序未到，见 TASKS.md。
- **T12**（证据收口）：桌面端「保存/关闭可等待路径」需要 Tauri 侧窗口关闭拦截，与 T12 一起验；
  本批的草稿镜像 + beforeunload 冲刷是降级保护，不声称等价。
- 真实 WebDAV 服务、Windows/Linux 安装首启：保持「待真实验收」，不以合成测试冒充。
