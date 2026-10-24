# 笔记数据模型与迁移契约（R1）

日期：2026-10-24。状态：**实施契约**。依据 [ADR-0004](adr/0004-notes-knowledge-applications.md) 与
[产品重规划](product/README.md) 的 R1 首个开发批次：「先写修订与迁移契约，再实现基础编辑和链路」。
本文是代码与测试必须满足的约束；改契约先改这里，再改实现，两边不得漂移。

## 实体与表（SQLite，全部增量添加，不改动既有表）

```sql
notes                一篇可持续编辑的笔记（当前态）
  id                 TEXT PRIMARY KEY           客户端生成 UUID
  title              TEXT NOT NULL DEFAULT ''
  body_md            TEXT NOT NULL DEFAULT ''   当前正文：Markdown 块文档（见「正文格式」）
  notebook           TEXT                       所属笔记本（单层名，NULL=未分组）
  tags_json          TEXT NOT NULL DEFAULT '[]'
  is_pinned          INTEGER NOT NULL DEFAULT 0
  is_favorite        INTEGER NOT NULL DEFAULT 0
  archived_at        INTEGER                    NULL=未归档
  source_material_id TEXT REFERENCES materials(id) ON DELETE SET NULL
  current_revision   INTEGER NOT NULL DEFAULT 1  与 note_revisions 对齐
  created_at / updated_at INTEGER NOT NULL
  is_deleted         INTEGER NOT NULL DEFAULT 0  回收站软删（B02）
  deleted_at         INTEGER

note_revisions       修订历史（append-only，不 UPDATE 不 DELETE）
  (note_id, revision) PRIMARY KEY
  title / body_md / saved_at
  revision 从 1 起，单调递增；upsert 成功即追加一行

knowledge_bases      知识库（范围）
  id / name / description / created_at / updated_at

kb_membership        成员关系；同一笔记可属多个库，不复制正文（C01）
  (kb_id, note_id) PRIMARY KEY, added_at

fts_notes            FTS5：title + body；保存同步维护，删除/恢复同步增删
```

既有 `materials` / `cards` / `fts_*` 一律不动：旧卡片 id、FSRS 字段（repetition /
interval_days / ease_factor / stability / difficulty / 评分与复习记录）原样保留；
`cards.material_id` 继续有意义。**新增笔记与旧卡片互不覆盖。**

## 修订语义（防旧草稿覆盖新内容）

`note_upsert` 必须带 `base_revision`：

- 期望修订 = 当前 `current_revision` → 提交：追加修订 N+1，更新当前态，写 FTS，返回新修订号。
- 期望修订 ≠ 当前 → **拒绝**，返回中文错误与当前修订号；调用方不得静默覆盖
  （来自另一窗口、MCP 或同步的旧草稿都走这条防线）。
- 新建笔记 revision=1。
- 修订历史 append-only：恢复回收站、归档、收藏等**元数据变化不产生修订**；
  只有 title / body_md 变化才追加修订。修订号永不回退、不复用。

## 保存顺序与故障

笔记正文存 SQLite（权威），附件仍走 `media/`（R1 切片的新建笔记不带新附件类型，
既有 ink/audio/image 附件通过 `source_material_id` 或正文引用沿用）。
保存在一个事务内完成：修订校验 → 写 notes 当前态 → 追加修订 → 更新 FTS。
任何一步失败整体回滚，不允许出现「当前态已改而修订缺失」或「FTS 与正文不一致」的中间态。

## 正文格式（R1）

`body_md` 是 UTF-8 Markdown 文本：标题外的段落 / 列表 / 待办 / 引用 / 代码块 / 链接 /
行内图片引用（`media/...` 相对路径）。块标识（B01 完整块文档、旁车文件）属于后续批次；
R1 契约只保证：`body_md` 可无损往返（读回==写入），导出 Markdown 即正文本身。

## 删除与回收站

`note_delete` = 软删（is_deleted=1, deleted_at），FTS 同步移除 → 搜不到；
`note_restore` 恢复并回填 FTS。修订历史在软删期间保留。R1 不做物理清除
（引用计数与墓碑是 R3 的同步前提，见 LOCAL_DATA_AND_AI）。

## 知识库

- `kb_create(name)` 名称非空唯一（同名列唯一约束由应用层保证并返回可读错误）。
- `kb_add_note / kb_remove_note` 幂等（重复加入不报错、不重复行）。
- 一个笔记可属多个库；删除笔记后成员关系随软删对检索不可见，物理删除时级联。
- R1 的「搜索命中正文」：`search_notes(query)` 走 fts_notes，可按 kb 过滤（join membership），
  **不同库检索不串库**（过滤在 SQL 层，不在界面层）。

## 导出与恢复（.kfbackup schemaVersion 2）

- 新增 `notes.json`（全部字段 + current_revision）与 `knowledge_bases.json`
  （库 + 成员关系）。manifest.stats 增加 `notes` / `knowledgeBases`，checksums 覆盖两个新文件。
- `schemaVersion: 2`；读取端按「有 notes.json 就恢复」兼容 v1 旧包（无笔记即空集）。
- 恢复到新目录后：笔记正文、修订号、笔记本/标签/收藏、库与成员关系逐项一致；
  既有素材/卡片/附件/学习进度恢复行为不变（回归既有 systemBackup 测试）。
- 修订历史明细（note_revisions 全量）不入包：包携带当前态与修订号，足够恢复与后续修订；
  全量历史归档是后续批次（与 Job/Change 一起设计）。

## 迁移

- 不回填：既有 materials 不自动转成 notes（「来源→笔记」映射是 R2 统一笔记模型的事）。
  R1 的新笔记与旧素材在界面共存、都可被搜索。
- 兼容出口：`cards.json`（Android 交换）不动；它不是笔记系统的同步协议。
- **R2 映射（已实现）**：`note_ensure_from_material` 按需把一篇素材映射为可编辑笔记——
  幂等键是 `source_material_id`（重复映射返回同一篇），正文取 `cleaned_markdown ?? raw_text`，
  原素材不删不改（编辑不回写原件），旧卡片与 FSRS 字段不受影响；不做全库启动回填，
  由用户在素材详情显式触发（「转为可编辑笔记」）。
- 升级路径：`init_tables` 增量建表，老库打开即得新表，无数据搬迁、无阻塞。

## 界面契约（链路验收用）

R1 纵向切片必须能在真实界面走通并在冒烟中断言：

1. 新建笔记 → 直接可写（标题 + 正文）；
2. 停止输入后自动保存（无需手动点保存），重启应用后内容在；
3. 加入某知识库；
4. 全文搜索命中**正文**（不是只命中标题）并回到该笔记；
5. 完整导出 → 恢复到新目录 → 正文与库成员关系一致。

无网络、无 AI 密钥时上述链路全部可用。
