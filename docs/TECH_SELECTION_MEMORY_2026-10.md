# 开源 Agent 记忆层与本地检索架构选型备忘录（2026-10）

> 调研时点：2026-10-18
> 依据来源：GitHub API 实时查询、各项目源码与官方文档、PyPI 与 HuggingFace 规范。
> 关联决议： [ADR-0003](adr/0003-desktop-second-brain-architecture.md) · [PRODUCT_REDIRECT_2026-10-18.md](PRODUCT_REDIRECT_2026-10-18.md)

---

## 1. OpenViking（字节火山引擎）深度拆解

- **仓库**：`volcengine/OpenViking`（★40,240，创建于 2026-01-05，最新 v0.5.0）。
- **定位**：Agent 专属的上下文数据库（Context Database），通过 `viking://` 虚拟文件系统组织外部资源（Resources）、用户记忆（Memories）与技能指令（Skills）。
- **L0/L1/L2 分层机制真相**：
  - L0（`.abstract.md`，默认 256 字符）与 L1（`.overview.md`，默认 4000 字符）是**目录级语义 sidecar**，并非为每个文件生成；
  - L0 从 L1 标题段落中机械截断提取，用于向量快速过滤；L1 用于重排序与层级导航；L2 才是原始全文；
  - **启发**：分层加载的思路极佳，但在离线桌面端，由 LLM 为每个目录异步生成摘要会消耗大量 Token 与时间。Letta MemFS 采用目录文件约定控制上下文进出的做法在端侧更具性价比。
- **存储与部署形态**：
  - 底层为 AGFS/RAGFS（Rust 文件系统）+ Vector Index，**没有 SQLite 嵌入式选项**；
  - 必须单独常驻一个 Python HTTP 服务（`openviking-server`，FastAPI + uvicorn，端口 1933）；
  - 依赖树超过 3GB（包含 scrapy、trafilatura、tree-sitter×10、OpenTelemetry 等），极重。
- **许可证红线（核心否决项）**：
  - **主项目采用 AGPL-3.0**；
  - 官方 README 附加两条非标准限制：**禁止整体改写后再开源**、**把项目代码整体或大部分翻译成另一种语言需要火山引擎书面授权**；
  - 商业桌面客户端若捆绑或直接内嵌该代码，存在巨大的开源合规与源码提供风险。

---

## 2. 字节系及近期开源记忆项目排查

针对社区讨论的热点项目进行交叉核实：

| 项目 | 事实与特征 | 结论判定 |
|---|---|---|
| **火山引擎记忆库 Mem0** | 火山引擎 2026-02 商业发布，自研 Mem0g 图基记忆架构（向量+图双路），兼容开源 mem0 生态 | **商业托管云服务**，非独立开源仓库 |
| **`bytedance/deer-flow`** | ★84,066，MIT，SuperAgent 框架，自带 agent memory 并已官方接入 OpenViking | 属于 Agent 编排框架而非底层单体记忆库 |
| **`ByteDance-Seed/TaskMem`** | ★30，Apache-2.0，2026-06 后停更，多模态记忆策略强化学习论文代码 | 论文试验原型，非生产级记忆库 |
| **`Tencent-Hunyuan/Hy-Memory`** | ★725，2026-10-15 新建发布，腾讯混元团队推出的功能性神经记忆模型框架 | 腾讯混元近期新发，非字节项目 |
| **`mem0ai/openmemory`** | ★98，MIT，Mem0 官方开源的跨 Agent 会话记忆迁移 CLI | 客户端轻量迁移工具，抖音博主常作为「OpenMemory」讨论 |

---

## 3. 开源记忆层横向评测（选型对比）

