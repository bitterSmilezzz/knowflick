package artifacts

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"
	"time"

	_ "modernc.org/sqlite"
)

const artSchema = `
CREATE TABLE artifacts (
  id TEXT PRIMARY KEY, artifact_type TEXT NOT NULL, title TEXT NOT NULL, content_markdown TEXT NOT NULL,
  source_card_ids TEXT NOT NULL DEFAULT '[]', source_note_ids TEXT NOT NULL DEFAULT '[]',
  date_scope_start INTEGER, date_scope_end INTEGER, created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL, is_deleted INTEGER NOT NULL DEFAULT 0
);
`

func openArtifacts(t *testing.T) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "lib.db"))
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(artSchema); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

func seedArtifacts(t *testing.T, db *sql.DB) {
	t.Helper()
	if _, err := db.Exec("INSERT INTO artifacts (id,artifact_type,title,content_markdown,source_card_ids,created_at,updated_at) VALUES ('a-old','briefing','旧简报','正文一','[\"c1\"]',100,100)"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("INSERT INTO artifacts (id,artifact_type,title,content_markdown,created_at,updated_at) VALUES ('a-new','note','新草稿','正文二',200,200)"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("INSERT INTO artifacts (id,artifact_type,title,content_markdown,created_at,updated_at,is_deleted) VALUES ('a-gone','note','已删除','正文三',300,300,1)"); err != nil {
		t.Fatal(err)
	}
}

func TestListGetsAndPaging(t *testing.T) {
	db := openArtifacts(t)
	seedArtifacts(t, db)
	ctx := context.Background()
	all, err := List(ctx, db, 10, 0)
	if err != nil || len(all) != 2 || all[0].ID != "a-new" || all[1].SourceCardIDs[0] != "c1" {
		t.Fatalf("list: %+v, %v", all, err)
	}
	page, err := List(ctx, db, 1, 1)
	if err != nil || len(page) != 1 || page[0].ID != "a-old" {
		t.Fatalf("paged: %+v, %v", page, err)
	}
	got, err := Get(ctx, db, "a-new")
	if err != nil || got == nil || got.ContentMarkdown != "正文二" {
		t.Fatalf("get: %+v, %v", got, err)
	}
	if gone, err := Get(ctx, db, "a-gone"); err != nil || gone != nil {
		t.Fatalf("deleted get: %+v, %v", gone, err)
	}
}

func TestSaveUpdatesInPlaceAndValidates(t *testing.T) {
	db := openArtifacts(t)
	ctx := context.Background()
	created := time.Now().UnixMilli()
	item := Artifact{ID: "a1", ArtifactType: "note", Title: "  草稿  ", ContentMarkdown: "正文", CreatedAt: created, UpdatedAt: created}
	if err := Save(ctx, db, item); err != nil {
		t.Fatal(err)
	}
	got, err := Get(ctx, db, "a1")
	if err != nil || got == nil || got.Title != "草稿" {
		t.Fatalf("created: %+v, %v", got, err)
	}
	edited := *got
	edited.Title = "改过的草稿"
	edited.ContentMarkdown = "改过的正文"
	edited.UpdatedAt = created + 5000
	if err := Save(ctx, db, edited); err != nil {
		t.Fatal(err)
	}
	again, err := Get(ctx, db, "a1")
	if err != nil || again == nil || again.CreatedAt != created || again.UpdatedAt != created+5000 || again.Title != "改过的草稿" {
		t.Fatalf("updated: %+v, %v", again, err)
	}
	if err := Delete(ctx, db, "a1", created+6000); err != nil {
		t.Fatal(err)
	}
	if err := Delete(ctx, db, "a1", created+7000); err == nil {
		t.Fatal("double delete succeeded")
	}
	// 重新保存会复位删除标记（与 Rust save_artifact 一致）。
	if err := Save(ctx, db, edited); err != nil {
		t.Fatal(err)
	}
	if restored, err := Get(ctx, db, "a1"); err != nil || restored == nil {
		t.Fatalf("resurrected: %+v, %v", restored, err)
	}
	bad := []Artifact{
		{ID: "", Title: "x", CreatedAt: 1, UpdatedAt: 1},
		{ID: "b", Title: "   ", CreatedAt: 1, UpdatedAt: 1},
		{ID: "b", Title: "x", ContentMarkdown: "ok\u0007", CreatedAt: 1, UpdatedAt: 1},
		{ID: "b", Title: "x", CreatedAt: 0, UpdatedAt: 1},
		{ID: "b", Title: "x", SourceCardIDs: []string{""}, CreatedAt: 1, UpdatedAt: 1},
	}
	for i, item := range bad {
		if err := Save(ctx, db, item); err == nil {
			t.Fatalf("invalid artifact %d accepted", i)
		}
	}
}

func TestListToleratesBrokenSourceJSON(t *testing.T) {
	db := openArtifacts(t)
	if _, err := db.Exec("INSERT INTO artifacts (id,artifact_type,title,content_markdown,source_card_ids,created_at,updated_at) VALUES ('broken','note','旧数据','正文','{not-json',1,1)"); err != nil {
		t.Fatal(err)
	}
	items, err := List(context.Background(), db, 10, 0)
	if err != nil || len(items) != 1 || items[0].SourceCardIDs == nil || len(items[0].SourceCardIDs) != 0 {
		t.Fatalf("broken json list: %+v, %v", items, err)
	}
}
