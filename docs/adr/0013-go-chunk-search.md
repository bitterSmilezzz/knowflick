# 第二阶段第四刀：分块检索带回原文偏移

> 承接 ADR-0007/0010：Rust 侧早有 NoteChunkHit（命中块 + 父笔记标题 + 原文偏移），Go 侧此前**只写分块、不查分块**——索引写了却用不上。这一刀补上。

## 一、做了什么

| 能力 | Go 实现 |
| --- | --- |
| 分块检索 | Library.SearchChunks：FTS5 词 AND 查询 + 连续中文 LIKE 兜底，回收站排除，与 Rust search_note_chunks 同义 |
| 回原件 | 命中带 charStart / charEnd（按 Unicode 标量计），可切回原笔记正文的具体位置 |
| 界面 | 搜索框旁「按分块 / 按整篇」切换；命中列出笔记标题、字符区间、块号与片段，并有「打开原文」 |

**关键约束**：分块命中必须带偏移。切片之后回不到原件的检索，在知识库场景里等于没有证据链。

## 二、验证

### 2.1 Go 侧

TestSearchChunksReturnsOriginalOffsets：

- FTS 命中 1 处，父笔记 id/标题正确；
- charStart..charEnd 落在 ChunkMarkdown(body) 的某个真实块上；
- 用这组偏移从**原始正文**切出的片段与命中内容一致；
- 连续中文子串「识库范」走 LIKE 兜底也能回偏移；
- 软删后分块检索立即无命中。

### 2.2 跨运行时对拍

扩展 go_preview_write_parity（Rust 读 Go 写的夹具）：Rust 用自己的 search_note_chunks 查「知识库范围」，得 1 条命中，父笔记与标题正确；再用 char_start..char_end 从原文切出 span，与命中内容相等。

**踩到的一处语义差异**：Rust 的块内容按 trim_end() 存，偏移区间则覆盖原始正文的尾部换行，所以「span 与 content 严格相等」这个断言本身是错的。修法是在断言里 span.trim_end()，并把理由写进断言信息——不是放宽测试，是把契约说准。

### 2.3 原生窗口（真实 WebView）

| 步骤 | 无障碍树证据 |
| --- | --- |
| 切「按分块」 | 出现 AXToggle「按分块」，搜索框占位变成「搜索分块（可回原文偏移）」 |
| 搜「知识库范围」 | 回执「分块命中 1 处，偏移可回原文」；命中区显示「夹具标题 字符 0–36 · 块 0」与片段 |
| 点「打开原文」 | 右侧正文切到父笔记「夹具标题」，修订 2 |

### 2.4 一个构建陷阱（已修）

go:embed 的产物可能随构建缓存保留旧副本；只改 Vite 产物、不触发 Go 包重编时，二进制带的还是旧界面。加 TestEmbeddedBundleIsCurrent 断言嵌入的 index.html 引用当前 bundle hash，把「界面改了但二进制没带上」从静默故障变成测试失败。

## 三、还没做

- 向量检索（note_chunk_embeddings）与混合召回；
- 命中高亮定位到正文具体字符位置（目前是切到父笔记，不自动滚动）；
- 搜索结果分页；
- Windows / Linux 与 .app 签名。

## 四、下一步

按 ADR-0007 顺序继续迁 media/backup → http/mail → chunker/embed（向量部分）→ asr。
