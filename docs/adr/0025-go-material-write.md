# 第二阶段第十六刀：素材写入库迁到 Go

> 承接 ADR-0024。上一批只算出素材记录；这一批把它真正写进 materials 表并刷新全文索引。

## 一、迁了什么

| 规则 | Go | 与 Rust 的关系 |
| --- | --- | --- |
| 内容哈希 | `sha256Hex(raw_text)` | 与 calculate_hash 同构 |
| 插入/更新 | 一条 upsert | 冲突时整行更新、version 自增、is_deleted 复位、deleted_at 清空 |
| 全文索引 | 先删后插 | 与主表在同一事务里，保证「库里改了、索引也改」 |

## 二、对拍抓到的两处

### 2.1 猜 id 会把「查不到」伪装成「写入失败」

Rust 侧对拍我一开始把素材 id 写死成 `mail-8a8ab5b0c269c7e2013d06c326e2eb65`，结果 `QueryReturnedNoRows`。
真实 id 是 `mail-f95b6b8f…`——我拿别的夹具的 id 当了这个夹具的 id。

改成让 Go 把真实 id 写进 sidecar 文件、Rust 读它。**猜 id 会让「查不到行」看起来像「写入没成功」，两者的修法完全不同。**

### 2.2 中文 FTS 的 MATCH 不可靠

Go 侧最初用 `fts_materials MATCH '本周'` 断言索引，得到 0 命中。

这未必是索引没写进去——FTS5 的中文分词与查询语法都有自己的脾气。改成按 `material_id` 直接读索引行，断言 title/raw_text 与主表一致。

**用「搜得到」来证明「写进去了」是不稳的**：搜索涉及分词、大小写、查询语法，任一环节不同都会给出假阴性。

## 三、验证

| 用例 | 内容 |
| --- | --- |
| Go 4 项 | 插入并写索引（title/hash/version=1、索引行与主表一致）；upsert 后 version=2、is_deleted 复位、deleted_at 清空、索引里是新正文；同一 Message-ID 换 UID 只留一行 |
| 跨运行时对拍 | Rust `go_material_write_parity` 读 Go 写的库：标题、正文、`content_hash == calculate_hash(body)`、version=1、FTS 标题与主表一致 |

## 四、还没做

| 项 | 现状 |
| --- | --- |
| 去重账本写入 | 未迁（mail_imports / mail_rejected 的插入与清理） |
| 同步执行与进度 | 未迁 |
| SyncMode（New / History / Retry） | 未迁 |
| 单封失败不阻断整轮 | 逻辑在 Rust 的 process_uid 里，未迁 |
| 真实邮箱邮件 | 未验 |

**Go 版现在能把一封邮件变成库里的一行素材并进索引**，但还没有「跑一轮同步」这件事。

## 五、下一步

同步执行：三种 SyncMode、游标推进、单封失败隔离，然后是去重账本。
