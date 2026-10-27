# 数据模型规范 · AI 个人第二大脑（SQLite DDL 与同步契约）

> 状态：**已定稿（2026-10-18）**
> 适用：`apps/workbench`（Tauri 2 + SQLite）及后续辐射的 Android / Web 端。
> 关联： [ADR-0003](adr/0003-desktop-second-brain-architecture.md) · [PRODUCT_REDIRECT_2026-10-18.md](PRODUCT_REDIRECT_2026-10-18.md)

---

## 1. 架构总览：三层数据资产模型

```
┌──────────────────────────────────────────────────────────────┐
│ Layer 1: 原始素材（Raw Materials）                           │
│ • 网页剪藏 HTML/正文、文档文本、图片 OCR 文本、语音转写文本   │
│ • 职责：原始凭证、不可逆证据链、可重新提炼、按来源保留原件    │
└──────────────────────────────┬───────────────────────────────┘
                               │ AI 提炼 / 人工摘录
                               ▼
┌──────────────────────────────────────────────────────────────┐
│ Layer 2: 原子知识卡（Atomic Knowledge Cards）                 │
│ • 独立提炼观点、标签体系、来源锚点、FSRS 记忆参数             │
│ • 职责：核心资产库、第二大脑检索基底、温故复习实体            │
└──────────────────────────────┬───────────────────────────────┘
                               │ 聚类分析 / 时间窗口聚合 / 问答派生
                               ▼
┌──────────────────────────────────────────────────────────────┐
│ Layer 3: 认知产物（Derived Artifacts）                       │
│ • 每周简报（3 模块）、主题综述报告、复杂问答深度对话记录      │
│ • 职责：知识内化沉淀、行动建议输出、趋势洞察                  │
└──────────────────────────────────────────────────────────────┘
```

---

## 2. 数据库设计（SQLite DDL）

数据库单文件位置：`$DATA_DIR/knowflick.db`（开启 WAL 模式保证并发读写不卡顿）。

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA synchronous = NORMAL;

-- ============================================================
-- 1. 原始素材表（Layer 1: Materials）
-- ============================================================
CREATE TABLE IF NOT EXISTS materials (
    id                  TEXT PRIMARY KEY,              -- UUID v4
    source_type         TEXT NOT NULL,                 -- 'web', 'note', 'document', 'audio', 'image', 'manual'
    title               TEXT NOT NULL,                 -- 网页标题 / 文件名 / 灵感前缀
    source_url          TEXT,                          -- 原始链接（如有）
    raw_text            TEXT NOT NULL,                 -- 纯文本全文 / OCR 识别结果 / 语音转写
    cleaned_markdown    TEXT,                          -- 经清洗的 Markdown（如有）
    content_hash        TEXT NOT NULL,                 -- SHA-256 哈希，用于去重
    media_path          TEXT,                          -- 本地存储的大媒体路径（图片/录音原件，按策略选存）
    media_size_bytes    INTEGER DEFAULT 0,             -- 媒体原件大小
    metadata_json       TEXT NOT NULL DEFAULT '{}',    -- 拓展字段（网页 meta, 作者, 视频时长等）
    inbox_status        TEXT NOT NULL DEFAULT 'inbox', -- 'inbox' (待整理), 'processed' (已提炼), 'dismissed' (略过)
    created_at          INTEGER NOT NULL,              -- 毫秒时间戳
    updated_at          INTEGER NOT NULL,              -- 毫秒时间戳
    version             INTEGER NOT NULL DEFAULT 1,    -- 乐观锁版本号
    is_deleted          INTEGER NOT NULL DEFAULT 0,    -- 逻辑删除墓碑（0=正常, 1=已删）
    deleted_at          INTEGER                        -- 删除时间戳
);

CREATE INDEX IF NOT EXISTS idx_materials_hash ON materials(content_hash);
CREATE INDEX IF NOT EXISTS idx_materials_inbox ON materials(inbox_status, is_deleted);
CREATE INDEX IF NOT EXISTS idx_materials_created ON materials(created_at DESC);

