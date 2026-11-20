package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"knowflick.local/workbench-go/internal/library"
)

func TestSafeBrowserURLOnlyAllowsWebLinks(t *testing.T) {
	for _, raw := range []string{"https://example.org/a?b=1", "  http://127.0.0.1:8080/x  "} {
		if _, err := safeBrowserURL(raw); err != nil {
			t.Fatalf("rejected %q: %v", raw, err)
		}
	}
	for _, raw := range []string{"", "javascript:alert(1)", "file:///etc/passwd", "not a url", "ftp://example.org"} {
		if _, err := safeBrowserURL(raw); err == nil {
			t.Fatalf("accepted unsafe url %q", raw)
		}
	}
}

func TestExportNoteBodyMatchesFixture(t *testing.T) {
	service, _ := openFixtureCopy(t)
	note, err := service.current.NoteByID(t.Context(), "note-active")
	if err != nil || note.ID != "note-active" || !strings.Contains(note.Body, "media/image/material.png") {
		t.Fatalf("fixture note: %+v, %v", note, err)
	}
	target := filepath.Join(t.TempDir(), "导出", library.SafeExportFileName(note.Title))
	if err := library.ExportTextFile(target, note.Body); err != nil {
		t.Fatal(err)
	}
	written, err := os.ReadFile(target)
	if err != nil || string(written) != note.Body {
		t.Fatalf("exported note bytes differ: %v", err)
	}
	if _, err := service.current.NoteByID(t.Context(), "missing-note"); err == nil {
		t.Fatal("missing note returned")
	}
}
