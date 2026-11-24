# 03 · 接口、数据与外部接入

快照：2026-11-12，`workbench/second-brain-validation`，以提交 `ca0858d` 及审阅时工作树为基线。下文的“已接线”表示代码里存在调用链；工作树中的 MCP 新授权、复习事件和扩展备份等改动不据此视为已合并或已发布。具体证据见[验收运行记录](../ACCEPTANCE_RUN.md)，平台和产品交付顺序见[产品路线](01-PRODUCT-ROADMAP.md)。

## 接口分层

| 接口面 | 调用方向 | 数据与边界 |
| --- | --- | --- |
| 桌面应用内 | React → `ui/workspace/repository.ts` 或宿主适配 → `shell/store.ts` / `shell/mail.ts` → Tauri IPC → Rust → SQLite / 设备 / 网络 | 内部接口；Rust 校验参数和路径，界面处理加载、失败、重试与部分成功。桌面命令不等于 HTTP API。 |
| 浏览器体验 | 同一 React 界面 → 浏览器存储 / 领域逻辑；对话经浏览器 `fetch` | 目前主要用 `localStorage`，API Key 在 `sessionStorage`。受源隔离、浏览器配额、跨域和多标签写入竞争影响；没有 Rust、原生目录、IMAP、项目 MCP、桌面逐次历史等能力。 |
| 外部 AI 客户端 | 外部客户端 → Node.js 本地 stdio MCP → 范围授权和 SQLite；旧入口额外读取 `cards.json` | 授权由桌面用户创建；每次请求重新核验。静态 Markdown / Skill 包是主动导出的文件，权限撤销不会修改已交付文件。 |
| Android | Compose → Kotlin 领域和持久化 → App 私有 `filesDir/store`、系统分享/文件选择、旧 LAN 卡片协议 | 同桌面共享卡片、设置和学科契约；不读取桌面 SQLite，也不承诺现有 `.kfbackup` 全量恢复。 |
| 网络服务 | 桌面 Rust → 用户指定模型 / 网页 / 订阅 / 邮箱 / WebDAV，或下载模型权重；浏览器仅执行它支持的路径 | 每类出口单独说明目的地、字段、凭据和失败。当前无项目方托管知识 API 或帐号前置。 |

代码入口：[工作台仓储](../../../apps/workbench/src/ui/workspace/repository.ts) · [宿主适配](../../../apps/workbench/src/shell/store.ts) · [邮箱适配](../../../apps/workbench/src/shell/mail.ts) · [Go 壳装配](../../../apps/workbench-go/main.go) · [MCP 授权](../../../apps/workbench-go/internal/mcpgrants) · [Android 数据与同步](../../../apps/android/README.md)。

## 桌面 IPC 命令清单

下表覆盖当前 `generate_handler!` 注册的 133 个命令，含历史兼容命令。以 Rust 签名、序列化结构和 TypeScript 适配为准；通常参数及返回对象使用 camelCase，具体可选项和返回值不能从名称猜测。带 `dir` 的接口一般允许传当前库目录或 `null` 使用默认库；不带 `dir` 的接口不能被界面假定支持切库。

