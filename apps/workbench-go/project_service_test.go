package main

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"knowflick.local/workbench-go/internal/library"
)

func TestPreviewProjectFlowOnRustLibrary(t *testing.T) {
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
	list, err := service.ListProjects(ctx, opened.Generation, false)
	if err != nil || len(list) != 1 || list[0].ID != "project-1" {
		t.Fatalf("projects: %+v, %v", list, err)
	}
	members, err := service.ListProjectMembers(ctx, opened.Generation, "project-1")
	if err != nil || len(members) != 1 || members[0].NoteID != "note-active" || members[0].Title == "" {
		t.Fatalf("members: %+v, %v", members, err)
	}
	markdown, err := service.ExportProjectMarkdown(ctx, opened.Generation, "project-1")
	if err != nil || !strings.Contains(markdown, "# 项目：") || !strings.Contains(markdown, "成员笔记 1 篇") {
		t.Fatalf("markdown: %q, %v", markdown, err)
	}
	if _, err := service.CreateProject(ctx, opened.Generation, "新项目", ""); !errors.Is(err, library.ErrReadOnly) {
		t.Fatalf("read-only create: %v", err)
	}
	writable, err := service.EnableEditing(ctx)
	if err != nil {
		t.Fatal(err)
	}
	id, err := service.CreateProject(ctx, writable.Generation, "  新项目  ", "说明")
	if err != nil || id == "" {
		t.Fatalf("create: %q, %v", id, err)
	}
	if _, err := service.CreateProject(ctx, writable.Generation, "新项目", ""); err == nil {
		t.Fatal("duplicate project name accepted")
	}
	if err := service.AddProjectNote(ctx, writable.Generation, id, "note-active"); err != nil {
		t.Fatal(err)
	}
	members, err = service.ListProjectMembers(ctx, writable.Generation, id)
	if err != nil || len(members) != 1 || members[0].NoteID != "note-active" {
		t.Fatalf("members after add: %+v, %v", members, err)
	}
	if err := service.RemoveProjectNote(ctx, writable.Generation, id, "note-active"); err != nil {
		t.Fatal(err)
	}
	members, err = service.ListProjectMembers(ctx, writable.Generation, id)
	if err != nil || len(members) != 0 {
		t.Fatalf("members after remove: %+v, %v", members, err)
	}
	changed, err := service.ArchiveProject(ctx, writable.Generation, id)
	if err != nil || !changed {
		t.Fatalf("archive: %v, %v", changed, err)
	}
	if changed, err = service.ArchiveProject(ctx, writable.Generation, id); err != nil || changed {
		t.Fatalf("re-archive: %v, %v", changed, err)
	}
	if _, err := service.ExportProjectMarkdown(ctx, writable.Generation, id); err == nil || !strings.Contains(err.Error(), "已封存") {
		t.Fatalf("archived export: %v", err)
	}
}
