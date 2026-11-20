package library

import (
	"database/sql"
	"path/filepath"
	"testing"

	"knowflick.local/workbench-go/internal/cards"
)

func openReplaceDB(t *testing.T) *Library {
	t.Helper()
	uri := "file:" + filepath.Join(t.TempDir(), "knowflick.db") + "?mode=rwc"
	db, err := sql.Open("sqlite", uri)
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	schema := []string{
		"CREATE TABLE cards (id TEXT PRIMARY KEY, material_id TEXT, category TEXT NOT NULL DEFAULT '', headline TEXT NOT NULL DEFAULT '', summary TEXT NOT NULL DEFAULT '', details TEXT NOT NULL DEFAULT '', links_json TEXT NOT NULL DEFAULT '[]', tags_json TEXT NOT NULL DEFAULT '[]', source TEXT NOT NULL DEFAULT '', seen_at INTEGER, swiped TEXT, is_favorite INTEGER NOT NULL DEFAULT 0, favorited_at INTEGER, review_count INTEGER NOT NULL DEFAULT 0, mastery_level INTEGER NOT NULL DEFAULT 0, last_reviewed_at INTEGER, repetition INTEGER NOT NULL DEFAULT 0, interval_days REAL NOT NULL DEFAULT 1, ease_factor REAL NOT NULL DEFAULT 2.5, stability REAL NOT NULL DEFAULT 0, difficulty REAL NOT NULL DEFAULT 0, subject TEXT, branch TEXT, level INTEGER, track TEXT, order_key TEXT, prereq_json TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL, edited_at INTEGER, updated_at INTEGER NOT NULL, version INTEGER NOT NULL DEFAULT 1, is_deleted INTEGER NOT NULL DEFAULT 0, deleted_at INTEGER)",
		"CREATE VIRTUAL TABLE fts_cards USING fts5(card_id UNINDEXED, headline, details, summary, category, tags)",
		"CREATE TABLE card_embeddings (card_id TEXT PRIMARY KEY, dim INTEGER NOT NULL, embedding BLOB NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL, updated_at INTEGER NOT NULL)",
		"CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
	}
	for _, statement := range schema {
		if _, err := db.Exec(statement); err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() { _ = db.Close() })
	return &Library{db: db, writable: true}
}

func TestReplaceCardsReplacesActiveSet(t *testing.T) {
	lib := openReplaceDB(t)
	ctx := t.Context()
	// 既有两张：keep 与 drop。
	keep := cards.Card{ID: "keep", Category: "架构", Headline: "保留卡", Summary: "摘要", Details: "正文", Tags: []string{"标签"}, Source: "ai", CreatedAt: 10}
	drop := cards.Card{ID: "drop", Category: "架构", Headline: "丢弃卡", Summary: "摘要", Details: "正文", Source: "ai", CreatedAt: 11}
	if _, err := lib.RestoreCard(ctx, keep); err != nil {
		t.Fatal(err)
	}
	if _, err := lib.RestoreCard(ctx, drop); err != nil {
		t.Fatal(err)
	}
	replacement := keep
	replacement.Details = "替换后的正文"
	if err := lib.ReplaceCards(ctx, []cards.Card{replacement}, 100); err != nil {
		t.Fatal(err)
	}
	// drop 被软删除且 FTS 清掉。
	var deleted int
	if err := lib.db.QueryRow("SELECT is_deleted FROM cards WHERE id = 'drop'").Scan(&deleted); err != nil || deleted != 1 {
		t.Fatalf("drop deleted: %d %v", deleted, err)
	}
	var ftsCount int
	if err := lib.db.QueryRow("SELECT COUNT(*) FROM fts_cards WHERE card_id = 'drop'").Scan(&ftsCount); err != nil || ftsCount != 0 {
		t.Fatalf("drop fts: %d %v", ftsCount, err)
	}
	// keep 被更新且版本递增、FTS 重建。
	var version int
	if err := lib.db.QueryRow("SELECT version FROM cards WHERE id = 'keep'").Scan(&version); err != nil || version != 2 {
		t.Fatalf("keep version: %d %v", version, err)
	}
	var headline string
	if err := lib.db.QueryRow("SELECT headline FROM fts_cards WHERE card_id = 'keep'").Scan(&headline); err != nil || headline != "保留卡" {
		t.Fatalf("keep fts: %q %v", headline, err)
	}
	// 迁移标记写入。
	var migrated string
	if err := lib.db.QueryRow("SELECT value FROM meta WHERE key = 'legacy_cards_migrated'").Scan(&migrated); err != nil || migrated != "1" {
		t.Fatalf("migrated flag: %q %v", migrated, err)
	}
	// 再次替换：上次替换的 keep 仍在活跃集中时可以幂等保留。
	if err := lib.ReplaceCards(ctx, []cards.Card{replacement}, 200); err != nil {
		t.Fatal(err)
	}
	if err := (&Library{db: lib.db, writable: false}).ReplaceCards(ctx, nil, 300); err != ErrReadOnly {
		t.Fatalf("read-only replace: %v", err)
	}
}