| 功能 | 命令 | 调用用途 |
| --- | --- | --- |
| 设置和文件 | `load_store`、`save_cards`、`save_settings`、`save_search_history`、`read_archive`、`read_api_key`、`write_api_key`、`export_archive`、`export_cards_json`、`read_text_file`、`read_import_report`、`save_import_report` | 载入库目录与兼容文件；持久化设置、最近搜索、最近导入报告；用户选择文件后读取；输出旧归档和 Android 卡片交换文件。凭据独立。 |
| 媒体和附件 | `save_media`、`read_media`、`backup_restore_media` | 媒体字节经 Base64 传入/传出，不把大数组写进记录 JSON；Rust 约束类型、大小、扩展名和库内路径。恢复检查路径和冲突，实际落位改变时回写引用。 |
| 网络与外部打开 | `fetch_clip`、`complete_chat`、`request_embeddings`、`open_url` | 抓取返回正文和最终地址；模型请求返回文本或向量数组；打开 HTTP(S) 链接走系统浏览器。 |
| 卡片、素材、产物 | `db_load_cards`、`db_upsert_card`、`db_delete_card`、`db_replace_cards`、`db_save_material`、`db_list_materials`、`db_update_material_status`、`db_get_stats`、`db_library_signature`、`db_save_artifact`、`db_list_artifacts`、`db_delete_artifact` | 列表与写入、兼容整库替换、收件箱状态、统计、外部更新检测、保存应用产物。常规保存用领域对应的单条写入；恢复不复用覆盖式更新。 |
| 全文和卡片向量 | `db_search_cards_fts`、`db_search_materials_fts`、`db_backfill_material_fts`、`db_save_card_embedding`、`db_search_cards_vector`、`db_search_cards_hybrid`、`db_list_unembedded_card_ids`、`db_save_card_embeddings_batch`、`db_list_stale_embedding_card_ids` | 全文召回、补索引、向量身份校验、混合召回与批量重建；这些操作不定义来源对象本身。 |
| 笔记与切片 | `note_upsert`、`note_ensure_from_material`、`note_get`、`note_list`、`note_delete`、`note_restore`、`note_restore_upsert`、`note_search`、`note_search_chunks`、`note_list_chunk_texts`、`note_save_chunk_embeddings`、`note_search_chunks_vector` | 版本校验、素材转独立笔记、分页、软删除、恢复、全文和切片召回。四条切片命令接受可选 `dir`，由工作区传入当前库。待嵌入块按模型和修订过滤；写入须回传读取时的 `content_revision`。 |
| 知识库关系 | `kb_create`、`kb_list`、`kb_add_note`、`kb_remove_note`、`kb_membership`、`kb_restore_membership` | 知识库是范围，成员关系独立于笔记；恢复使用专门入口并保留关联时间、逐条报告结果。 |
| 邮箱 | `mail_list_accounts`、`mail_save_account`、`mail_test_account`、`mail_remove_account`、`mail_sync_account`、`mail_sync_history`、`mail_list_rejected`、`mail_retry_rejected`、`mail_sync_due_accounts` | 管账号元数据，测试连接，增量与历史抓取，隔离和重试失败邮件，应用运行时按配置检查到期账号。返回状态与计数，不返回密码。 |
| 订阅 | `db_list_subscriptions`、`db_save_subscription`、`db_mark_subscription_polled`、`db_delete_subscription` | 配置、最近轮询标记；读取网络资源复用抓取层，解析后进入素材。 |
| 项目与导出 | `project_create_cmd`、`project_list`、`project_add_note`、`project_remove_note`、`project_archive_cmd`、`project_member_list`、`project_member_index`、`project_export_markdown_cmd`、`project_export_snapshot` | 项目成员是问答、复盘、创作和 MCP 项目访问边界；导出取有界快照，封存项目拒绝导出。 |
| 画像与治理 | `profile_claim_add`、`profile_claims_active`、`profile_claims_all`、`profile_claims_for_answer`、`profile_claim_confirm`、`profile_claim_pause`、`profile_claim_resume`、`profile_claim_deny`、`profile_claim_delete`、`profile_denial_clear_by_evidence` | 管理陈述、证据、作用域、状态和否认标记；治理列表与可参与当前回答的集合不同。 |
| 目标与逐次复习 | `goal_create_cmd`、`goal_set_scope_cmd`、`goal_list_active`、`goal_review_snapshot`、`goal_link_evidence_cmd`、`goal_achieve_cmd`、`goal_abandon_cmd`、`review_history_period`、`review_record` | 用户决定目标条件和达成状态，复盘快照读取当前事实；逐次评分与卡片排程同一事务。 |
| 本地模型 | `asr_model_status`、`asr_download_model`、`asr_transcribe`、`local_embed_status`、`local_embed_warm_up`、`local_embed` | 查权重、用户按需下载或预热、离线推理；不把媒体字节交给外部模型。 |
| 桌面宿主和授权 | `hide_capsule`、`toggle_capsule`、`get_shortcut_status`、`mcp_server_paths`、`mcp_grant_create`、`mcp_grant_list`、`mcp_grant_revoke` | 记录胶囊、全局快捷键状态、查实际安装的脚本路径、创建/列出/撤销连接授权。只有创建返回一次性明文令牌。 |
| 导出、上传与加密 | `backup_capture_database`、`backup_copy_to_directory`、`webdav_upload_backup`、`read_webdav_credential`、`write_webdav_credential`、`e2ee_encrypt`、`e2ee_decrypt` | 一致性数据库快照、指定目录和 WebDAV 的单向备份、独立凭据；加解密命令已有，界面链路未接。 |
| 备份恢复 | `backup_validate_r4`、`backup_validate_subscriptions`、`backup_validate_mail`、`backup_validate_review_history`、`backup_restore_r4`、`backup_restore_subscriptions`、`backup_restore_mail`、`backup_restore_review_history`、`backup_restore_material`、`backup_restore_card`、`backup_restore_artifact`、`backup_restore_deleted_records`、`backup_restore_note`、`backup_restore_note_history` | 先校验输入与现库，再按类型分批恢复；需防写入期间变动，不用历史回放覆盖现用记录。附件和知识库关系的专用恢复命令见上方各行。 |

