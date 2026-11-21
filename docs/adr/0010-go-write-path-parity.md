# 第二阶段第一刀：Go 写入路径与跨运行时对拍

> 承接 [ADR-0009](0009-go-phase1-readonly-data-layer.md) 第七节的下一步：先把写能力补上，并且**只动副本**，与 Rust 的 `note_upsert` 逐条对拍。

## 一、做到了什么

| 产物 | 路径 | 说明 |
| --- | --- | --- |
| 可写打开入口 | `library.OpenForWrite` | `mode=rw`（文件必须已存在），与只读 `Open` 分开 |
| 写入语义 | `library.Upsert` | 与 Rust `note_upsert` 对齐：`base_revision` 冲突拒绝、只有 title/body 变化才追加修订、元数据变化只更新当前态 |
| 软删 | `library.Delete` | 与 Rust `note_delete` 同义：进回收站并同步移除 FTS |
| 分块移植 | `library.ChunkMarkdown` | 与 Rust `chunker.rs` 同参数（目标 900、硬限 1200）、同切法、同字符偏移 |

**只读仍是默认。** `Open` 照旧是 `mode=ro` + `query_only`；写必须先 `OpenForWrite`，而它在写方法被调用时还会再查一次 `writable`——两条独立路径，不靠调用方自觉。

## 二、验证：三层

### 2.1 Go 侧 8 项用例

- 新建后编辑追加修订（`created_at` 不被改写、`updated_at` 跟进）
- 只改置顶**不**追加修订
- 过期 `base_revision` 被拒且**不覆盖**当前正文
- 新建时带非零 `base_revision` 被拒（当前修订记 0）
- 只读库拒绝 `Upsert` 与 `Delete`
- 软删后搜不到，重复软删返回 false
- 分块表与 `ChunkMarkdown` 逐条一致（含 `content_revision`）
- 内容变更后分块按新修订重建

### 2.2 关键一条：Go 写 → Rust 读（跨运行时）

`TestExportWriteFixture` 由 Go 写出夹具（一篇写两次、一篇软删），再用 `cargo test go_preview_write_parity -- --ignored` 让 **Rust 读同一文件**并断言：

| 断言 | 说明 |
| --- | --- |
| `current_revision == 2`、`created_at == 1000`、`updated_at == 2000`、`is_favorite` | 修订与时间戳语义 |
| `note_revisions` 恰好 2 条，内容分别是旧/新正文 | 修订是 append-only |
| `note_chunks` 与 **Rust 自己重算的** `chunk_markdown` 逐块相等（index/content/char_start/char_end） | 分块是**独立实现**，不是抄同一份数据 |
| 分块 `content_revision == 2` | 分块跟着内容走 |
| 搜新正文命中 1 篇、搜旧正文 0 篇、搜已删笔记正文 0 篇 | FTS 与删除态同步 |

**分块那一条是这一轮最有价值的部分**：它不是「搬数据」，而是让两套**独立实现的切分算法**在同一段 Markdown 上产出完全相同的块边界与字符偏移。任何一侧改了切法，这条会立刻红。

### 2.3 只读与写入的边界没被破坏

阶段 1 的只读用例仍在跑：`Open` 下 `UPDATE notes` 被 SQLite 拒绝。写入只发生在 `OpenForWrite` 打开的副本上，本机真实库全程未被写过。

## 三、还没做的

| 项 | 现状 |
| --- | --- |
| UI 里的编辑入口 | **没有**。写能力只有 Go 测试与跨运行时对拍在用，界面上仍只能浏览 |
| 恢复 / 强制覆盖 / 批量导入 | 没做 |
| `knowledge_bases`、标签、附件、向量写入 | 没做 |
| 大库写入性能 | 没测 |
| Windows / Linux | 没验 |

**为什么界面先不接**：写是破坏性能力。这一步先把语义对拍钉死，下一步再接 UI，出了问题能立刻分清是「语义不对」还是「界面不对」。

## 四、下一步

1. 界面接上编辑：列表 → 正文可改 → 保存走 `Upsert`；冲突时提示刷新而不是覆盖。
2. 把 `Delete` / 恢复接到回收站。
3. 之后按 ADR-0007 顺序迁 `media/backup` → `http/mail` → `chunker/embed` → `asr`。
