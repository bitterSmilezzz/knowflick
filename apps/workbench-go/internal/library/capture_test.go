package library

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"path/filepath"
	"strings"
	"testing"

	"knowflick.local/workbench-go/internal/materials"
)

func openCaptureDB(t *testing.T) *sql.DB {
	t.Helper()
	uri := "file:" + filepath.Join(t.TempDir(), "lib.db") + "?mode=rwc"
	db, err := sql.Open("sqlite", uri)
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	statements := []string{
		"CREATE TABLE materials (id TEXT PRIMARY KEY, source_type TEXT NOT NULL, title TEXT NOT NULL, source_url TEXT, raw_text TEXT NOT NULL, cleaned_markdown TEXT, content_hash TEXT NOT NULL, media_path TEXT, media_size_bytes INTEGER NOT NULL DEFAULT 0, metadata_json TEXT NOT NULL, inbox_status TEXT NOT NULL DEFAULT 'inbox', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, version INTEGER NOT NULL DEFAULT 1, is_deleted INTEGER NOT NULL DEFAULT 0, deleted_at INTEGER)",
		"CREATE VIRTUAL TABLE fts_materials USING fts5(material_id UNINDEXED, title, raw_text, source_url)",
	}
	for _, statement := range statements {
		if _, err := db.Exec(statement); err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

func captureLibrary(t *testing.T, writable bool) (*Library, *sql.DB) {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "knowflick.db")
	uri := "file:" + path + "?mode=rwc"
	db, err := sql.Open("sqlite", uri)
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	for _, statement := range []string{
		"CREATE TABLE materials (id TEXT PRIMARY KEY, source_type TEXT NOT NULL, title TEXT NOT NULL, source_url TEXT, raw_text TEXT NOT NULL, cleaned_markdown TEXT, content_hash TEXT NOT NULL, media_path TEXT, media_size_bytes INTEGER NOT NULL DEFAULT 0, metadata_json TEXT NOT NULL, inbox_status TEXT NOT NULL DEFAULT 'inbox', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, version INTEGER NOT NULL DEFAULT 1, is_deleted INTEGER NOT NULL DEFAULT 0, deleted_at INTEGER)",
		"CREATE VIRTUAL TABLE fts_materials USING fts5(material_id UNINDEXED, title, raw_text, source_url)",
		"CREATE TABLE notes (id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', body_md TEXT NOT NULL DEFAULT '', notebook TEXT, tags_json TEXT NOT NULL DEFAULT '[]', is_pinned INTEGER NOT NULL DEFAULT 0, is_favorite INTEGER NOT NULL DEFAULT 0, archived_at INTEGER, source_material_id TEXT, current_revision INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, is_deleted INTEGER NOT NULL DEFAULT 0, deleted_at INTEGER, exclude_from_profile INTEGER NOT NULL DEFAULT 0)",
		"CREATE VIRTUAL TABLE fts_notes USING fts5(note_id UNINDEXED,title,body)",
	} {
		if _, err := db.Exec(statement); err != nil {
			t.Fatal(err)
		}
	}
	_ = db.Close()
	var lib *Library
	if writable {
		lib, err = OpenForWrite(context.Background(), path)
	} else {
		lib, err = Open(context.Background(), path)
	}
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = lib.Close() })
	return lib, lib.db
}

func TestCaptureCreatesInboxMaterial(t *testing.T) {
	lib, db := captureLibrary(t, true)
	ctx := context.Background()
	text := "剪藏正文 with zebra"
	id, err := lib.Capture(ctx, CaptureInput{Title: "  标题  ", Text: text, URL: "https://example.org/a"}, 1000)
	if err != nil {
		t.Fatal(err)
	}
	var sourceType, title, sourceURL, status, hash string
	if err := db.QueryRow("SELECT source_type,title,source_url,inbox_status,content_hash FROM materials WHERE id = ?", id).Scan(&sourceType, &title, &sourceURL, &status, &hash); err != nil {
		t.Fatal(err)
	}
	want := sha256.Sum256([]byte(text))
	if sourceType != "web" || title != "标题" || sourceURL != "https://example.org/a" || status != "inbox" || hash != hex.EncodeToString(want[:]) {
		t.Fatalf("captured: %q %q %q %q %q", sourceType, title, sourceURL, status, hash)
	}
	hits, err := materials.Search(ctx, db, "zeb", 10)
	if err != nil || len(hits) != 1 || hits[0].ID != id {
		t.Fatalf("fts after capture: %+v, %v", hits, err)
	}
	// 手动记录：没有链接时 sourceType 是 manual。
	manual, err := lib.Capture(ctx, CaptureInput{Text: "随手一句"}, 1001)
	if err != nil {
		t.Fatal(err)
	}
	var manualType string
	if err := db.QueryRow("SELECT source_type FROM materials WHERE id = ?", manual).Scan(&manualType); err != nil || manualType != "manual" {
		t.Fatalf("manual capture: %q, %v", manualType, err)
	}
	// 标题缺省取首行。
	var fallback string
	if err := db.QueryRow("SELECT title FROM materials WHERE id = ?", manual).Scan(&fallback); err != nil || fallback != "随手一句" {
		t.Fatalf("fallback title: %q, %v", fallback, err)
	}
	long, err := lib.Capture(ctx, CaptureInput{Text: strings.Repeat("字", 200)}, 1002)
	if err != nil {
		t.Fatal(err)
	}
	var longTitle string
	if err := db.QueryRow("SELECT title FROM materials WHERE id = ?", long).Scan(&longTitle); err != nil {
		t.Fatal(err)
	}
	if len([]rune(longTitle)) != 80 {
		t.Fatalf("fallback title length: %d", len([]rune(longTitle)))
	}
}

func TestCaptureValidatesInput(t *testing.T) {
	lib, _ := captureLibrary(t, true)
	ctx := context.Background()
	cases := []struct {
		input CaptureInput
		want  string
	}{
		{CaptureInput{}, "正文不能为空"},
		{CaptureInput{Text: "  \n  "}, "正文不能为空"},
		{CaptureInput{Text: "ok", URL: "ftp://example.org/a"}, "http 或 https"},
		{CaptureInput{Text: "ok", URL: "https://user:pass@example.org/a"}, "账号密码"},
		{CaptureInput{Text: "ok", URL: "notaurl"}, "来源链接无效"},
	}
	for _, tc := range cases {
		if _, err := lib.Capture(ctx, tc.input, 1); err == nil || !strings.Contains(err.Error(), tc.want) {
			t.Fatalf("%+v: got %v, want %q", tc.input, err, tc.want)
		}
	}
	readonly, _ := captureLibrary(t, false)
	if _, err := readonly.Capture(ctx, CaptureInput{Text: "ok"}, 1); err != ErrReadOnly {
		t.Fatalf("read-only capture: %v", err)
	}
}