非命令通道：`knowflick:library-changed` 通知界面重新读取；外部独立进程不在 Tauri 事件总线上，由 `db_library_signature` 内容签名等刷新路径发现。不能仅凭文件修改时间断定无改动。`knowflick:capsule-open` 打开记录；`knowflick:asr-progress` 汇报下载进度。目录/文件选择及通知权限走 Tauri 插件，当前权限主要给 `main` 主窗。

调用示例（内部形状，建议通过宿主适配调用）：

```ts
const saved = await invoke("note_upsert", { dir, note, baseRevision });
const matches = await invoke("note_search", { dir, query: "项目周报", kbId, limit: 20 });
```

保存以读取到的版本作为 `baseRevision`。旧版本提交失败后保留草稿并提示处理冲突；不能用自动覆盖“修复”。检索先按知识库成员约束再排名，空结果仍区分筛选无命中和查询失败。

## 权威数据、引用和索引

| 数据 | 当前落点与关系 | 后续契约 |
| --- | --- | --- |
| 素材、卡片、产物 | 桌面 `knowflick.db` 的 `materials`、`cards`、`artifacts`。素材保留来源类型、URL、原文、处理文本、媒体引用和收件箱状态；卡片保留来源 `material_id`、学科和 FSRS 等学习字段；产物存生成内容和来源。 | 来源稳定标识与来源版本显式建模；问答、创作与导出保留可校验引用。更新、删除后显示过期或不可用，确认过的内容由用户复核。 |
| 笔记、修订、知识库 | `notes`（含 Markdown 正文、来源、版本、回收站和画像排除属性）、`note_revisions`、`knowledge_bases`、`kb_membership`。标题或正文变化追加修订；仅更改元数据不消耗正文修订。软删保留历史，从索引移除；恢复再入索引。 | 块标识、页面/选段/时间点锚和不便用 Markdown 表示的旁车格式后续设计；不要从普通 upsert 回填历史或将一篇笔记复制给每个库。 |
| 项目、目标、画像 | `projects`、`project_members`、`goals`、`goal_evidence`、`profile_claims`、`profile_denials`。项目可封存，目标可独立或归属项目，画像记录事实/推测/统计与证据。 | 继续完善个人数据治理、引用失效与多用途访问规则；画像排除目前专管画像提案，不等同于笔记对问答、MCP 或所有外部用途私密。 |
| 复习与提醒 | `review_events` 单条事件采用稳定 UUID v4；在桌面事务中随卡片排程一起写，记录项目归属及覆盖起点。按周期查询实际事件；提醒状态独立于复习结果。 | 不用旧累计评分冒充历史事件；项目归属不完整时明示范围或覆盖限制。验证事件重复、不同内容的同 ID、时间边界与跨设备合并。 |
| 连接器状态 | `subscriptions`、`mail_accounts`、`mail_imports`、`mail_rejected`、`mail_sync_state`。同步游标绑定账号、目录、UIDVALIDITY；导入/隔离不是同一个成功态。 | 外部来源任务需幂等、可重试、能区分新条目与旧条目内容变更。恢复的自动轮询有出站效果，说明并验证重新认证。 |
| 附件和原件 | `<库>/media/{audio,ink,image}/...`，数据库保存引用和元数据，文件保存字节。默认库是系统数据根下的 `store/`；macOS 用 Application Support，Windows 用 AppData，Linux 用 XDG 数据目录。 | 未来统一内容寻址、引用核对、校验后原子落盘、延迟垃圾回收。当前 UUID 附件路径或旧 FNV 指纹不能作为全库 SHA-256 去重已经交付的依据。 |
| 兼容文件和设置 | `cards.json` 与轮转备份、`settings.json`、最近搜索、导入报告仍在文件侧；SQLite 是工作台知识记录权威。卡片兼容文件与数据库承担不同角色。 | 不做两份自动双向覆盖的数据源；维护 `cards.json` 学习子集与设置的未知字段兼容、ID 和学科一致性。 |
| 派生数据 | FTS5、`note_chunks`、卡片与笔记切片向量、缩略图/模型缓存；可重新计算。 | 补可观测重建路径与索引覆盖率；把模型/版本、归一化、切片算法、原文版本带入索引身份，确认旧任务不能覆盖新版本。 |
| 凭据与授权 | API Key / WebDAV 应用密码在独立凭据文件（默认 `store` 同级的 `credentials/`）；邮箱密码单独保存在库下凭据目录；MCP 摘要在 SQLite，不存令牌明文。浏览器对话凭据只在当前会话存储。 | 普通包不迁移凭据、MCP 授权/审计。继续评估 OS 凭据库与静态加密；本地文件存储不等于已加密。 |

