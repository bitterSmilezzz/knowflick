package main

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"knowflick.local/workbench-go/internal/library"

	_ "modernc.org/sqlite"
)

func TestNoteFromMaterialAndProjectSnapshotOnRustLibrary(t *testing.T) {
	fixture := os.Getenv("KF_SYSTEM_BACKUP_DB_FIXTURE_DIR")
	if fixture == "" {
		t.Skip("set KF_SYSTEM_BACKUP_DB_FIXTURE_DIR to the Rust-created database fixture")
	}
	dir := t.TempDir()
	path := filepath.Join(dir, "knowflick.db")
	data, err := os.ReadFile(filepath.Join(fixture, "knowflick.db"))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	service := &PreviewService{initialPath: path, path: path}
	t.Cleanup(func() { _ = service.ServiceShutdown() })
	ctx := context.Background()
	opened, err := service.OpenInitialLibrary(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.EnsureNoteFromMaterial(ctx, opened.Generation, "material-active"); !errors.Is(err, library.ErrReadOnly) {
		t.Fatalf("read-only conversion: %v", err)
	}
	writable, err := service.EnableEditing(ctx)
	if err != nil {
		t.Fatal(err)
	}
	outcome, err := service.EnsureNoteFromMaterial(ctx, writable.Generation, "material-active")
	if err != nil || outcome.Created || outcome.ID != "note-active" {
		t.Fatalf("existing mapping: %+v, %v", outcome, err)
	}
	if _, err := service.EnsureNoteFromMaterial(ctx, writable.Generation, "missing"); err == nil || !strings.Contains(err.Error(), "可能已被删除") {
		t.Fatalf("missing material: %v", err)
	}
	db, err := sql.Open("sqlite", "file:"+path+"?mode=rw&_pragma=busy_timeout(10000)")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec("INSERT INTO materials (id,source_type,title,raw_text,content_hash,metadata_json,created_at,updated_at) VALUES ('material-new','web','新素材','正文 zebra','h','{}',1,1)"); err != nil {
		t.Fatal(err)
	}
	created, err := service.EnsureNoteFromMaterial(ctx, writable.Generation, "material-new")
	if err != nil || !created.Created {
		t.Fatalf("create note: %+v, %v", created, err)
	}
	again, err := service.EnsureNoteFromMaterial(ctx, writable.Generation, "material-new")
	if err != nil || again.Created || again.ID != created.ID {
		t.Fatalf("idempotent: %+v, %v", again, err)
	}
	page, err := service.ListNotes(ctx, writable.Generation, 0)
	if err != nil {
		t.Fatal(err)
	}
	var mapped bool
	for _, note := range page.Notes {
		if note.SourceMaterialID != nil && *note.SourceMaterialID == "material-new" && note.ID == created.ID {
			mapped = true
		}
	}
	if !mapped {
		t.Fatalf("converted note missing from list: %+v", page.Notes)
	}
	snapshot, err := service.ExportProjectSnapshot(ctx, writable.Generation, "project-1")
	if err != nil || snapshot.Project.ID != "project-1" || len(snapshot.Members) == 0 {
		t.Fatalf("snapshot: %+v, %v", snapshot, err)
	}
	if _, err := service.ExportProjectSnapshot(ctx, writable.Generation, "missing"); err == nil || !strings.Contains(err.Error(), "项目不存在") {
		t.Fatalf("missing project snapshot: %v", err)
	}
}
