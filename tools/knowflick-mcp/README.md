# KnowFlick MCP server（本地知识库 → AI Agent）

让 Qoder / Claude Desktop / Cursor 这类支持 MCP 的 Agent 把 KnowFlick 卡库当知识源来查、来补卡。
**零第三方依赖**（使用 Node.js 22.13 或更新版的内置 `node:sqlite`）。

## 接入

先在工作台设置中为该客户端创建**全库授权**：检索需勾选「读取」，暂存需勾选
「建卡」。复制一次性令牌并妥善保管。Claude Desktop / Cursor / Qoder 的 MCP 配置
中使用此令牌；旧配置和单独的 `--allow-write` 不能授予访问：

```json
{ "mcpServers": { "knowflick": { "command": "node", "args": ["/绝对路径/tools/knowflick-mcp/server.mjs", "--cards", "/库目录/cards.json"], "env": { "KNOWFLICK_MCP_TOKEN": "粘贴一次性令牌" } } } }
```

参数：`--cards <path>` 指定 cards.json（默认 `<数据根>/store/cards.json`——两套 App 都写这里，见 [ADR-0002 §3](../../docs/adr/0002-desktop-web-split-from-android.md)；若只有已删除的 mac 端遗留在数据根下的 `cards.json`，也认它）；
`--allow-write` 在已授予建卡权限时额外开启暂存；`--selftest [查询词]` 是不启动
MCP 的本机命令，直接读所选文件。MCP 卡片文件须与授权的 `knowflick.db`、
`settings.json` 同目录；跨目录符号链接被拒绝。首次使用须在工作台保存设置。

## 工具

| 工具 | 作用 |
|---|---|
| `kf_search` | 字面 + 中文 N-Gram 检索（与 App 内 `KnowledgeSearchEngine` 同思路、**不等价**），返回 id/标题/学科/摘要 |
| `kf_get_card` | 按 id 取整卡 |
| `kf_browse_map` | 学科 → 分支 → 难度地图与各片进度（总数/已看/已掌握） |
| `kf_learning_path` | 某学科/分支的学习路径（按 `orderKey` 推进，可只要没学过的） |
| `kf_stats` | 卡库总览与学科分布 |
| `kf_stage_card` | 新卡进**暂存队列**（需 `--allow-write`） |

## 命令行入口（零配置）

同一个 `lib.mjs` 也提供 CLI 给不能连 MCP 的场合（其它 Agent、CI、脚本、人手工查）：

```bash
node tools/knowflick-mcp/kf.mjs map
node tools/knowflick-mcp/kf.mjs search 复利 --limit 5
node tools/knowflick-mcp/kf.mjs get <id 或 标题片段> [--full]
node tools/knowflick-mcp/kf.mjs path accounting --branch assets --unseen
node tools/knowflick-mcp/kf.mjs stage --card '{"headline":"…","summary":"…","details":"…","subject":"accounting"}'
node tools/knowflick-mcp/kf.mjs staged
```

默认输出给模型读的紧凑文本（摘要 96 字、正文 1200 字截断），`--json` 出原始结构。
**CLI 与 MCP 的结果由 `test.mjs` 断言逐条一致**（含顺序与 score），所以不存在"Agent 查到的和人查到的不同"。

配套的 Qoder Skill 在 `.qoder/skills/knowflick-kb/SKILL.md`：它规定工作流（先 `map` 建地形 → `search` → 引用前必须 `get` 全文并带 id → 沉淀走 `stage` 且明确告知用户还要在 App 里确认）。

## 安全边界（重要）

- **逐连接授权**：无令牌、项目令牌、撤销后的令牌或模块停用时均拒绝 MCP 数据请求；
  全库读取与建卡分别授权。`--allow-write` 只是暂存的第二道开关。
- 写回**不碰卡库**：新卡追加到同目录 `staged_cards.json`。该文件刻意与 `cards.json` 同构，
  所以直接就能用 App 的「导入归档数据」人工确认入库——不需要改 App，也不存在 Agent 静默改库。
- 队列内按标题归一去重；非法学科/分支/难度（不在 `shared/assets/taxonomy_map.json` 契约里）直接拒绝。
- 单文件读取上限 64 MiB；不打印卡片正文到日志。
- 暂存文件和 SQLite 审计不是一个原子事务：写入前先记录不含正文的操作意图；
  若文件写入后数据库提交失败，回执提示可能已暂存，应检查队列。直接 CLI 与
  有系统文件权限的程序不受 MCP 令牌限制。

## 长连接刷新与暂存可靠性

- 每次 MCP 工具调用前检查卡库与学科契约文件版本（文件身份、大小、纳秒时间戳）。没有变化时复用快照与搜索索引；变化时重新加载，支持 App 的原子替换写入。无后台轮询。
- 卡库正在写入、损坏或被移走时，工具明确返回错误；不会把旧快照当作当前结果。修复文件后，下次调用自动重试。
- CLI 与 MCP 暂存共用同目录 `.lock` 文件，锁覆盖读取、标题去重、追加与写回。竞争最多等待 2 秒，仍占用则报错；当前同步实现会在等待期间阻塞该进程的后续请求。
- 新队列先写入同目录唯一临时文件并 `fsync`，再原子替换。正常异常路径清理临时文件与锁，写入失败保留原队列；队列输出同样限制为 64 MiB。
- 写入进程被强制结束可能留下 `staged_cards.json.lock` 和临时文件。不会按锁龄自动抢锁，以免打断仍在工作的写者。确认所有暂存写入进程都已停止后，移除该锁再重试；残留 `.tmp` 不会被当作正式队列读取。此保护针对遵循锁协议的本地 CLI/MCP 写者，不覆盖外部编辑器，也不承诺断电后的文件系统持久性。

## 已知边界

- 检索是字面/词频口径，**没有语义向量**（那是 P4：一次性云端编码 + 端侧点积，见
  `docs/KNOWLEDGE_SYSTEM_ROADMAP_2026-09.md` §6）。
- 只覆盖本机数据目录；手机上的库要先经局域网同步到本机，或用 App 导出后拷过来。
- 协议按 2025-06-18/2025-11-25 代际实现（`initialize` + `tools/*`）。MCP 2026-07-28 起取消握手，
  官方 SDK 也还在跟进；实测客户端（Qoder/Claude/Cursor）接受这一代际，若将来握手失败再补 `server/discover`。

## 自测

```bash
node --test tools/knowflick-mcp/test.mjs        # 23 项：检索、CLI/协议、实时刷新、并发暂存、故障保留与测试传输
node tools/knowflick-mcp/server.mjs --selftest "存货跌价准备"
```
