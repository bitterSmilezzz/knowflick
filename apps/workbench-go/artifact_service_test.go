package main

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"knowflick.local/workbench-go/internal/artifacts"
	"knowflick.local/workbench-go/internal/library"
)

func TestPreviewArtifactFlowOnRustLibrary(t *testing.T) {
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
	service := &PreviewService{initialPath: path}
	t.Cleanup(func() { _ = service.ServiceShutdown() })
	ctx := context.Background()
	opened, err := service.OpenInitialLibrary(ctx)
	if err != nil {
		t.Fatal(err)
	}
	list, err := service.ListArtifacts(ctx, opened.Generation, 50, 0)
	if err != nil || len(list) != 1 || list[0].ID != "artifact-active" {
		t.Fatalf("fixture artifacts: %+v, %v", list, err)
	}
	created := artifacts.Artifact{
		ID: "artifact-new", ArtifactType: "note", Title: "新建产物",
		ContentMarkdown: "正文内容", SourceCardIDs: []string{"card-active"},
		SourceNoteIDs: []string{"note-active"}, CreatedAt: 1700000006000, UpdatedAt: 1700000006000,
	}
	if err := service.SaveArtifact(ctx, opened.Generation, created); !errors.Is(err, library.ErrReadOnly) {
		t.Fatalf("read-only save: %v", err)
	}
	writable, err := service.EnableEditing(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err := service.SaveArtifact(ctx, writable.Generation, created); err != nil {
		t.Fatal(err)
	}
	got, err := service.GetArtifact(ctx, writable.Generation, "artifact-new")
	if err != nil || got == nil || got.Title != "新建产物" || got.SourceCardIDs[0] != "card-active" {
		t.Fatalf("saved artifact: %+v, %v", got, err)
	}
	list, err = service.ListArtifacts(ctx, writable.Generation, 50, 0)
	if err != nil || len(list) != 2 {
		t.Fatalf("list after save: %+v, %v", list, err)
	}
	if err := service.DeleteArtifact(ctx, writable.Generation, "artifact-new"); err != nil {
		t.Fatal(err)
	}
	if err := service.DeleteArtifact(ctx, writable.Generation, "artifact-new"); err == nil {
		t.Fatal("double delete succeeded")
	}
	list, err = service.ListArtifacts(ctx, writable.Generation, 50, 0)
	if err != nil || len(list) != 1 || list[0].ID != "artifact-active" {
		t.Fatalf("list after delete: %+v, %v", list, err)
	}
}
