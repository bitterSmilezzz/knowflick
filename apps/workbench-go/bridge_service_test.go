package main

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"knowflick.local/workbench-go/internal/library"
)

func TestBridgeServiceMethodsOnRustLibrary(t *testing.T) {
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
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
	service := &PreviewService{initialPath: path}
	t.Cleanup(func() { _ = service.ServiceShutdown() })
	ctx := context.Background()
	opened, err := service.OpenInitialLibrary(ctx)
	if err != nil {
		t.Fatal(err)
	}
	page, err := service.ListNotes(ctx, opened.Generation, 0)
	if err != nil || len(page.Notes) == 0 {
		t.Fatalf("fixture notes: %+v, %v", page, err)
	}
	note, err := service.GetNote(ctx, opened.Generation, page.Notes[0].ID)
	if err != nil || note == nil || note.ID != page.Notes[0].ID {
		t.Fatalf("GetNote: %+v, %v", note, err)
	}
	if _, err := service.SaveMaterial(ctx, opened.Generation, "只读草稿", "正文", ""); err == nil {
		t.Fatal("read-only library accepted a material")
	}

	export := filepath.Join(dir, "nested", "note.md")
	if err := service.WriteTextFile(ctx, export, "导出正文"); err != nil {
		t.Fatalf("WriteTextFile: %v", err)
	}
	written, err := os.ReadFile(export)
	if err != nil || string(written) != "导出正文" {
		t.Fatalf("exported file: %q, %v", written, err)
	}
	if err := service.WriteTextFile(ctx, "", "x"); err == nil {
		t.Fatal("empty export path accepted")
	}

	writable, err := service.EnableEditing(ctx)
	if err != nil {
		t.Fatal(err)
	}
	id, err := service.SaveMaterial(ctx, writable.Generation, "桥接收件箱", "桥接素材正文", "https://example.org/bridge")
	if err != nil || id == "" {
		t.Fatalf("SaveMaterial: %q, %v", id, err)
	}
	inbox, err := service.ListMaterials(ctx, writable.Generation, true, 100, 0)
	if err != nil {
		t.Fatalf("inbox: %v", err)
	}
	found := false
	for _, material := range inbox {
		if material.ID == id && strings.Contains(material.RawText, "桥接素材正文") {
			found = true
		}
	}
	if !found {
		t.Fatalf("material not persisted: %+v", inbox)
	}

	if err := service.CreateKnowledgeBase(ctx, writable.Generation, "kb-bridge", "桥接知识库", ""); err != nil {
		t.Fatalf("CreateKnowledgeBase: %v", err)
	}
	noteID := page.Notes[0].ID
	entries := []library.MembershipRestoreEntry{{KBID: "kb-bridge", NoteID: noteID, AddedAt: 123}, {KBID: "missing-kb", NoteID: noteID, AddedAt: 123}}
	outcomes, err := service.RestoreKnowledgeBaseMembership(ctx, writable.Generation, entries)
	if err != nil || len(outcomes) != 2 || outcomes[0].Action != "added" || outcomes[1].Error == "" {
		t.Fatalf("restore membership: %+v, %v", outcomes, err)
	}
	again, err := service.RestoreKnowledgeBaseMembership(ctx, writable.Generation, entries[:1])
	if err != nil || len(again) != 1 || again[0].Action != "already" {
		t.Fatalf("idempotent restore: %+v, %v", again, err)
	}
	snapshot, err := service.ReadKnowledgeBases(ctx, writable.Generation)
	if err != nil || snapshot.Membership["kb-bridge\n"+noteID] != 123 {
		t.Fatalf("membership snapshot: %+v, %v", snapshot, err)
	}
}
