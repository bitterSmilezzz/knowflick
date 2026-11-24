package library

import (
	"context"
	"database/sql"
	"knowflick.local/workbench-go/internal/errtext"
	"os"
	"path/filepath"
	"time"
)

// SchemaSQL 是资料库的完整表结构，逐字移植自 Rust `db.rs::init_tables` 的
// `execute_batch` 文本（ADR-0042：Rust 后端移除后，建库与迁移改由 Go 持有）。
//
// 为什么保留原样的注释与表顺序：这份 DDL 是**已有用户库**的唯一权威描述，
// 迁移只在库上幂等执行。改表必须同时想清楚老库（见 ensureSchema 的列补齐），
// 不要把它当成「随便可以重排的建表脚本」。
const SchemaSQL = `
        CREATE TABLE IF NOT EXISTS meta (
            key                 TEXT PRIMARY KEY,
            value               TEXT NOT NULL
        );

        -- 逐次复习事实（R4/D09）。旧 review_count 只保留累计状态，不补造历史事件。
        -- 不设卡片外键：删除卡片不应抹掉已经发生的学习事件。
        CREATE TABLE IF NOT EXISTS review_events (
            event_id                    TEXT PRIMARY KEY,
            card_id                     TEXT NOT NULL,
            reviewed_at                 INTEGER NOT NULL CHECK (reviewed_at >= 0),
            rating                      TEXT NOT NULL CHECK (rating IN ('again','hard','good','easy')),
            algorithm                   TEXT NOT NULL CHECK (algorithm IN ('sm2','fsrs')),
            project_ids_json            TEXT NOT NULL DEFAULT '[]',
            project_attribution_complete INTEGER NOT NULL CHECK (project_attribution_complete IN (0,1))
        );
        CREATE INDEX IF NOT EXISTS idx_review_events_time ON review_events(reviewed_at,event_id);
        CREATE INDEX IF NOT EXISTS idx_review_events_card ON review_events(card_id,reviewed_at);

        CREATE TABLE IF NOT EXISTS materials (
            id                  TEXT PRIMARY KEY,
            source_type         TEXT NOT NULL,
            title               TEXT NOT NULL,
            source_url          TEXT,
            raw_text            TEXT NOT NULL,
            cleaned_markdown    TEXT,
            content_hash        TEXT NOT NULL,
            media_path          TEXT,
            media_size_bytes    INTEGER DEFAULT 0,
            metadata_json       TEXT NOT NULL DEFAULT '{}',
            inbox_status        TEXT NOT NULL DEFAULT 'inbox',
            created_at          INTEGER NOT NULL,
            updated_at          INTEGER NOT NULL,
            version             INTEGER NOT NULL DEFAULT 1,
            is_deleted          INTEGER NOT NULL DEFAULT 0,
            deleted_at          INTEGER
        );

        CREATE INDEX IF NOT EXISTS idx_materials_hash ON materials(content_hash);
        CREATE INDEX IF NOT EXISTS idx_materials_inbox ON materials(inbox_status, is_deleted);
        CREATE INDEX IF NOT EXISTS idx_materials_created ON materials(created_at DESC);

        CREATE TABLE IF NOT EXISTS cards (
            id                  TEXT PRIMARY KEY,
            material_id         TEXT REFERENCES materials(id) ON DELETE SET NULL,
            category            TEXT NOT NULL DEFAULT '未分类',
            headline            TEXT NOT NULL,
            summary             TEXT NOT NULL,
            details             TEXT NOT NULL,
            links_json          TEXT NOT NULL DEFAULT '[]',
            tags_json           TEXT NOT NULL DEFAULT '[]',
            source              TEXT NOT NULL DEFAULT 'imported',
            seen_at             INTEGER,
            swiped              TEXT,
            is_favorite         INTEGER NOT NULL DEFAULT 0,
            favorited_at        INTEGER,
            review_count        INTEGER NOT NULL DEFAULT 0,
            mastery_level       INTEGER NOT NULL DEFAULT 0,
            last_reviewed_at    INTEGER,
            repetition          INTEGER NOT NULL DEFAULT 0,
            interval_days       REAL NOT NULL DEFAULT 0.0,
            ease_factor         REAL NOT NULL DEFAULT 2.5,
            stability           REAL NOT NULL DEFAULT 0.0,
            difficulty          REAL NOT NULL DEFAULT 0.0,
            subject             TEXT,
            branch              TEXT,
            level               INTEGER,
            track               TEXT,
            order_key           TEXT,
            prereq_json         TEXT NOT NULL DEFAULT '[]',
            created_at          INTEGER NOT NULL,
            edited_at           INTEGER,
            updated_at          INTEGER NOT NULL,
            version             INTEGER NOT NULL DEFAULT 1,
            is_deleted          INTEGER NOT NULL DEFAULT 0,
            deleted_at          INTEGER
        );

        CREATE INDEX IF NOT EXISTS idx_cards_material ON cards(material_id);
        CREATE INDEX IF NOT EXISTS idx_cards_category ON cards(category, is_deleted);
        CREATE INDEX IF NOT EXISTS idx_cards_favorite ON cards(is_favorite, is_deleted);
        CREATE INDEX IF NOT EXISTS idx_cards_updated ON cards(updated_at DESC);

        CREATE VIRTUAL TABLE IF NOT EXISTS fts_cards USING fts5(
            card_id UNINDEXED,
            headline,
            summary,
            details,
            category,
            tags,
            tokenize = 'unicode61 remove_diacritics 2'
        );

        CREATE VIRTUAL TABLE IF NOT EXISTS fts_materials USING fts5(
            material_id UNINDEXED,
            title,
            raw_text,
            source_url,
            tokenize = 'unicode61 remove_diacritics 2'
        );

        CREATE TABLE IF NOT EXISTS artifacts (
            id                  TEXT PRIMARY KEY,
            artifact_type       TEXT NOT NULL,
            title               TEXT NOT NULL,
            content_markdown    TEXT NOT NULL,
            source_card_ids     TEXT NOT NULL DEFAULT '[]',
            -- R4/D07 创作草稿的证据可能来自笔记（不只是卡片）——单列分开，
            -- 免得产物视图把笔记 id 当成卡片 id 去找（找不到就显示「已删除的卡片」）。
            source_note_ids     TEXT NOT NULL DEFAULT '[]',
            date_scope_start    INTEGER,
            date_scope_end      INTEGER,
            created_at          INTEGER NOT NULL,
            updated_at          INTEGER NOT NULL,
            is_deleted          INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS card_embeddings (
            card_id             TEXT PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
            dim                 INTEGER NOT NULL,
            embedding           BLOB NOT NULL,
            updated_at          INTEGER NOT NULL,
            -- 向量空间身份（R2 版本化）：只比同 (provider, model, dim) 的向量。
            -- 旧库无这两列，由下方 ALTER 平滑补齐（默认 '' 表示未知来源，
            -- 换模型后按「过期」重算，不与已知身份混算）。
            provider            TEXT NOT NULL DEFAULT '',
            model               TEXT NOT NULL DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS subscriptions (
            id                  TEXT PRIMARY KEY,
            type                TEXT NOT NULL,
            title               TEXT NOT NULL,
            target_url          TEXT NOT NULL,
            interval_minutes    INTEGER NOT NULL DEFAULT 360,
            last_polled_at      INTEGER,
            is_active           INTEGER NOT NULL DEFAULT 1,
            created_at          INTEGER NOT NULL
        );

        -- 笔记与知识库（R1，契约见 docs/NOTES_MODEL.md）：全部增量添加，
        -- 既有 materials/cards 不动，老库打开即得新表。
        CREATE TABLE IF NOT EXISTS notes (
            id                  TEXT PRIMARY KEY,
            title               TEXT NOT NULL DEFAULT '',
            body_md             TEXT NOT NULL DEFAULT '',
            notebook            TEXT,
            tags_json           TEXT NOT NULL DEFAULT '[]',
            is_pinned           INTEGER NOT NULL DEFAULT 0,
            is_favorite         INTEGER NOT NULL DEFAULT 0,
            archived_at         INTEGER,
            source_material_id  TEXT REFERENCES materials(id) ON DELETE SET NULL,
            current_revision    INTEGER NOT NULL DEFAULT 1,
            created_at          INTEGER NOT NULL,
            updated_at          INTEGER NOT NULL,
            is_deleted          INTEGER NOT NULL DEFAULT 0,
            deleted_at          INTEGER,
            exclude_from_profile INTEGER NOT NULL DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes(updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_notes_deleted ON notes(is_deleted, deleted_at);

        CREATE TABLE IF NOT EXISTS note_revisions (
            note_id             TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
            revision            INTEGER NOT NULL,
            title               TEXT NOT NULL DEFAULT '',
            body_md             TEXT NOT NULL DEFAULT '',
            saved_at            INTEGER NOT NULL,
            PRIMARY KEY (note_id, revision)
        );

        CREATE TABLE IF NOT EXISTS knowledge_bases (
            id                  TEXT PRIMARY KEY,
            name                TEXT NOT NULL,
            description         TEXT NOT NULL DEFAULT '',
            created_at          INTEGER NOT NULL,
            updated_at          INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS kb_membership (
            kb_id               TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
            note_id             TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
            added_at            INTEGER NOT NULL,
            PRIMARY KEY (kb_id, note_id)
        );

        CREATE VIRTUAL TABLE IF NOT EXISTS fts_notes USING fts5(
            note_id UNINDEXED,
            title,
            body,
            tokenize = 'unicode61 remove_diacritics 2'
        );

        -- 笔记正文分块（R2）：检索命中可以按块回原件（char_start/char_end）。
        -- content_revision 与 note_revisions 的修订号对齐——过期分块不写回索引。
        CREATE TABLE IF NOT EXISTS note_chunks (
            note_id            TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
            chunk_index        INTEGER NOT NULL,
            content            TEXT NOT NULL,
            char_start         INTEGER NOT NULL,
            char_end           INTEGER NOT NULL,
            content_revision   INTEGER NOT NULL,
            PRIMARY KEY (note_id, chunk_index)
        );

        CREATE VIRTUAL TABLE IF NOT EXISTS fts_note_chunks USING fts5(
            note_id UNINDEXED,
            chunk_index UNINDEXED,
            content,
            tokenize = 'unicode61 remove_diacritics 2'
        );

        -- 分块向量（R2 向量化分块）：语义召回按块，身份三元组 + content_revision
        -- 防「过期嵌入写回索引」（LOCAL_DATA_AND_AI：索引任务携带目标修订号）。
        CREATE TABLE IF NOT EXISTS note_chunk_embeddings (
            note_id            TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
            chunk_index        INTEGER NOT NULL,
            dim                INTEGER NOT NULL,
            embedding          BLOB NOT NULL,
            provider           TEXT NOT NULL DEFAULT '',
            model              TEXT NOT NULL DEFAULT '',
            content_revision   INTEGER NOT NULL,
            updated_at         INTEGER NOT NULL,
            PRIMARY KEY (note_id, chunk_index)
        );

        -- 项目记忆（R4/D06 最小闭环）：项目 = 背景/决策/约束/未决问题的
        -- 容器，成员引用现有笔记（不复制正文）；archived_at 有值 = 封存，
        -- 封存的项目不再污染其它项目上下文（导出与检索都跳过）。
        CREATE TABLE IF NOT EXISTS projects (
            id                  TEXT PRIMARY KEY,
            name                TEXT NOT NULL,
            description         TEXT NOT NULL DEFAULT '',
            created_at          INTEGER NOT NULL,
            updated_at          INTEGER NOT NULL,
            archived_at         INTEGER
        );

        CREATE TABLE IF NOT EXISTS project_members (
            project_id          TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            note_id             TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
            added_at            INTEGER NOT NULL,
            PRIMARY KEY (project_id, note_id)
        );

        -- 外部连接授权：项目笔记只读和全库能力分开签发；令牌本身不存库。
        CREATE TABLE IF NOT EXISTS mcp_grants (
            id                  TEXT PRIMARY KEY,
            client_label        TEXT NOT NULL,
            scope               TEXT NOT NULL CHECK (scope IN ('project', 'library')),
            project_id          TEXT REFERENCES projects(id),
            token_hash          TEXT NOT NULL UNIQUE,
            library_read        INTEGER NOT NULL DEFAULT 0 CHECK (library_read IN (0, 1)),
            card_write          INTEGER NOT NULL DEFAULT 0 CHECK (card_write IN (0, 1)),
            material_write      INTEGER NOT NULL DEFAULT 0 CHECK (material_write IN (0, 1)),
            created_at          INTEGER NOT NULL,
            revoked_at          INTEGER,
            policy_version      INTEGER NOT NULL,
            CHECK ((scope = 'project' AND project_id IS NOT NULL AND library_read = 0 AND card_write = 0 AND material_write = 0)
                OR (scope = 'library' AND project_id IS NULL AND (library_read = 1 OR card_write = 1 OR material_write = 1)))
        );

        -- 审计只记录授权与动作，不包含查询、正文或令牌。
        CREATE TABLE IF NOT EXISTS mcp_audit (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            grant_id            TEXT NOT NULL REFERENCES mcp_grants(id),
            occurred_at         INTEGER NOT NULL,
            operation           TEXT NOT NULL,
            outcome             TEXT NOT NULL CHECK (outcome IN ('allowed', 'denied'))
        );

        -- 个人画像（R4/D05）：三类声明（用户填写/行为统计/AI 推测）+ 治理。
        -- confirmed_at 有值 = 用户确认的事实；denied = 用户否认；
        -- superseded_by 指向修正后的新声明（旧声明保留可追溯）。
        -- profile_denials 是「阻止同源自动重建」的关键：否认/删除留下
        -- 证据指纹，学习管线再遇到同一证据源时不得重新提出（路线图明确：
        -- 删除应生成阻止同源旧证据自动重建的标记，用户重新允许后才学习）。
        CREATE TABLE IF NOT EXISTS profile_claims (
            id                  TEXT PRIMARY KEY,
            kind                TEXT NOT NULL,             -- 'fact' | 'inference' | 'statistic'
            content             TEXT NOT NULL,
            evidence_json       TEXT NOT NULL DEFAULT '[]', -- 证据：素材/笔记 id 列表
            scope               TEXT NOT NULL DEFAULT 'global', -- 'global' | 项目 id
            created_at          INTEGER NOT NULL,
            confirmed_at        INTEGER,
            expires_at          INTEGER,
            denied_at           INTEGER,
            superseded_by       TEXT,
            status              TEXT NOT NULL DEFAULT 'active' -- 'active' | 'paused'
        );

        CREATE TABLE IF NOT EXISTS profile_denials (
            evidence_fingerprint TEXT PRIMARY KEY,           -- 证据集合的稳定指纹
            denied_at           INTEGER NOT NULL
        );

        -- 目标（R4/D04）：用户明确设定的目标与完成条件；进展**只靠证据关联**，
        -- 没有「缺勤扣分」——status 只有 active/achieved/abandoned 三种，
        -- 「缺少记录」不是第四种状态（路线图：不凭记录少就评价一个人）。
        CREATE TABLE IF NOT EXISTS goals (
            id                  TEXT PRIMARY KEY,
            title               TEXT NOT NULL,
            done_criteria       TEXT NOT NULL,              -- 用户写的完成条件
            scope               TEXT,                       -- 可关联项目（NULL=生活目标）
            created_at          INTEGER NOT NULL,
            achieved_at         INTEGER,                    -- 用户确认达成的时间
            abandoned_at        INTEGER,
            review_note         TEXT NOT NULL DEFAULT ''    -- 达成/放弃时的一句话回顾
        );

        -- 目标 ↔ 证据（素材/笔记 id）：进展的可追溯面。证据缺失 = 没有关联，
        -- 不产生任何负面状态——判定只看 done_criteria 是否被用户确认。
        CREATE TABLE IF NOT EXISTS goal_evidence (
            goal_id             TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
            evidence_id         TEXT NOT NULL,              -- 笔记或素材 id（不建 FK：两类表）
            kind                TEXT NOT NULL,              -- 'note' | 'material'
            linked_at           INTEGER NOT NULL,
            PRIMARY KEY (goal_id, evidence_id)
        );
        CREATE INDEX IF NOT EXISTS idx_goal_evidence_linked_at ON goal_evidence(linked_at);
`