[笔记实施契约](../../NOTES_MODEL.md)约束修订、软删和恢复；[本地数据与 AI 方案](../LOCAL_DATA_AND_AI.md)中的 `SourceSnapshot`、内容寻址 Blob、变化批次等是后续演进目标，不能当作现有数据库表使用。

### 检索、生成和画像的调用链

1. 保存笔记/素材 → 原件和当前正文落地 → 维护 FTS，按结构构建笔记切片；向量生成可延迟或关闭。没有模型也要能用全文查资料。
2. 问答或创作选择范围 → 先限制可读的笔记及来源卡片、相关产物 → 全文/向量召回与融合 → 组装有来源的上下文。项目范围切换时清理外部范围的历史、草稿和选择，不以 UI 隐藏替代数据库范围过滤。
3. 向用户配置的模型发本次任务最小上下文 → 校验引用 ID 和范围 → 展示资料不足或已知证据，用户可选择保存产物。目标/复盘先陈列事实；AI 建议需要本次同意，不会自动完成目标。
4. 画像提案仅发送本次选择、范围内且未排除的笔记，发送前和写入前再验证版本与归属；模型输出只能成为用户选中的待确认推测。问答使用已确认、未过期、未暂停/否认、未被替代的记忆，且按全局或当前项目分开明确勾选。关闭该模块停止对应流程，保留已有资产。
5. 模型身份现有 `provider/model` 与向量维度约束；切换模型不能混用向量。字符哈希只是词面近似，不能描述为语义理解。专门的仅本地模式、完整模型版本与无缝重建、引用版本审计及真实质量数据仍按规划补齐。

