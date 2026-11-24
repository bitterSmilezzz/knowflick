package library

import (
	"database/sql"
	"path/filepath"
	"testing"
)

func openRestoreDB(t *testing.T) *sql.DB {
	t.Helper()
	uri := "file:" + filepath.Join(t.TempDir(), "knowflick.db") + "?mode=rwc"
	db, err := sql.Open("sqlite", uri)
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	schema := []string{
		SubscriptionSchema,
		"CREATE TABLE materials (id TEXT PRIMARY KEY, source_type TEXT NOT NULL, title TEXT NOT NULL, source_url TEXT, raw_text TEXT NOT NULL, cleaned_markdown TEXT, content_hash TEXT NOT NULL, media_path TEXT, media_size_bytes INTEGER NOT NULL DEFAULT 0, metadata_json TEXT NOT NULL, inbox_status TEXT NOT NULL DEFAULT 'inbox', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, version INTEGER NOT NULL DEFAULT 1, is_deleted INTEGER NOT NULL DEFAULT 0, deleted_at INTEGER)",
		"CREATE VIRTUAL TABLE fts_materials USING fts5(material_id UNINDEXED, title, raw_text, source_url)",
		"CREATE TABLE artifacts (id TEXT PRIMARY KEY, artifact_type TEXT NOT NULL, title TEXT NOT NULL, content_markdown TEXT NOT NULL, source_card_ids TEXT NOT NULL DEFAULT '[]', source_note_ids TEXT NOT NULL DEFAULT '[]', date_scope_start INTEGER, date_scope_end INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, is_deleted INTEGER NOT NULL DEFAULT 0, deleted_at INTEGER)",
	}
	for _, statement := range schema {
		if _, err := db.Exec(statement); err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

func TestRestoreMaterialIdempotentAndConflicting(t *testing.T) {
	db := openRestoreDB(t)
	lib := &Library{db: db, writable: true}
	ctx := t.Context()
	material := backupMaterial{ID: "m1", SourceType: "web", Title: "素材一", RawText: "正文", ContentHash: "h", MetadataJSON: "{}", InboxStatus: "inbox", CreatedAt: 10, UpdatedAt: 10}
	written, err := lib.RestoreMaterial(ctx, false, nil, material)
	if err != nil || !written {
		t.Fatalf("first restore: %v %v", written, err)
	}
	var ftsTitle string
	if err := db.QueryRow("SELECT title FROM fts_materials WHERE material_id = 'm1'").Scan(&ftsTitle); err != nil || ftsTitle != "素材一" {
		t.Fatalf("fts row: %q %v", ftsTitle, err)
	}
	written, err = lib.RestoreMaterial(ctx, false, nil, material)
	if err != nil || written {
		t.Fatalf("idempotent restore: %v %v", written, err)
	}
	changed := material
	changed.Title = "改过的标题"
	if _, err := lib.RestoreMaterial(ctx, false, nil, changed); err == nil {
		t.Fatal("conflicting restore accepted")
	}
	if _, err := (&Library{db: db, writable: false}).RestoreMaterial(ctx, false, nil, material); err != ErrReadOnly {
		t.Fatalf("read-only restore: %v", err)
	}
}

func TestRestoreArtifactGuards(t *testing.T) {
	db := openRestoreDB(t)
	lib := &Library{db: db, writable: true}
	ctx := t.Context()
	artifact := backupArtifact{ID: "a1", ArtifactType: "summary", Title: "产物一", ContentMarkdown: "内容", CreatedAt: 5, UpdatedAt: 5}
	written, err := lib.RestoreArtifact(ctx, artifact)
	if err != nil || !written {
		t.Fatalf("restore artifact: %v %v", written, err)
	}
	written, err = lib.RestoreArtifact(ctx, artifact)
	if err != nil || written {
		t.Fatalf("idempotent artifact: %v %v", written, err)
	}
	deleted := artifact
	deleted.IsDeleted = true
	if _, err := lib.RestoreArtifact(ctx, deleted); err == nil {
		t.Fatal("deleted artifact accepted")
	}
	if _, err := db.Exec("UPDATE artifacts SET is_deleted = 1 WHERE id = 'a1'"); err != nil {
		t.Fatal(err)
	}
	if _, err := lib.RestoreArtifact(ctx, artifact); err == nil {
		t.Fatal("local deleted artifact overwritten")
	}
}

func TestSubscriptionSnapshotRestoreValidates(t *testing.T) {
	db := openRestoreDB(t)
	lib := &Library{db: db, writable: true}
	ctx := t.Context()
	snapshot := []byte(`{"version":1,"items":[{"id":"s1","type":"rss","title":"订阅一","targetUrl":"https://example.org/feed","intervalMinutes":60,"isActive":true,"createdAt":10}]}`)
	if err := lib.ValidateSubscriptionDestination(ctx, snapshot); err != nil {
		t.Fatal(err)
	}
	inserted, err := lib.RestoreSubscriptionSnapshot(ctx, snapshot)
	if err != nil || inserted != 1 {
		t.Fatalf("restore subscriptions: %d %v", inserted, err)
	}
	inserted, err = lib.RestoreSubscriptionSnapshot(ctx, snapshot)
	if err != nil || inserted != 0 {
		t.Fatalf("idempotent subscriptions: %d %v", inserted, err)
	}
	if _, err := lib.RestoreSubscriptionSnapshot(ctx, []byte(`{"version":2,"items":[]}`)); err == nil {
		t.Fatal("wrong version accepted")
	}
	bad := []byte(`{"version":1,"items":[{"id":"s2","type":"rss","title":"","targetUrl":"https://example.org","intervalMinutes":60,"isActive":true,"createdAt":10}]}`)
	if _, err := lib.RestoreSubscriptionSnapshot(ctx, bad); err == nil {
		t.Fatal("invalid subscription accepted")
	}
}
