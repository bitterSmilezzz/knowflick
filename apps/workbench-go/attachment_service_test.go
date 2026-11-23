package main

import (
	"context"
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestAttachmentRoundTripAndPathSafety(t *testing.T) {
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
	source := filepath.Join(t.TempDir(), "photo.png")
	if err := os.WriteFile(source, []byte("图片字节"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := service.ImportAttachment(ctx, opened.Generation, source); err == nil || !strings.Contains(err.Error(), "只读") {
		t.Fatalf("read-only import: %v", err)
	}
	encoded := base64.StdEncoding.EncodeToString([]byte("附件内容"))
	if _, err := service.SaveAttachment(ctx, opened.Generation, "image", "image/png", encoded); err == nil || !strings.Contains(err.Error(), "只读") {
		t.Fatalf("read-only save: %v", err)
	}
	writable, err := service.EnableEditing(ctx)
	if err != nil {
		t.Fatal(err)
	}
	relative, err := service.SaveAttachment(ctx, writable.Generation, "image", "image/png", encoded)
	if err != nil || !strings.HasPrefix(relative, "media/image/") || !strings.HasSuffix(relative, ".png") {
		t.Fatalf("save: %q, %v", relative, err)
	}
	back, err := service.ReadAttachment(ctx, writable.Generation, relative)
	if err != nil || back != encoded {
		t.Fatalf("read back: %q, %v", back, err)
	}
	imported, err := service.ImportAttachment(ctx, writable.Generation, source)
	if err != nil || !strings.HasPrefix(imported, "media/image/") {
		t.Fatalf("import: %q, %v", imported, err)
	}
	listed, err := service.ListAttachments(ctx, writable.Generation)
	if err != nil || len(listed) < 1 {
		t.Fatalf("list: %+v, %v", listed, err)
	}
	found := false
	for _, item := range listed {
		if item.Path == imported {
			found = true
		}
	}
	if !found {
		t.Fatalf("imported attachment not listed: %+v", listed)
	}
	text := filepath.Join(t.TempDir(), "notes.txt")
	if err := os.WriteFile(text, []byte("文本"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := service.ImportAttachment(ctx, writable.Generation, text); err == nil {
		t.Fatal("text attachment should be rejected")
	}
	note, err := service.current.NoteByID(ctx, "note-active")
	if err != nil {
		t.Fatal(err)
	}
	ref := "![附件](" + relative + ")"
	note.Body += "\n\n" + ref
	outcome, err := service.SaveNote(ctx, writable.Generation, note, note.Revision)
	if err != nil || outcome.Revision != note.Revision+1 {
		t.Fatalf("save attachment reference: %+v, %v", outcome, err)
	}
	stored, err := service.current.NoteByID(ctx, note.ID)
	if err != nil || !strings.HasSuffix(stored.Body, ref) {
		t.Fatalf("saved note reference: %q, %v", stored.Body, err)
	}
	if _, err := service.ReadAttachment(ctx, opened.Generation, relative); err == nil {
		t.Fatal("stale generation accepted")
	}
	for _, bad := range []string{"../knowflick.db", "/etc/passwd", "media/image/../../secret.png", "missing.png"} {
		if _, err := service.ReadAttachment(ctx, writable.Generation, bad); err == nil {
			t.Fatalf("unsafe path accepted: %q", bad)
		}
	}
	if _, err := service.SaveAttachment(ctx, writable.Generation, "image", "image/png", "not-base64!!"); err == nil || !strings.Contains(err.Error(), "解码") {
		t.Fatalf("bad base64: %v", err)
	}
}