## 对外网络调用

表中服务和协议是仓库当前配置与实现，不代表已验证服务商当前所有模型、鉴权政策或可用性。

| 出口 | 当前调用及返回 | 下一步与边界 |
| --- | --- | --- |
| 网页剪藏 | 桌面 `fetch_clip` 匿名 GET、解码网页，返回 `{text, finalUrl}`；领域层清洗并记录来源。无 Cookie 会话抓取。 | 加强正文、编码、超大/不可读网页与截断处理；登录页、动态页面和付费内容不等同于已接入。 |
| 对话生成 | `completionURL` 从用户填的 Base URL 组成 `/chat/completions`，根路径默认加 `/v1`；POST JSON 传 `model`、`messages`、`max_tokens`、`stream:false` 等，读取助手文本。桌面经 Rust，Web 直接请求且需 CORS。卡片生成、连接探测、问答、复盘建议和画像提案共享传输层，各自校验输出。 | 预设为 DeepSeek、智谱、Kimi、通义千问、硅基流动、OpenAI、Claude、Ollama、自定义；是配置模板。当前 Anthropic 分支设独立请求头并识别其文本响应，但 URL 与请求仍走统一补全格式，原生 Messages 兼容性不能据此认定。后续按适配器验证端点、请求体、模型能力与真实连接。 |
| 向量嵌入 | 桌面可 POST OpenAI 兼容 `/embeddings`（若配置未带版本路径，当前构造函数默认补 `/v1`），发送 `{model,input:[...]}`，读取 `data[].embedding`。实际策略为配置可用的远程 → 已装本地 E5 → 字符哈希，按实际产生向量的身份入索引。 | 需独立的发送策略、仅本地开关、向量数量/维度与索引模型身份回归。生产请求不将失败静默升级为外部调用；Web 不复刻桌面向量能力。 |
| 邮件 | 桌面连接用户选定服务器，IMAP over TLS、`LOGIN`；只读拉取指定邮箱目录并保存为本地素材。手动增量、历史同步、失败隔离和重试分开；运行中的自动同步由用户配置。邮箱地址、目录和应用密码是连接必需输入，密码不由读接口返回。 | OAuth2/XOAUTH2、STARTTLS 路径未实现；服务商预设不证明已连接。验证服务商登录、历史分页、UIDVALIDITY 变更、MIME/超限、重复导入与迁移后重新认证。 |
| 订阅 | RSS/Atom、技术看板和 GitHub Release/趋势；GitHub 走公开 API，Release 请求仓库 releases，趋势使用仓库搜索。客户端解析返回后写素材，轮询时间本地记录。 | 验证真实端点的限流、退避、重复、改版与断网；没有集中后台订阅服务器。带查询参数、片段或凭据地址的备份限制见下。 |
| 语音与模型下载 | Whisper `tiny/base/small` 可选，权重由 Hugging Face 按需下载，完成前使用临时文件；`asr_transcribe` 在本机把音频转换并转写，返回文本、模型与耗时。FastEmbed E5（384 维）缓存于本地，预热可能下载权重。 | 核实模型安装/故障恢复和许可证；实测跨平台麦克风、降噪/长录音、中文质量和保留原件。下载模型和上传用户数据是不同动作。 |
| 自选存储 | 指定目录为本地文件写入；WebDAV 以用户提供地址、用户名与应用密码发 Basic 鉴权 PUT，写版本化 `.kfbackup` 和独立 `.sha256`。 | 真实服务兼容性待验。代码只在 409/412 时换名称，未发条件写头；两个对象分开请求。需要在真实服务和故障注入中确认同名不覆盖、第二步失败的回执及可重试。S3 与其他适配未交付。 |