// writePragma 是写连接（含新建）用的 URI 参数，与 Rust open_db 的三条 PRAGMA 对齐：
// WAL 便于并发读、foreign_keys 让外键真正生效、synchronous=NORMAL 平衡写入与安全。
const writePragma = "mode=rw&_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)" +
	"&_pragma=journal_mode(WAL)&_pragma=synchronous(NORMAL)"

// createPragma 与 writePragma 相同，只是允许创建文件。
const createPragma = "mode=rwc&_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)" +
	"&_pragma=journal_mode(WAL)&_pragma=synchronous(NORMAL)"

// Create 新建（或打开已有）资料库并补齐表结构。
//
// Rust 的 open_db 每次打开都会跑 init_tables：既建库也迁移老库。这里保持同一语义，
// 只是把「新建」与「只读打开」分成两个入口——只读入口仍然不写库。
func Create(ctx context.Context, path string) (*Library, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, errtext.Wrap("创建资料库目录失败", err)
	}
	lib, err := openWith(ctx, path, createPragma, true, true)
	if err != nil {
		return nil, err
	}
	lib.writable = true
	return lib, nil
}

// ensureSchema 执行建表批次并补齐历史遗留的列（与 Rust init_tables 的迁移段逐条对齐）。
// 只在可写连接上调用；只读打开不会动库。
func ensureSchema(ctx context.Context, db *sql.DB) error {
	if _, err := db.ExecContext(ctx, SchemaSQL); err != nil {
		return err
	}
	// 笔记级个人画像排除（D05）：老库默认不排除；升级失败必须中止，不能丢掉隐私设置。
	if err := ensureColumn(ctx, db, "notes", "exclude_from_profile",
		"ALTER TABLE notes ADD COLUMN exclude_from_profile INTEGER NOT NULL DEFAULT 0"); err != nil {
		return err
	}
	// First open establishes the boundary for trustworthy per-review history.
	// Legacy aggregate counters are intentionally not backfilled as events.
	if _, err := db.ExecContext(ctx,
		"INSERT OR IGNORE INTO meta (key,value) VALUES ('review_history_started_at',?)",
		time.Now().Unix()); err != nil {
		return err
	}
	// 旧 cards 表可能没有 edited_at（R4 编辑历史）。
	if err := ensureColumn(ctx, db, "cards", "edited_at",
		"ALTER TABLE cards ADD COLUMN edited_at INTEGER"); err != nil {
		return err
	}
	// 向量空间身份列（R2 版本化）。
	hadProvider, err := hasColumn(ctx, db, "card_embeddings", "provider")
	if err != nil {
		return err
	}
	if !hadProvider {
		// Rust 这里忽略错误：列已存在时重复 ALTER 会失败，属于预期分支。
		_, _ = db.ExecContext(ctx, "ALTER TABLE card_embeddings ADD COLUMN provider TEXT NOT NULL DEFAULT ''")
		_, _ = db.ExecContext(ctx, "ALTER TABLE card_embeddings ADD COLUMN model TEXT NOT NULL DEFAULT ''")
	}
	// 产物证据里的笔记 id 列（R4/D07）。
	if err := ensureColumn(ctx, db, "artifacts", "source_note_ids",
		"ALTER TABLE artifacts ADD COLUMN source_note_ids TEXT NOT NULL DEFAULT '[]'"); err != nil {
		return err
	}
	// 旧版未核对修订号的分块向量可能与当前正文不符，只重建派生索引。
	var verified bool
	if err := db.QueryRowContext(ctx,
		"SELECT EXISTS(SELECT 1 FROM meta WHERE key = 'note_chunk_revision_verified')").Scan(&verified); err != nil {
		return err
	}
	if !verified {
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		inserted, err := tx.ExecContext(ctx,
			"INSERT OR IGNORE INTO meta VALUES ('note_chunk_revision_verified', '1')")
		if err != nil {
			_ = tx.Rollback()
			return err
		}
		affected, err := inserted.RowsAffected()
		if err != nil {
			_ = tx.Rollback()
			return err
		}
		if affected > 0 {
			if _, err := tx.ExecContext(ctx, "DELETE FROM note_chunk_embeddings"); err != nil {
				_ = tx.Rollback()
				return err
			}
		}
		if err := tx.Commit(); err != nil {
			return err
		}
	}
	return nil
}

func ensureColumn(ctx context.Context, db *sql.DB, table, column, ddl string) error {
	ok, err := hasColumn(ctx, db, table, column)
	if err != nil {
		return err
	}
	if ok {
		return nil
	}
	_, err = db.ExecContext(ctx, ddl)
	return err
}

func hasColumn(ctx context.Context, db *sql.DB, table, column string) (bool, error) {
	rows, err := db.QueryContext(ctx, "PRAGMA table_info("+table+")")
	if err != nil {
		return false, err
	}
	defer rows.Close()
	for rows.Next() {
		var (
			cid     int
			name    string
			ctype   string
			notNull int
			dflt    sql.NullString
			pk      int
		)
		if err := rows.Scan(&cid, &name, &ctype, &notNull, &dflt, &pk); err != nil {
			return false, err
		}
		if name == column {
			return true, nil
		}
	}
	return false, rows.Err()
}