| 项目 | 语言 | 存储后端 | 纯本地嵌入式？ | 许可证 | 架构参考价值 |
|---|---|---|---|---|---|
| **mem0** | Python/TS | 本地 Qdrant + SQLite | ✅ 库模式可跑 | Apache-2.0 | 通用记忆原语标准，但开源版无图记忆 |
| **Letta (MemFS)** | TS / Python | Git 仓库 + Markdown | ✅ 纯文件与本地进程 | Apache-2.0 | **极高**：文件即记忆、目录索引控制进上下文、支持 Git 回滚与人工编辑 |
| **Graphiti** | Python | 必须外部图数据库（Neo4j/FalkorDB） | ❌ 依赖外部服务 | Apache-2.0 | 依赖过重，不适合轻量桌面端 |
| **txtai** | Python | 内置 SQLite + 向量扩展 | ✅ 单文件本地 | Apache-2.0 | 全功能集成参考 |
| **AnythingLLM** | JS/Desktop | 默认 LanceDB 嵌入式 | ✅ 桌面端完整可用 | MIT | **极高**：桌面端本地优先设计的优秀典范 |
| **OpenViking** | Py/Rust/TS | RAGFS + Vector Index (独立服务) | ❌ 需起 HTTP 服务 | AGPL-3.0 | 仅借鉴其 Context 分类模式，严禁代码依赖 |

---

## 4. 本地优先检索技术实测结论

### 4.1 SQLite-vec 性能与规模边界
- 关键事实：`sqlite-vec`（v0.1.x）在当前实现中是**纯暴力余弦距离扫描（Brute-force），不含复杂 ANN 索引**；
- 实测基准（10,000 条 384 维向量）：
  - 插入 10K 向量耗时 11s；
  - 5 并发查询 **p50 仅 9ms，p99 仅 12ms**；
  - 内存占用约 40MB；
- 结论：在个人第二大脑规模（1 万条卡片以内），**暴力扫描拥有极高的可靠性与极快的速度，完全不需要引入重型外部向量数据库**；超过 3 万条时可开启 `vec_quantize_binary()` 二进制量化粗筛。

### 4.2 FTS5 中文全文检索的工程陷阱
- **默认 unicode61 分词器**：无法分词中文，整段无空格连续汉字会被当作一个巨大的单一 Token，导致子串查询失效；
- **trigram 分词器**：官方明确规定**少于 3 个字符的子串直接匹配失败**，两字中文（如“复习”、“架构”、“笔记”）完全搜不出结果；
- **最佳工程实践**：**写入前统一中文分词**（通过 jieba 或本地轻量分词将分词结果以空格拼接），存入 FTS5 表，配合 `unicode61 remove_diacritics 2`，获得精准的 BM25 评分。

### 4.3 本地 Embedding 模型推荐
- **首选档**：`Qwen/Qwen3-Embedding-0.6B`（官方提供 GGUF 格式，支持 MRL 维度截断，可走 `llama.cpp` 原生 C++ 极速推理，中文理解力极强）；
- **轻量保底档**：`BAAI/bge-small-zh-v1.5`（192 MB，直接通过 ONNX Runtime 运行，零显卡依赖）。

---

## 5. 多模态本地处理能力分层

1. **图片/截图 OCR**：
   - macOS 端优先调用系统原生 `Vision.framework`（`VNRecognizeTextRequest`）：零模型下载、零磁盘开销、硬件加速、简体繁体精度极佳；
   - Windows / Linux 端采用 PaddleOCR（ONNX 轻量导出版，约 15MB 权重）作为跨平台保底。
2. **语音转文字（ASR）**：
   - 选用 `whisper.cpp`（MIT 协议），推荐 `large-v3-turbo` 的 Q5 量化模型（仅 574 MB），在 CPU 上实时率远超 1.0x；低配机型提供 `small` 档位（190 MB）；
   - 入库前注入「中文领域热词表」（`initial_prompt`），修正专有名词错别字。
3. **视频处理策略**：
   - 严禁下载全片视频；
   - 优先嗅探同名/内嵌字幕轨（`.srt` / `.vtt`）；
   - 无字幕时仅通过 FFmpeg 抽离音频流，经由 VAD（静音检测）后送入 Whisper 转写。