桌面普通抓取、生成和向量请求统一限制 HTTP(S) 与 URL 内凭据，非本机使用 HTTPS，回环直连；WebDAV 目前单独接受 HTTP(S)，不能把普通抓取限制套到它上面。生成/向量上限与超时见 [Go HTTP](../../../apps/workbench-go/internal/httpx/httpx.go)；Base URL 组装见 [生成端点](../../../apps/workbench/src/domain/ingest.ts)、[模型预设](../../../apps/workbench/src/domain/aiPresets.ts)及[向量适配](../../../apps/workbench/src/domain/embeddingEngine.ts)；WebDAV 重名和两次写入见 [Go 服务实现](../../../apps/workbench-go/internal/webdavbackup)。上述端点、条件写和自选库问题来自代码检查，本轮没有据此声称任何具体服务请求失败或已覆盖远端数据。

有新出口就同步更新[数据出口清单](../../DATA_EGRESS.md)，核对界面错误、日志、剪贴板、导出及请求体；旧清单中的 MCP 配置说明以当前“主动复制一次性配置会携带令牌”为准。备份和静态导出也可能包含私人正文与来源。错误路径优先给结构化、安全的状态与可执行下一步；例如 WebDAV 目前会附带截断的服务端错误正文，接入真实服务前应补响应脱敏与正文回显测试。

## MCP 与项目技能包

主入口 [tools/mcp-server.mjs](../../../tools/mcp-server.mjs) 是随桌面分发的本地 stdio 服务，现有客户端配置以 `node`、脚本绝对路径、`--dir` 当前库路径及环境变量 `KNOWFLICK_MCP_TOKEN` 为核心。用户在设置创建连接后复制一次性配置；需要支持 `node:sqlite` 的 Node 运行时。协议标识以各实现及实际客户端握手为准，不能由脚本存在推断所有客户端兼容。

| 授权 / 入口 | 允许的请求 | 读写边界 |
| --- | --- | --- |
| 主入口，项目授权 | `search_project_notes`；资源模板 `knowflick://notes/{id}`。搜索接收 `{query, limit?}`，返回 id、标题、修订号、摘录和资源 URI；详情返回该版本的标题、正文及截断标记。 | 只读绑定的活跃项目有效成员；客户端参数不能切换项目。不返回附件、内部标签、全库统计、邮箱、画像或非成员信息。查询最多 500 字符、默认 5 项最多 50 项；正文最多 100,000 字符，明确标记截断。 |
| 主入口，全库读取 | `search_knowledge`、`search_materials`、`get_weekly_briefing`、`get_knowledge_stats`；`knowflick://cards`、`knowflick://materials`、`knowflick://materials/{id}`、`knowflick://briefing`。 | 用户单独开启全库读取；检索口径和桌面混合检索不同。 |
| 主入口，全库写权限 | `create_flash_card`（至少 `headline/details`）；`add_material`（至少 `title/text`，可选 `source_url`）。 | 建卡和添素材独立授权；前者写卡库，后者追加收件箱。没有任意覆盖笔记或改授权的工具。后续可优先加强暂存、人工确认和写入回执。 |
| 旧 `tools/knowflick-mcp/server.mjs` | 全库读取授权后提供 `kf_search`、`kf_get_card`、`kf_browse_map`、`kf_learning_path`、`kf_stats`；建卡授权并显式 `--allow-write` 才开放 `kf_stage_card`。 | 读同库 `cards.json`，使用字面 / 中文 N-Gram；写入 `staged_cards.json` 待人工导入，不改活动库。项目令牌不可用；直接 CLI 是本地文件权限操作，和 MCP 授权不同。 |
| TS 嵌入式处理器 | 仅握手和 ping。 | 尚未接入可验证的生产授权，拒绝业务请求；不要将旧的回调接口恢复成旁路。 |