-- ============================================================
-- 2. 原子知识卡表（Layer 2: Cards）
-- 完全兼容旧版 27 字段，升级为 SQLite 行存储并增强同步属性
-- ============================================================
CREATE TABLE IF NOT EXISTS cards (
    id                  TEXT PRIMARY KEY,              -- UUID v4
    material_id         TEXT REFERENCES materials(id) ON DELETE SET NULL, -- 溯源外键
    category            TEXT NOT NULL DEFAULT '未分类', -- 一级分类展示名
    headline            TEXT NOT NULL,                 -- 标题（≤100字）
    summary             TEXT NOT NULL,                 -- 摘要（≤300字）
    details             TEXT NOT NULL,                 -- 核心正文（Markdown，建议≥80字）
    links_json          TEXT NOT NULL DEFAULT '[]',    -- 科学链接数组 [{"title":"","url":""}]
    tags_json           TEXT NOT NULL DEFAULT '[]',    -- 标签数组 ["AI", "RAG", "架构"]
    source              TEXT NOT NULL DEFAULT 'imported', -- 'ai', 'imported', 'seed'
    
    -- 浏览与收藏
    seen_at             INTEGER,                       -- 首次浏览时间戳
    swiped              TEXT,                          -- 'left', 'right', 'skip'
    is_favorite         INTEGER NOT NULL DEFAULT 0,    -- 1=收藏, 0=未收藏
    favorited_at        INTEGER,                       -- 收藏时间戳
    
    -- 间隔复习与算法（兼容 SM-2 与 FSRS）
    review_count        INTEGER NOT NULL DEFAULT 0,
    mastery_level       INTEGER NOT NULL DEFAULT 0,
    last_reviewed_at    INTEGER,
    repetition          INTEGER NOT NULL DEFAULT 0,
    interval_days       REAL NOT NULL DEFAULT 0.0,
    ease_factor         REAL NOT NULL DEFAULT 2.5,
    stability           REAL NOT NULL DEFAULT 0.0,
    difficulty          REAL NOT NULL DEFAULT 0.0,
    
    -- 学科树扩展（契约字段）
    subject             TEXT,
    branch              TEXT,
    level               INTEGER,
    track               TEXT,
    order_key           TEXT,
    prereq_json         TEXT NOT NULL DEFAULT '[]',
    
    -- 同步与审计
    created_at          INTEGER NOT NULL,
    updated_at          INTEGER NOT NULL,
    version             INTEGER NOT NULL DEFAULT 1,
    is_deleted          INTEGER NOT NULL DEFAULT 0,
    deleted_at          INTEGER
);

CREATE INDEX IF NOT EXISTS idx_cards_material ON cards(material_id);
CREATE INDEX IF NOT EXISTS idx_cards_category ON cards(category, is_deleted);
CREATE INDEX IF NOT EXISTS idx_cards_favorite ON cards(is_favorite, is_deleted);
CREATE INDEX IF NOT EXISTS idx_cards_due ON cards(last_reviewed_at, interval_days, is_deleted);
CREATE INDEX IF NOT EXISTS idx_cards_updated ON cards(updated_at DESC);

-- ============================================================
-- 3. 认知产物表（Layer 3: Artifacts）
-- ============================================================
CREATE TABLE IF NOT EXISTS artifacts (
    id                  TEXT PRIMARY KEY,              -- UUID v4
    artifact_type       TEXT NOT NULL,                 -- 'weekly_briefing', 'topic_synthesis', 'deep_chat'
    title               TEXT NOT NULL,                 -- 标题（如 "2026年第42周知识洞察简报"）
    content_markdown    TEXT NOT NULL,                 -- 结构化产物 Markdown
    source_card_ids     TEXT NOT NULL DEFAULT '[]',    -- 关联的卡片 id 数组
    date_scope_start    INTEGER,                       -- 周期起始
    date_scope_end      INTEGER,                       -- 周期结束
    created_at          INTEGER NOT NULL,
    updated_at          INTEGER NOT NULL,
    is_deleted          INTEGER NOT NULL DEFAULT 0
);

-- ============================================================
-- 4. 订阅源表（Subscriptions - 主动收集）
-- ============================================================
CREATE TABLE IF NOT EXISTS subscriptions (
    id                  TEXT PRIMARY KEY,
    type                TEXT NOT NULL,                 -- 'rss', 'github_release', 'github_trending', 'tech_board'
    title               TEXT NOT NULL,
    target_url          TEXT NOT NULL,                 -- RSS feed URL / github owner/repo / 社区 API
    interval_minutes    INTEGER NOT NULL DEFAULT 360,  -- 轮询间隔（分钟）
    last_polled_at      INTEGER,                       -- 上次轮询时间
    is_active           INTEGER NOT NULL DEFAULT 1,
    created_at          INTEGER NOT NULL
);

-- ============================================================
-- 5. 全文搜索虚拟表（FTS5 - 中文分词前置）
-- 存储分词后的 token 序列与卡片 ID 映射
-- ============================================================
CREATE VIRTUAL TABLE IF NOT EXISTS fts_cards USING fts5(
    card_id UNINDEXED,
    segmented_headline,
    segmented_summary,
    segmented_details,
    tags,
    category,
    tokenize = 'unicode61 remove_diacritics 2'
);

