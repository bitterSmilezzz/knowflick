package library

import (
	"database/sql"
	"path/filepath"
	"testing"

	"knowflick.local/workbench-go/internal/cards"
)

func openCardRestoreDB(t *testing.T) *Library {
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
		SubscriptionSchema,
	}
	for _, statement := range schema {
		if _, err := db.Exec(statement); err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() { _ = db.Close() })
	return &Library{db: db, writable: true}
}

func TestRestoreCardIdempotentAndConflicting(t *testing.T) {
	lib := openCardRestoreDB(t)
	ctx := t.Context()
	card := cards.Card{ID: "c1", Category: "架构", Headline: "卡片一", Summary: "摘要", Details: "正文", Tags: []string{"标签"}, Source: "ai", CreatedAt: 10}
	written, err := lib.RestoreCard(ctx, card)
	if err != nil || !written {
		t.Fatalf("restore card: %v %v", written, err)
	}
	written, err = lib.RestoreCard(ctx, card)
	if err != nil || written {
		t.Fatalf("idempotent card: %v %v", written, err)
	}
	changed := card
	changed.Details = "不同的正文"
	if _, err := lib.RestoreCard(ctx, changed); err == nil {
		t.Fatal("conflicting card accepted")
	}
	if _, err := (&Library{db: lib.db, writable: false}).RestoreCard(ctx, card); err != ErrReadOnly {
		t.Fatalf("read-only card restore: %v", err)
	}
}

func TestRestoreSubscriptionSnapshotKeepsSchemaGuard(t *testing.T) {
	lib := openCardRestoreDB(t)
	ctx := t.Context()
	if err := lib.ValidateSubscriptionDestination(ctx, []byte(`{"version":1}`)); err != nil {
		t.Fatal(err)
	}
	if err := lib.ValidateSubscriptionDestination(ctx, []byte(`{"version":3}`)); err == nil {
		t.Fatal("wrong version accepted")
	}
}
