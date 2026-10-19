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
- [x] M3 本地语义向量推理（补上路线图里的「本地轻量 Embedding 推理」）：接入 `fastembed`（ONNX Runtime）跑 `multilingual-e5-small`，384 维、纯本地离线，模型按需下载到 `<data_root>/models/fastembed`，且只有用户点「下载」才拉——检索路径 `local_embed` 传 `allow_download=false`，搜一下不会静默下一百多 MB。E5 家族要求 query/passage 前缀，查询侧带 `query:`、卡片侧带 `passage:`，否则检索质量明显下降。向量空间问题用「维度即引擎标识」解决：`search_cards_vector` 只比较同维度向量，`list_stale_embedding_card_ids` 找出换引擎后失配的旧向量，同步流水线一并重算。三档优先级：远程 API → 本地 E5 → 确定性哈希投影。Rust 5 项单测（含缓存探测、未下载时的可执行报错、前缀约定）+ 1 个 `#[ignore]` 真下载真推理测试，本机实测：冷启（含 120 MB 下载）72 s，热启 2.7 s，query~A=0.919 / query~B=0.896 / 跨主题 query~C=0.822，同主题稳定高于跨主题。
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

- [x] 持久化跨素材全文索引：新增 SQLite FTS5 虚表 `fts_materials`（`material_id` / `title` / `raw_text` / `source_url`，与 `fts_cards` 同构同分词）。`save_material` 在同一事务语义下先删后插同步索引；老库在应用启动时由 `db_backfill_material_fts` 幂等补齐；`db_search_materials_fts` 先走 FTS5（bm25 排序），空结果再走 `LIKE` 兜底，保证短中文查询不丢召回。工作台搜索在桌面端按 120ms 去抖查询该索引，命中集合与内存子串匹配取并集，索引不可用时自动退化为纯内存匹配。Rust 侧新增 `test_material_fts_index_lifecycle`（中文/正文命中、编辑后重建、无重复行、清空后 backfill 幂等），前端 `filterEntries` 新增索引集合入参与 5 项断言。
- [x] M4 系统级完整备份包 (.kfbackup)：按 DATA_MODEL_SECOND_BRAIN.md §5.2 实现标准 ZIP 备份包（`manifest.json` 清单 + 各层 JSON + FNV-1a 校验和），浏览器与桌面端同一套纯客户端打包/解包实现 `systemBackup.ts`（`unpackZipStore` 只读 Store 模式 ZIP，无外部依赖）；设置页「导出完整备份包 (.kfbackup)」与「从备份包恢复…」两条真实链路均已接通，恢复走合并语义（按 id 覆盖，不清空本地库），并兼容旧版单一 JSON 格式；3 项单测覆盖逐字段往返、旧格式兼容与缺失清单报错。
- [x] 插件架构与官方插件矩阵：按 PLUGIN_SPECIFICATION.md §4 落地 `pluginRegistry.ts`，规范里的 5 个官方插件（嗅探 / 文档解析 / 温故 FSRS / 语音 ASR / 认知简报）全部登记，另加 MCP 服务插件共 6 项；每项带权限声明、默认启用状态、偏好项与 `availability`（ready / needs-download / planned）。设置页「功能模块与官方插件」按清单渲染开关与权限芯片，**未就绪的插件带「需下载模型 / 待接入」徽标与说明**，不用开关冒充可用。`pluginSettings.ts` 负责在 settings.json 的独立 `plugins` 键持久化，旧键 `reviewPluginEnabled` 保持兼容（不折进插件表，避免盖掉旧值），9 项单测覆盖旧键兼容、显式覆盖、写回保留其余键与默认值不落盘，另 5 项覆盖插件清单与 availability。
- [x] 本地语音转写（official-speech-asr）：接入 `whisper-rs`（whisper.cpp 的 Rust 绑定）静态链进宿主，插件关闭时零运行时占用。模型不随包（GB 级），按需下载到 `<data_root>/models/`（与库文件分开，删库不连带删模型）；下载先写 `.part` 再改名，中断不会留下「看着装好了」的坏文件，进度通过 `knowflick:asr-progress` 事件推到界面。解码只认 16-bit PCM WAV，其它格式在 macOS 走系统 `afconvert` 转 16 kHz 单声道，转不了明确报错。工作台顶栏新增「语音转写」入口：选音频 → 转写 → 以 `sourceType: "audio"` 落进收件箱，提示里给出音频时长、耗时与实时倍率。设置页语音插件展开模型面板（tiny/base/small 三档、安装状态、体积、下载按钮与百分比）。Rust 侧 4 项单测覆盖 WAV 解析（含非 WAV 与 24-bit 拒绝）、模型目录与 URL；另有一个 `#[ignore]` 的真模型真音频测试，本机实跑结果：3.74 秒音频 → 415 ms 转写，输出 "This is a local transcription probe for no flick."。
- [x] MCP (Model Context Protocol) 外部代理接入：按 PLUGIN_SPECIFICATION.md §6 暴露 5 个工具（`search_knowledge` / `create_flash_card` / `add_material` / `get_weekly_briefing` / `get_knowledge_stats`）与 `knowflick://` 资源；`mcpServer.ts` 是宿主内嵌的协议实现（9 项单测），`tools/mcp-server.mjs` 是可被外部 Agent 直接 `node` 启动的 stdio 服务端（真实 SQLite 连接、FTS5 检索、写入后同步全文索引）；`tools/mcp_server_smoke.mjs` 用真实库文件跑通 12 项端到端断言（含写入后重新开库校验落库与索引一致）；设置页展示即插即用的配置片段。
- [x] 主动收集（订阅源）：按 DATA_MODEL_SECOND_BRAIN.md §4 接通 `subscriptions` 表——Rust 侧 `SubscriptionDto` + `save/list/mark_polled/delete` CRUD（`mark_subscription_polled` 单独一条 UPDATE，抓取不覆盖类型/标题，标记不存在的订阅返回错误）；`subscription.ts` 负责目标串归一化（RSS/社区要求完整 http(s) 且禁凭据、GitHub 只收 owner/repo、趋势收语言名）、到期计算、RSS 2.0 与 Atom 手写解析（零依赖、坏条目跳过不拖垮整次抓取）、GitHub Release 与趋势仓库解析、条目按来源链接去重后转素材（`itemsToMaterials`，带订阅来源元数据）；20 项单测覆盖解析、归一化、到期与去重。工作台新增「订阅源」页（新增/启停/删除/立即抓取），并加自动轮询：每 60 秒检查一次到期项，一次只抓一个（并发抓取只会放大网络与写库开销），抓取期间或用户正在编辑时跳过；抓取的条目按去重结果进收件箱 Layer 1，不直接生成卡片；浏览器体验模式没有该表时表单禁用并如实说明。Rust 侧另加 `test_subscription_lifecycle` 与走真实命令函数的 `subscription_commands_round_trip_in_a_real_library`。**真实数据验证**：用 `hnrss.org/frontpage` 的真实 RSS 跑解析，20 条全部解析成功、0 条缺标题或链接、去重按预期跳过 1 条；用 GitHub 真实 releases API 跑 `parseGithubReleases`，5 条 release 的 key/标题/链接/时间都对。
- [x] 端到端浏览器回归补充：新增 `tools/settings_plugins_smoke.mjs`（22 项断言），覆盖插件开关渲染与重载持久化、`plugins` 键写盘形状、MCP 片段、以及「点真实导出按钮拿字节 → 清库 → 走真实恢复输入框」的 .kfbackup 全链路。

## 后续规划与跨平台分发（来自 M1–M4）

| 范围 | 后续规划 | 当前状态 |
|---|---|---|
| M3 检索 | 模型随包分发 / 量化更小的中文模型 / 向量索引加速 | 端侧 ONNX 推理已落地（e5-small 384 维，按需下载）；万级库仍是暴力余弦扫描，量级再大才需要 ANN |
| M4 分发 | Windows MSI、Linux DEB CI 构建及安装冒烟 | macOS DMG 本机实测通过；Windows/Linux 依赖 GitHub Actions CI 矩阵 |
| 插件生态 | 第三方插件沙箱（独立进程 / WASM）与签名体系 | 官方插件矩阵、权限声明与零开销禁用开关已就绪；第三方加载器按规范排在 M4 之后 |
| 本地语音转写 | 更高质量模型（medium/large）与实时流式识别 | 运行时已静态链接、模型按需下载、WAV 与非 WAV（macOS afconvert）都能转；当前是整段文件转写，没有麦克风流式录入 |

本文件必须随实际验收更新，未勾选项不因代码存在或单测通过自动视作完成。
