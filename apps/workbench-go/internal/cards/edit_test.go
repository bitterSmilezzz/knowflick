package cards

import (
	"database/sql"
	"errors"
	"testing"
)

func TestCardEditsAndSearchShareTransaction(t *testing.T) {
	db := openCards(t)
	execCardSQL(t, db, `ALTER TABLE cards ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
		ALTER TABLE cards ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
		CREATE VIRTUAL TABLE fts_cards USING fts5(card_id UNINDEXED, headline, summary, details, category, tags);
		CREATE TABLE card_embeddings (card_id TEXT PRIMARY KEY);
		`)
	ctx := t.Context()
	initial := EditableCard{ID: "card-1", Content: Content{Headline: "  初稿  ", Details: "词汇 zebra 连续中文词汇", Tags: []string{"firsttag"}}}
	// The fixture's older CREATE TABLE lacks defaults on new-card fields. Insert an existing card to exercise compatibility with its legacy values.
	insertCard(t, db, initial.ID, 100, "旧标题")
	execCardSQL(t, db, "UPDATE cards SET review_count=7,is_favorite=1 WHERE id='card-1'; INSERT INTO card_embeddings VALUES('card-1')")
	initial.Version = 1
	if err := SaveContent(ctx, db, initial, 200); err != nil {
		t.Fatal(err)
	}
	for _, term := range []string{"zeb", "firsttag", "中文词"} {
		items, err := Browse(ctx, db, term, 10, 0)
		if err != nil || len(items) != 1 || items[0].Version != 2 || items[0].Content.Headline != "初稿" {
			t.Fatalf("search %q: %+v, %v", term, items, err)
		}
	}
	items, err := Browse(ctx, db, "zeb", 10, 1)
	if err != nil || len(items) != 0 {
		t.Fatalf("later page: %+v, %v", items, err)
	}
	var reviewed, favorite, embeddings int
	if err := db.QueryRow("SELECT review_count,is_favorite,(SELECT COUNT(*) FROM card_embeddings) FROM cards WHERE id=?", initial.ID).Scan(&reviewed, &favorite, &embeddings); err != nil || reviewed != 7 || favorite != 1 || embeddings != 0 {
		t.Fatalf("review %d favorite %d embeddings %d: %v", reviewed, favorite, embeddings, err)
	}
	if err := SaveContent(ctx, db, initial, 201); !errors.Is(err, errCardChanged) {
		t.Fatalf("stale update: %v", err)
	}
	if err := DeleteContent(ctx, db, initial.ID, 1, 201); !errors.Is(err, errCardChanged) {
		t.Fatalf("stale delete: %v", err)
	}

	execCardSQL(t, db, `INSERT INTO card_embeddings VALUES('card-1');
		CREATE TRIGGER reject_embedding_delete BEFORE DELETE ON card_embeddings BEGIN SELECT RAISE(ABORT, '拒绝索引更新'); END;`)
	changed := EditableCard{ID: initial.ID, Version: 2, Content: Content{Headline: "不能提交", Details: "rollback"}}
	if err := SaveContent(ctx, db, changed, 300); err == nil {
		t.Fatal("edit committed despite index error")
	}
	if err := DeleteContent(ctx, db, initial.ID, 2, 301); err == nil {
		t.Fatal("delete committed despite index error")
	}
	items, err = Browse(ctx, db, "firsttag", 10, 0)
	if err != nil || len(items) != 1 || items[0].Version != 2 || items[0].Content.Headline != "初稿" {
		t.Fatalf("after rollback: %+v, %v", items, err)
	}
	execCardSQL(t, db, "DROP TRIGGER reject_embedding_delete")
	if err := DeleteContent(ctx, db, initial.ID, 2, 400); err != nil {
		t.Fatal(err)
	}
	var deletedAt, indexed int
	if err := db.QueryRow("SELECT deleted_at,(SELECT COUNT(*) FROM fts_cards),(SELECT COUNT(*) FROM card_embeddings) FROM cards WHERE id=? AND is_deleted=1", initial.ID).Scan(&deletedAt, &indexed, &embeddings); err != nil || deletedAt != 400 || indexed != 0 || embeddings != 0 {
		t.Fatalf("deleted at %d indexed %d embeddings %d: %v", deletedAt, indexed, embeddings, err)
	}
}

func execCardSQL(t *testing.T, db *sql.DB, sql string) {
	t.Helper()
	if _, err := db.Exec(sql); err != nil {
		t.Fatal(err)
	}
}