`initialize` 和 `ping` 不返回用户数据；业务请求按模块启用、有效令牌、作用域和操作权限重新核验。项目成员范围与软删除条件先于排序/截断，读不存在或越权使用同样的不可访问响应。授权表存 SHA-256 摘要、策略版本和撤销时间，审计仅记授权 ID、时间、操作与结果，不记令牌、查询或正文。撤销、封存、成员变更提交后影响下一次请求；不能收回已返回内容。旧环境开关和单独的 `--allow-write` 不构成授权。应用级授权不能隔离有系统文件访问权的程序。详见[授权设计](../MCP_SCOPED_ACCESS_DESIGN.md)与[旧入口兼容说明](../../../tools/knowflick-mcp/README.md)。

项目记忆 Markdown 和 Claude Code Skill ZIP 均是用户主动导出的静态副本。技能包当前包含 `SKILL.md`、`context.md`、`sources.json`、`README.md`，保留来源 URI、哈希和导出时点；排除软删成员和凭据，封存项目不可生成。客户端版本不能确认时写明未验证。2026-11-07，macOS 标准配置 release bundle 在隔离 HOME 中通过原生设置页创建项目授权、包内 MCP 接入真实 Codex、项目隔离及撤销；Windows/Linux 安装与连接仍待实机验收，Claude Code 的实际技能加载和引用也未验证。见[验收记录](../ACCEPTANCE_RUN.md)。其它编辑器格式、动态 Skill 与通用应用 API 尚未形成公开承诺。

## 导出、恢复、兼容与同步

| 格式 / 机制 | 用途与兼容 |
| --- | --- |
| Markdown、项目 Markdown、Anki TSV | 人可读或下游工具可用的选取数据；不是全量可逆的库恢复。导出应保留来源，明确遗漏的历史、附件、状态和设置。 |
| `cards.json` / 学习归档 ZIP | 旧卡片/设置交换，保留同一学习 ID 与排程语义；不携带新笔记、项目和完整历史。桌面工作台和 Android 验证旧端读入及未知字段处理。 |
| `.kfbackup` | 版本化 ZIP，`manifest.json` 描述格式、版本、计数、校验与覆盖，附件走允许的库内相对路径；校验发现损坏，不能验证发布者身份。下面列各版本实际资产。 |
| 本地目录 / WebDAV | 携带和人工恢复快照，整包旁有 SHA-256。现有 E2EE 加解密底座有命令和测试，未接上传/恢复 UI；不能把普通 WebDAV 备份称作应用层端到端加密。 |
| Android 旧 LAN v2 | `GET /api/info`、`GET /api/cards`、`POST /api/cards`，`X-KnowFlick-Token` 配对、25 MiB 体积上限。v2 信封含 `protocolVersion`、`cards`、可选墓碑；仍能读 v1 裸数组。旧协议文档中的 Swift 是历史对象，不能当成现工作台已经接通或新笔记同步的依据。 |

| 备份版本 | 新增资产与边界 |
| --- | --- |
| v1–v3 | 兼容历史包；部分旧包没有笔记、知识库或附件。v2 引入笔记和知识库，早期包未承诺附件强校验。 |
| v4 | 活动素材、卡片、设置、产物、笔记、知识库与可读附件基础包；附件 SHA-256。旧包校验能力较弱时，恢复说明实际覆盖。 |
| 桌面 v5 / v6 | v5 引入可用的项目/目标/画像快照；v6 增加实际存在的 `note_revisions.json` 及历史附件，R4 关联原件不可迁移时报告缺口。 |
| 桌面 v7 / v8 | v7 增加 `subscriptions.json`，排除不安全或不支持的地址；v8 增加 `mail.json`，保存账号白名单元数据、游标、导入/隔离与去重记录，不含密码和上次错误原文。 |
| 桌面 v9 / v10 | v9 `review_history.json` 含稳定事件、项目归属与覆盖起点；v10 `search_history.json` 含本地最近搜索，保留本地顺序并在上限内追加去重。 |
| 桌面 v11 | `deleted_records.json` 增加软删素材、卡片、产物及必要媒体；同 ID 冲突、删除时间或引用不符拒绝这一批，恢复保持删除态。笔记删除态仍在 `notes.json`；与安装版回收站证据分开。 |
| 浏览器 v12 | 单独 `profile:"browser"`，基础 v4 数据加 `browser_search_history.json`；并未继承桌面 v5–v11。当前浏览器不能恢复桌面 v5–v11；不支持此 profile 的旧客户端明确拒绝。 |

