package library

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"
)

func openImportDB(t *testing.T) *sql.DB {
	t.Helper()
	uri := "file:" + filepath.Join(t.TempDir(), "knowflick.db") + "?mode=rwc"
	db, err := sql.Open("sqlite", uri)
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	schema := []string{
		"CREATE TABLE materials (id TEXT PRIMARY KEY, source_type TEXT NOT NULL, title TEXT NOT NULL, source_url TEXT, raw_text TEXT NOT NULL, cleaned_markdown TEXT, content_hash TEXT NOT NULL, media_path TEXT, media_size_bytes INTEGER NOT NULL DEFAULT 0, metadata_json TEXT NOT NULL, inbox_status TEXT NOT NULL DEFAULT 'inbox', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, version INTEGER NOT NULL DEFAULT 1, is_deleted INTEGER NOT NULL DEFAULT 0, deleted_at INTEGER)",
		"CREATE VIRTUAL TABLE fts_materials USING fts5(material_id UNINDEXED, title, raw_text, source_url)",
	}
	for _, statement := range schema {
		if _, err := db.Exec(statement); err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

func TestSaveImportedMaterialIndexesAndDeduplicates(t *testing.T) {
	ctx := context.Background()
	db := openImportDB(t)
	material := ImportedMaterial{ID: "m1", SourceType: "web", Title: "条目一", SourceURL: "https://example.org/a", RawText: "正文一", MetadataJSON: "{}", InboxStatus: "inbox", CreatedAt: 1000, UpdatedAt: 1000}
	inserted, err := SaveImportedMaterial(ctx, db, material)
	if err != nil || !inserted {
		t.Fatalf("insert: %v %v", inserted, err)
	}
	inserted, err = SaveImportedMaterial(ctx, db, material)
	if err != nil || inserted {
		t.Fatalf("duplicate should be skipped: %v %v", inserted, err)
	}
	var title, url string
	if err := db.QueryRow("SELECT title, source_url FROM fts_materials WHERE material_id = 'm1'").Scan(&title, &url); err != nil {
		t.Fatal(err)
	}
	if title != "条目一" || url != "https://example.org/a" {
		t.Fatalf("fts row: %q %q", title, url)
	}
	urls, err := MaterialSourceURLs(ctx, db)
	if err != nil || len(urls) != 1 || urls[0] != "https://example.org/a" {
		t.Fatalf("urls: %v %v", urls, err)
	}
}