-- ============================================================
-- 6. 语义向量虚拟表（sqlite-vec 扩展）
-- 默认支持 1024 维（Qwen3-Embedding / bge-m3）或 512 维
-- ============================================================
-- 语法依据 sqlite-vec v0.1.x：
-- CREATE VIRTUAL TABLE IF NOT EXISTS vec_cards USING vec0(
--     card_id TEXT PRIMARY KEY,
--     embedding float[1024] distance_metric=cosine
-- );
```

---

## 3. 同步预留机制与冲突合并契约（LWW-CRDT）

本阶段不实现网络同步，但所有表结构已预留多端同步必需的最小完备字段：

1. **全局主键**：必须使用标准的 UUID v4 字符串（如 `f47ac10b-58cc-4372-a567-0e02b2c3d479`），杜绝自增 ID 在多端产生的冲突。
2. **时间戳规范**：一律以 `UTC Epoch Milliseconds`（毫秒整数）存储，避免本地时区序列化歧义。
3. **逻辑删除墓碑（Tombstones）**：
   - 删除操作绝不直接执行 `DELETE FROM`，而是将 `is_deleted = 1`，并记入 `deleted_at = now()`，`version = version + 1`；
   - 保证未来多设备增量拉取（`WHERE updated_at > last_sync_time`）时，能够向其他端可靠传播删除意图。
4. **最后写入优先与字段级合并（Last-Write-Wins Merge Rule）**：
   - 继承自既有 `apps/workbench/src/domain/archive.ts` 经过单测验证的合并规则：
     - 若 `id` 相同，比较 `updated_at`；新者覆盖旧者；
     - `details`：若版本时间戳相同，以较长内容优先；
     - `is_favorite`：取逻辑**或**（只要任意一端收藏即算收藏）；
     - `review_count`：取两者中较大者；
     - `FSRS` 参数：以 `last_reviewed_at` 最新的那一组参数整组覆盖。

---

## 4. 旧版 `cards.json` 数据无损迁移映射

启动时检测到旧 `$DATA_DIR/cards.json` 且数据库为空时，自动执行一键迁移：

| 旧 cards.json 字段 | SQLite `cards` 目标列 | 转换与填充规则 |
|---|---|---|
| `id` | `id` | 原样保留 |
| `category` | `category` | 空值兜底为 `"未分类"` |
| `headline` | `headline` | 原样保留 |
| `summary` | `summary` | 原样保留 |
| `details` | `details` | 原样保留；同时根据 details 内容生成一条对应的虚拟 `materials` 记录并关联 `material_id` |
| `links` | `links_json` | `JSON.stringify(links)` |
| `source` | `source` | 原样保留 |
| `createdAt` | `created_at` | 原样保留 |
| `editedAt` | `updated_at` | 若无则取 `createdAt` |
| `seenAt` | `seen_at` | 原样保留 |
| `swiped` | `swiped` | 原样保留 |
| `isFavorite` | `is_favorite` | `isFavorite ? 1 : 0` |
| `favoritedAt` | `favorited_at` | 原样保留 |
| `reviewCount` | `review_count` | 原样保留 |
| `masteryLevel` | `mastery_level`| 原样保留 |
| `lastReviewedAt` | `last_reviewed_at` | 原样保留 |
| `repetition` | `repetition` | 原样保留 |
| `intervalDays` | `interval_days`| 原样保留 |
| `easeFactor` | `ease_factor` | 原样保留 |
| `stability` | `stability` | 原样保留 |
| `difficulty` | `difficulty` | 原样保留 |
| *(新字段)* | `tags_json` | 默认根据 `category` 初始化为单标签数组 |
| *(新字段)* | `version` | 初始置为 `1` |
| *(新字段)* | `is_deleted` | 初始置为 `0` |

---

## 5. 开放导出格式规范（用户数据主权）

为兑现「用户把数据托付给软件，必须随时能无损搬走」的承诺，系统提供两种导出格式：

### 5.1 Markdown + 附件目录包（人类可读，对标 Obsidian / Logseq）

导出一个 `.zip` 压缩包，解压后目录结构如下：

```
MyKnowledgeBrain/
├── cards/
│   ├── AI/
│   │   ├── 2026-10-18-RAG混合检索实测.md
│   │   └── 2026-10-18-OpenViking架构拆解.md
│   └── 商业财会/
│       └── 2026-09-08-新租赁准则变化.md
├── materials/
│   └── web-clips/
│       └── 2026-10-18-OpenViking-Docs.md
├── artifacts/
│   └── briefings/
│       └── 2026-W42-每周洞察简报.md
└── attachments/
    └── images/
        └── 2026-10-18-架构图.webp
```

每张 Card Markdown 文件格式标准：
```markdown
---
id: "f47ac10b-58cc-4372-a567-0e02b2c3d479"
category: "AI"
headline: "RAG混合检索实测"
tags: ["AI", "RAG", "向量搜索"]
source: "imported"
created_at: "2026-10-18T23:00:00Z"
is_favorite: true
review_count: 3
interval_days: 6.5
source_url: "https://example.com/article"
---

# RAG混合检索实测

> **摘要**：在 1 万条条目内，SQLite-vec 暴力余弦扫描耗时仅 12ms，无需引入重型 ANN 索引。

## 核心内容

正文 Markdown 内容...

## 拓展链接
- [官方文档](https://example.com)
```

### 5.2 完整无损备份包（系统级恢复）

- 格式：单个 `.kfbackup`（标准 ZIP 文件）；
- 内容：
  - `knowflick.db`：完整的 SQLite 原生数据库文件；
  - `settings.json`：软件设置与偏好；
  - `manifest.json`：备份元数据（版本、导出时间、设备信息、条目统计、SHA-256 校验和）。
- 保证导出包通过自动化测试能够**逐字段 100% 往返还原**。