精确版本和格式见 [备份范围计划](../BACKUP_COMPLETENESS_PLAN.md)与[包解析器](../../../apps/workbench/src/domain/systemBackup.ts)。新版本在前置快照齐备时才产出；读取快照降档、草稿未落库、附件/来源不可读等都应说明。恢复先校验格式、计数、内容、引用，再确认并执行。SQLite 内分事务写；设置、附件和最近搜索与 SQLite 不在同一事务，整体恢复可能部分成功，设置恢复仍可能替换现用设置。相同记录可幂等重放，不同内容的同 ID、旧草稿、本地删除态和已确认的证据须按类型保留或报冲突。应用备份不携带密钥、授权和审计，也不把可重建索引或权重当用户内容。严格验证不能代替空目录、非空目录和真实安装版往返。

后续 R3 的笔记同步需要新协议：每设备独立数据库；传不可变附件、逻辑变化批次与删除墓碑；提供幂等、重试、乱序、部分上传、版本协商和可见冲突副本。禁止多个设备打开同一个实时 SQLite 文件。先验证 WebDAV 真实自建与用户服务，再设计 S3 兼容驱动和移动端只读/保留未知字段；编辑、离线队列、密钥恢复与轮换单独验收。Dropbox/OneDrive/Google Drive 是待评估连接器。参见[旧 LAN 协议](../../SYNC_PROTOCOL.md)、[R3 进度](../R3_PROGRESS.md)和[数据架构规划](../LOCAL_DATA_AND_AI.md)。

## 接口实施与验收要求

| 开发事项 | 交付检查 |
| --- | --- |
| 增改 IPC 或 DTO | 同时更新 Go 服务方法、`wails3 generate bindings` 产出的 TS 类型与 TS 适配；验大小、可空值、大小写、错误、分页、权限和自选库。浏览器模拟不能代替真实宿主径。分块回归覆盖 [Go 笔记服务](../../../apps/workbench-go)的双库与项目隔离，以及 [TS 适配](../../../apps/workbench/src/shell/store.ts)回传资料库和分块修订。 |
| 数据变更与迁移 | 先迁移契约、样本和回退，再加字段/索引；测试旧库、旧包、冲突、软删/恢复、错误中断与真实持久化。共享资产有变更时按仓库规则跑学科和剪藏双端对照。 |
| 检索与权限 | 构造两个相似但不同范围的项目，验证未授权项在排序前剔除；软删/撤销后下次请求失败，空查询、同 ID、索引过期和权限变化不漏数据。对输出来源 URI 做回读。 |
| 网络适配 | 先跑可控回环/模拟服务，再验明确的真实服务组合；检查授权头、发送范围、超时、重试、限流、响应过大、错误脱敏和代理环境。真实邮件/模型与恢复用独立合成数据和数据根分开验证。 |
| 导出/恢复/同步 | 空库、非空库、旧版与新版本、同包重复、损坏、缺附件、同 ID、仅传半包、重新认证及跨设备冲突均有用例。报告真实副作用、跳过项和未运行项。 |
| 运行证据 | 桌面用 `./tools/verify_workbench.sh`、相关模块冒烟和安装包实测；Web 单独检查配额/CORS/多标签；Android 看对应 Gradle/真机门禁。历史证据按运行平台、构建和用例引用，缺凭据、设备或真实服务记为待验。 |
