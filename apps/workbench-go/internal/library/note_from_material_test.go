package library

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"strings"
	"testing"

	_ "modernc.org/sqlite"
)

func TestEnsureNoteFromMaterialIsIdempotent(t *testing.T) {
	lib, path := newWritable(t)
	seed, err := sql.Open("sqlite", filepath.Dir(path)+string(filepath.Separator)+"seed.db")
	if err != nil {
		t.Fatal(err)
	}
	_ = seed.Close()
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("CREATE TABLE IF NOT EXISTS materials (id TEXT PRIMARY KEY, source_type TEXT NOT NULL, title TEXT NOT NULL, source_url TEXT, raw_text TEXT NOT NULL, cleaned_markdown TEXT, content_hash TEXT NOT NULL, media_path TEXT, media_size_bytes INTEGER NOT NULL DEFAULT 0, metadata_json TEXT NOT NULL, inbox_status TEXT NOT NULL DEFAULT 'inbox', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, version INTEGER NOT NULL DEFAULT 1, is_deleted INTEGER NOT NULL DEFAULT 0, deleted_at INTEGER)"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("INSERT INTO materials (id,source_type,title,raw_text,cleaned_markdown,content_hash,metadata_json,created_at,updated_at) VALUES ('m1','web','素材一','原始正文','## 清洗后的 Markdown','h1','{}',1,1),('m2','manual','素材二','只有原始正文',NULL,'h2','{}',1,1)"); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	outcome, err := lib.EnsureNoteFromMaterial(ctx, "m1", 100)
	if err != nil || !outcome.Created || outcome.Revision != 1 {
		t.Fatalf("first conversion: %+v, %v", outcome, err)
	}
	var body, title, source string
	if err := db.QueryRow("SELECT title, body_md, source_material_id FROM notes WHERE id = ?", outcome.ID).Scan(&title, &body, &source); err != nil {
		t.Fatal(err)
	}
	if title != "素材一" || body != "## 清洗后的 Markdown" || source != "m1" {
		t.Fatalf("note: %q %q %q", title, body, source)
	}
	again, err := lib.EnsureNoteFromMaterial(ctx, "m1", 200)
	if err != nil || again.Created || again.ID != outcome.ID || again.Revision != outcome.Revision {
		t.Fatalf("idempotent: %+v, %v", again, err)
	}
	var count int
	if err := db.QueryRow("SELECT COUNT(*) FROM notes WHERE source_material_id = 'm1'").Scan(&count); err != nil || count != 1 {
		t.Fatalf("duplicate notes: %d, %v", count, err)
	}
	second, err := lib.EnsureNoteFromMaterial(ctx, "m2", 300)
	if err != nil || !second.Created {
		t.Fatalf("second conversion: %+v, %v", second, err)
	}
	if err := db.QueryRow("SELECT body_md FROM notes WHERE id = ?", second.ID).Scan(&body); err != nil || body != "只有原始正文" {
		t.Fatalf("fallback body: %q, %v", body, err)
	}
	// 已删除的笔记不算映射：再转一次会新建。
	if _, err := db.Exec("UPDATE notes SET is_deleted = 1 WHERE id = ?", second.ID); err != nil {
		t.Fatal(err)
	}
	third, err := lib.EnsureNoteFromMaterial(ctx, "m2", 400)
	if err != nil || !third.Created || third.ID == second.ID {
		t.Fatalf("reconvert deleted: %+v, %v", third, err)
	}
	if _, err := lib.EnsureNoteFromMaterial(ctx, "missing", 500); err == nil || !strings.Contains(err.Error(), "可能已被删除") {
		t.Fatalf("missing material: %v", err)
	}
	db.Close()

	readonly, err := Open(context.Background(), path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = readonly.Close() })
	if _, err := readonly.EnsureNoteFromMaterial(ctx, "m1", 600); !errors.Is(err, ErrReadOnly) {
		t.Fatalf("read-only conversion: %v", err)
	}
}
