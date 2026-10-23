# MCP 外部代理接入 · KnowFlick 第二大脑

> 规范来源：[PLUGIN_SPECIFICATION.md §6](PLUGIN_SPECIFICATION.md) · [ADR-0003](adr/0003-desktop-second-brain-architecture.md)
> 实现：`apps/workbench/src/domain/mcpServer.ts`（宿主内嵌协议）· `tools/mcp-server.mjs`（stdio 服务端）

## 1. 这是什么

把 KnowFlick 的本地知识库（Layer 1 素材 / Layer 2 原子卡 / Layer 3 认知产物）作为**统一外部记忆库**暴露给外部 Agent：

| 外部 Agent | 接入方式 |
|---|---|
| Claude Code / Claude Desktop | `mcpServers` 配置指向 `tools/mcp-server.mjs` |
| Cursor | 同上（MCP 设置里加一个 stdio server） |
| DeepSeek Harness | 同上 |

服务端是**纯 Node 脚本**：直接读写 `<data_root>/store/knowflick.db`，不依赖桌面端正在运行，也不需要 Tauri。

## 2. 配置

设置页「MCP 外部代理接入」里点「复制 MCP 配置」拿到这段（路径按你本机仓库位置改）：

```json
{
  "mcpServers": {
    "knowflick": {
      "command": "node",
      "args": ["<仓库绝对路径>/tools/mcp-server.mjs"]
    }
  }
}
```

库目录解析顺序（一般不用设）：

1. `KNOWFLICK_LIBRARY_DIR` — 显式指定库目录（该目录下应有 `knowflick.db`）；
2. 平台默认：macOS `~/Library/Application Support/KnowFlick/store`、Windows `%APPDATA%/KnowFlick/store`、Linux `$XDG_DATA_HOME/KnowFlick/store`。

数据库文件不存在时，服务端会在启动后第一次调用时返回明确的错误文本，而不是静默失败。

## 3. 暴露的能力

### 工具（`tools/list` / `tools/call`）

| 工具 | 参数 | 说明 |
|---|---|---|
| `search_knowledge` | `query`（必填）、`limit`（默认 5，上限 50） | FTS5 全文 + 中文前缀匹配，命中不到时回落 `LIKE`；返回卡片结构化字段 |
| `search_materials` | `query`（必填）、`limit`（默认 5，上限 50） | 检索**素材**（邮件 / 剪藏 / 导入文档 / 语音与手写笔记）；结果带 `resourceUri`，可按它读全文 |
| `create_flash_card` | `headline`、`details`（必填），`summary`、`category`、`tags` | 写入 `cards` 表**并同步 `fts_cards` 全文索引** |
| `add_material` | `title`、`text`（必填），`source_url` | 追加到收件箱（`inbox_status='inbox'`）**并同步 `fts_materials` 索引** |
| `get_weekly_briefing` | — | 三板块 Markdown：本周收录聚类 / 关注趋势演变 / 待温故的旧内容 |
| `get_knowledge_stats` | — | 卡片、收藏、素材、收件箱、认知产物总数与分类分布 |

### 为什么素材检索单列一个工具

`search_knowledge` 只查知识卡，于是外部 Agent 问「上周那封讲 X 的邮件说了什么」**搜不到**——
而用户在应用里是搜得到的（应用走 `db_search_materials_fts`）。同一份知识库、不同的入口
能看到的范围不一样，就不算「统一记忆库」。

`search_materials` 的**判定以当前素材内容为准，不以 FTS 索引为准**：索引可能缺
（旧库升级只补缺失 id）、也可能旧（正文已改写而索引里还是老内容），而 MCP 服务端
**不依赖桌面端启动**——桌面端才会跑 backfill。于是这里直接扫 `materials` 判定命中：
慢一点，但不会漏、不会报旧。多词按「每个词都要出现」判定，与 FTS 的 AND 语义一致。

### 资源（`resources/list` / `resources/read`）

- `knowflick://cards` — 最近 100 张卡片（JSON）
- `knowflick://materials` — 最近 100 份素材（JSON）
- `knowflick://briefing` — 周度认知简报（Markdown）
- `knowflick://materials/{id}` — **单条素材**：正文全文与出处（发件人、附件名等）

`search_materials` 的每条命中都带 `resourceUri`，Agent 据此读回原文——
搜索命中若读不回原文，就只是「看起来相关」。

未知方法 / 未知工具返回标准 JSON-RPC 错误码（`-32601`），参数缺失返回 `-32602`。

## 4. 验证

```sh
node tools/mcp_server_smoke.mjs
```

这个冒烟脚本会：建一个临时库目录 → 灌入一张卡片与四种索引状态的素材 → 用真实 stdio JSON-RPC 驱动 `tools/mcp-server.mjs` → 断言握手、工具清单、FTS5 与中文检索命中 → 调 `create_flash_card` / `add_material` → **重新打开同一个 SQLite 文件**确认卡片、素材与 `fts_cards` 三处都落了 → 断言素材检索在「索引不全 / 索引过期 / 软删除」三种情况下都判对 → 断言命中结果能按 `resourceUri` 读回全文与出处 → 断言简报、资源与错误码。跑完删掉临时目录，不碰 `Application Support` 下的真实库。

素材检索另有 `node tools/mcp_material_search_reverse_test.mjs`：它把 `tools/mcp-server.mjs`
**逐个改回缺陷状态**（只看索引、命中不带地址、写入不建索引、软删除照样命中、多词退化成整句 LIKE），
确认对应断言**会报红**。断言「绿」不等于「在守东西」——这一步把这件事变成可执行的。

宿主内嵌实现（`apps/workbench/src/domain/mcpServer.ts`）另有一份单测，覆盖工具 schema、`initialize` 握手、检索、写入回调、统计、错误码与配置片段生成，以及素材检索与按 id 读回原文。

## 5. 已知边界

- 服务端只做知识库读写，**不**代用户调用大模型；`create_flash_card` 的正文由外部 Agent 自己生成。
- 写入会直接改 SQLite。桌面端主窗口通过 `knowflick:library-changed` 事件刷新，但**外部写入不会触发该事件**——重开窗口或手动刷新列表即可看到。
- 权限声明（`storage:cards:read` 等）目前是清单层面的契约与展示，第三方插件的运行时沙箱按规范排在 M4 之后。
