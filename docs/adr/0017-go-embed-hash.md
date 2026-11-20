# 第二阶段第八刀：语义向量（embed）迁到 Go

> 迁 `embed.rs` 与前端 `embeddingEngine.ts` 中**可以确定性复现**的部分：模型状态判定、身份规则、哈希投影与余弦。真正的本地 ONNX 推理本轮**没有迁**（见第四节）。

## 一、迁了什么

| 能力 | Go | 与 Rust/TS 的关系 |
| --- | --- | --- |
| 模型状态 | `Status` / `IsDownloaded` / `CacheDir` | 与 `embed.rs` 同口径：`<data_root>/models/fastembed`，递归找任一 `*.onnx` 即算下载过 |
| 未下载拦截 | `RequireModel` 返回哨兵 `ErrNotDownloaded` | 检索路径必须先过这一关，用户搜一下不该静默拉百 MB |
| 向量身份 | `Identity(provider, dim)` | 与 TS 的 `{provider, model}` 一致：身份必须与向量一起存，跨空间算余弦没有意义 |
| 哈希投影 | `HashEmbedding` | 与 TS `localSemanticHashEmbedding` **逐位对齐** |
| 余弦 | `Cosine` | 与 TS `cosineSimilarity` 同义（长度不等或零向量返回 0） |

## 二、跨语言对拍抓到一个真 bug

我把 Go 的哈希投影与前端逐位比对，第一版**失败**，第 3 维差 0.027。

根因是 JS 的位运算语义：

```js
const index = (h ^ (h >>> 16)) % dim;   // 有符号 int32，可能为负
vec[index] += sign * weight;           // 负下标 → Float32Array 静默丢弃
```

而我的 Go 版本全程用 `uint32`，负下标分量**被算进去了**。两边因此产出不同的向量。

修法是让 Go 复刻 JS 的真实行为：`int(int32(h^(h>>16))) % dim`，负数直接 `continue`（对应「赋负下标被丢弃」）。

**为什么必须复刻而不是「修正」前端**：现有向量都是前端生成的，改前端会让已入库向量全部失效；而且这个「丢弃」是既有数据分布的一部分，悄悄改变它等于换了向量空间。

这条 bug 只有对拍能发现——两侧各自跑测试都是绿的。

## 三、验证

| 用例 | 内容 |
| --- | --- |
| Go 6 项 | 未下载状态与哨兵错误、嵌套 `*.onnx` 检测（空目录不算）、哈希确定性 + L2 归一化、相关文本相似度高于无关文本、空输入零向量、余弦边界 |
| 跨语言对拍 | `src/domain/hashParity.test.ts` 读 Go 导出的 128 维向量，与 TS 同文本投影逐维比对（阈值 1e-6）；**修前失败、修后通过** |

对拍用例默认 `skipIf` 没有 fixture 时跳过，CI 不会因为缺夹具而红。

## 四、没做到的（重要）

| 项 | 现状 |
| --- | --- |
| **本地 ONNX 推理** | **完全没迁**。Rust 用 `fastembed`（`MultilingualE5Small`，384 维）；Go 侧没有等价物，也没有验证过任何 Go ONNX 运行时 |
| 向量请求 | `request_embeddings` 仍未迁（上一轮记的缺口） |
| 前缀规则 | `query: ` / `passage: ` 只在文档里，尚未接进任何调用路径 |
| 维度标脏重算 | 未迁 |

**这意味着 Go 版目前只能算哈希向量，算不了真正的语义向量。** 要不要引入 Go 的 ONNX 运行时（如 `onnxruntime-go` 需要 cgo、`gorgonia` 生态不成熟）是一个独立决策，我倾向先保留 Rust 侧做本地推理、Go 侧只消费结果——但这条需要单独评估，不能默认「迁完了」。

## 五、下一步

`mail` → `asr`；本地推理的归属单独出一份评估。
