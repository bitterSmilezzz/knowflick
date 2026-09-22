---
name: knowflick-kb
description: 查询并向 KnowFlick 本地知识卡库取数据与沉淀知识。当用户说"我以前学过/我记得有张卡关于/在知识库里查/把这个结论收进知识库/学习路径/学科进度/星图上有关系吗"，或要求引用已学知识、总结某个学科、沉淀洞见、剪藏网页结论时启用。也用于 Agent 把 KnowFlick 当作知识库读写边界内操作。
---

# KnowFlick 本地知识库

## Overview

KnowFlick 的卡库是一个本地 JSON 文件（`~/Library/Application Support/KnowFlick/cards.json`）。
本 Skill 用零依赖 CLI 读写它：**读直接读，写一律先进暂存队列**，进正式卡库必须用户在 App 里点确认。

## 唯一入口

在仓库根执行（零依赖，只要有 Node）：

```sh
node tools/knowflick-mcp/kf.mjs <命令> [参数] [选项]
```

| 命令 | 用途 |
|---|---|
| `map` | 学科 → 分支 → 难度的分布与进度。**先看这个**，别凭猜搜索 |
| `stats` | 卡库总量、已看/已掌握/未分级数量 |
| `search <关键词>` | 检索（`--limit N`，默认 8）。返回 id + 标题 + 摘要 |
| `get <id 或 标题片段>` | 取一张卡全文（正文默认截 1200 字，`--full` 看全部） |
| `path <学科>` | 按 `orderKey` 取学习路径（`--branch` / `--level 1..5` / `--unseen` / `--limit`） |
| `stage --card '<json>'` | 暂存一张待确认卡片 |
| `staged` | 查看暂存队列 |

全局选项：`--cards <path>`、`--app-dir <dir>`（测试或换库时用）、`--json`（要原始结构时）。

## 标准工作流

1. **建立地形感**：`map`（或 `stats`）。用户问"我在学什么/还有什么没看"时，这两个命令就能回答，不需要检索。
2. **检索再取全文**：`search` 只给摘要。**要引用具体论断必须先 `get` 拿到 details**，不要拿摘要当结论复述。
3. **引用要带 id**：回答里标注卡片 id（或标题），用户能在 App 里一键定位。这是"引用已学知识"和"编得像已学知识"的唯一区别。
4. **路径类问题用 `path`**：顺序由导入时的 `orderKey` 决定，别自己按标题排序或"由浅入深"地重排。
5. **沉淀洞见走 `stage`**：必填 `headline` / `summary` / `details`；可选 `category` / `subject` / `branch` / `level` / `track` / `links`。学科 slug 必须来自 `map` 的输出，写错会被拒绝（拒绝信息是中文且具体，照它改，别绕）。

```sh
node tools/knowflick-mcp/kf.mjs stage --card '{"headline":"…","summary":"…","details":"…","subject":"accounting","level":2}'
```

## 硬边界

- **绝不直接改 `cards.json`**。里面是用户的学习记录（浏览时间、收藏、复习间隔、熟练度），改一次就毁一次进度。写操作只有 `stage` 这一条路。
- `stage` 之后**必须告诉用户**：去 App「知识库 → 导入归档数据」确认，卡片才会进卡库。不要宣称"已收录"。
- 卡库文件不存在时（新机器）不要报错了事：说明库里还没有内容，建议先在 App 里生成/导入，或用 `--cards` 指定路径。
- 这里没有任何密钥；AI 服务的 key 在 Keychain / 加密偏好里，不要试图读取或写入。

## 与 MCP 的关系

`kf.mjs` 与 `server.mjs`（stdio MCP server）共用 `lib.mjs`，**同一套排序、同一套学科派生、同一个暂存收口**，所以 Agent 用哪条路查到的结果一致。

- 客户端支持 MCP 时优先用 MCP 工具：`kf_search` / `kf_get_card` / `kf_browse_map` / `kf_learning_path` / `kf_stats` / `kf_stage_card`。注册：`qoder mcp add knowflick -- node <repo>/tools/knowflick-mcp/server.mjs --allow-write`（不加 `--allow-write` 时写回被拒，只读）。
- 零配置场景（其它 Agent、CI、脚本、用户没注册 MCP）用本 CLI。
- 参数名两边一致：MCP 的 `args.limit` ↔ CLI 的 `--limit`，MCP 的 `kf_stage_card` ↔ CLI 的 `stage --card`。

## Resources

- `tools/knowflick-mcp/kf.mjs` — CLI 入口（本 Skill 的主命令）
- `tools/knowflick-mcp/server.mjs` — stdio MCP server
- `tools/knowflick-mcp/lib.mjs` — 唯一的逻辑层（检索打分、学科派生、暂存校验都在这里）
- `tools/knowflick-mcp/test.mjs` — 协议往返测试；改 lib 后跑 `node tools/knowflick-mcp/test.mjs`
- `docs/KNOWLEDGE_SYSTEM_ROADMAP_2026-09.md` §7 — 为什么选 stdio、上云边界怎么划
