# 功能补齐执行清单（2026-10-19）

用户目标：优化功能，完成已规划功能。当前优先顺序由用户确认：先补全局热键托盘、独立闪念胶囊、分栏调宽与键盘操控，然后继续 M1–M4。此清单记录实际状态，不用测试通过代替产品功能完成。

## 当前批次：桌面核心操作与多源收集

- [x] 独立胶囊窗口：快捷键/菜单/托盘呼出，重复打开聚焦，Esc 保留草稿并隐藏，Enter 保存成功再隐藏，保存失败明确报错且保留草稿，中文输入法确认不误提交。
- [x] 托盘：主窗口关闭仍可通过托盘恢复；退出真正结束进程；快捷键注册失败明确显示，不自动占用输入法快捷键。
- [x] 胶囊与主窗口共用 SQLite：保存后主窗口自动更新，不覆盖正在编辑的草稿。
- [x] 分栏拖动：真实鼠标验证、最小/最大约束、正文最小可读宽度、宽度记忆、双击复位、键盘可调。
- [x] 列表键盘：上下选择并滚入可见范围、跨 60 条批次、输入框与弹窗不抢键、`/` 搜索、Enter 聚焦正文、Cmd/Ctrl+E 编辑、Esc 取消编辑。
- [x] 回归：浏览器交互与原生窗口均有证据（桌面交互烟测 22 项、工作台基础烟测 22 项全部 PASS）；安装包与 Windows/Linux 验证独立记录。
- [x] 多源采集与文档解析：GitHub 仓库嗅探 + README 提取、B站视频 BV 号解析与简介提取、通用正文抓取；纯本地 Word (DOCX) 提取 XML 段落标题与 Markdown 格式转换、纯本地 PDF 文本流提取、Markdown 与 TXT 标题层级切分。
- [x] 模型厂商预设：DeepSeek、智谱 GLM、Kimi、通义千问、硅基流动、OpenAI、Anthropic Claude、本地 Ollama 完整一键预设与端点适配。
- [x] M4 数据主权与开放导出：一键生成带 YAML Frontmatter 的 Markdown 知识库文件夹体系（按分类及收件箱分层归档，Obsidian 友好），支持纯本地生成标准 ZIP 压缩包下载，往返解析一致性通过自动化单测。
- [x] M1 检索与高亮：⌘K 全局搜索中文分词匹配，列表标题与正文关键词 `<mark>` 实体高亮，智能居中截取长正文上下文摘要片段（`extractSnippet`），通过单测覆盖。
- [x] M3 端侧 Embedding 向量生成与流水线闭环：实现 `EmbeddingEngine` 统一向量引擎，支持远程神经网络模型嵌入（OpenAI / 硅基流动 BGE / Ollama / 智谱等 `/v1/embeddings` 端点）与本地 100% 离线确定性语义特征投影（Zero-dependency Local Semantic Feature Projection，微秒级 128 维单位向量，具备单调余弦区分度）；实现后台非阻塞卡片批量同步流水线 `syncCardEmbeddings`，与 Rust 原生 SQLite `db_list_unembedded_card_ids` / `db_save_card_embeddings_batch` 事务无缝协同；问答抽屉接入真实向量生成并触发 `dbSearchCardsHybrid` 检索；单测覆盖端点正规化、文本拼接、L2 归一化、语义区分度与引擎回退全逻辑。
- [x] M3 检索与向量融合：Rust SQLite 层已建立 `card_embeddings` 向量表（f32 浮点序列化为小端二进制存储），实现无外部依赖的高性能余弦相似度计算 `search_cards_vector` 与多路倒数排名融合 `search_cards_hybrid`（FTS5 词法 + 向量语义 RRF），通过单元测试闭环；前端 `store.ts` 完整封装调用接口。
- [x] M3 问答与认知产物持久化：问答抽屉采用 RRF (Reciprocal Rank Fusion) 多路倒数排名融合（词法匹配 + 分类/标签权重 + 优先级加权）召回上下文，支持多轮会话追问；周度认知简报支持一键落库至 SQLite Layer 3 `artifacts` 产物表（包含 Rust 原生 CRUD 与单测闭环），问答引用卡片支持点击直达回溯。
- [x] M2 AI 智能切片与卡片确认流：长文自动结构化提示词与切片能力（`smartSliceText`）、素材面板实时字符与 Token 用量预估（`estimateTokenCount`），AI 生成的多张原子卡支持独立勾选/反选/全选后再确认入库。
- [x] M4 复习掌握度与负荷面板：新增 `reviewStats`（今日待复习 / 已复习 / 尚未复习 / 平均间隔、五档掌握度分布、未来 7 天到期负荷柱状预测），并接入「温故复习」页顶部；4 项单测覆盖分桶、到期与预测逻辑。
- [x] M4 macOS 安装包实机生成与挂载检验：成功完成 `npm run tauri build -- --bundles dmg` 真实 Release 构建，产出 `KnowFlick_0.1.0_aarch64.dmg`（12.79 MiB）；挂载并校验 CRC32 全绿，内含 `KnowFlick.app`、`.VolumeIcon.icns` 与 Applications 替身软链接。
- [x] UI 原生接缝：CSS tokens 全面对接系统级 `AccentColor` 与 `AccentColorText`（WKWebView 原生支持，非现代平台平滑回退至冷灰色系预设）。
- [x] UI 原生材质接缝：引入 `window-vibrancy`（macOS 启用原生毛玻璃 `NSVisualEffectMaterial::Sidebar` 结合半透明窗口，Windows 自动对接 Windows 11 `apply_mica` 原生 Mica 材质）。
- [x] UI 和功能一致性与细节规范化：
  - 排版与圆角标尺严格对齐：全面清理 `<12px` 残余字体，正文严格 14px、辅助 12px、标题 17/22px；圆角统一收敛为 4px（控件）与 8px（面板容器），清理非标乱值；
  - 核心控件无障碍契约对齐：设置页分段控制器接入 `role="radiogroup"` / `role="radio"` 与 `aria-checked`；Switch 接入 `role="switch"` 与无障碍标签；
  - 复习测评防误触与视觉解耦：卡片翻开前评分按钮置灰禁用，杜绝盲评；正反面信息分层解耦，反面专注深度机制解析；
  - 问答引擎健壮性强化：端点解析加固、URL 容错防白屏防卡死；问答 Prompt 自动带入最近多轮会话上下文，支持连续追问；
  - 正文阅读器升级结构化 Markdown 渲染（`MarkdownRenderer`）：零外部依赖原生支持多级标题、引用块、有序/无序列表、行内代码与代码块、加粗等标准 Markdown 语法。

## 后续规划与跨平台分发（来自 M1–M4）

| 范围 | 后续规划 | 当前状态 |
|---|---|---|
| M3 检索 | 端侧嵌入推理模型本地打包（如 ONNX Runtime Web / ort-rust 结合量化小模型） | 统一 Embedding 引擎（API + 本地语义特征投影）与端侧混合检索全链路闭环，可进一步增加本地 ONNX 模型权重 |
| M4 分发 | Windows MSI、Linux DEB CI 构建及安装冒烟 | macOS DMG 本机实测通过；Windows/Linux 依赖 GitHub Actions CI 矩阵 |

本文件必须随实际验收更新，未勾选项不因代码存在或单测通过自动视作完成。
