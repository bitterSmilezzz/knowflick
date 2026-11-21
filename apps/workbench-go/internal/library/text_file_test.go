package library

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestExportTextFileWritesExactUTF8AndCreatesParents(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "子目录", "笔记.md")
	contents := "# 标题\n\n正文 with ASCII.\n"
	if err := ExportTextFile(target, contents); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(target)
	if err != nil || string(data) != contents {
		t.Fatalf("exported bytes: %q, %v", data, err)
	}
	if err := ExportTextFile("", contents); err == nil || !strings.Contains(err.Error(), "没有选择导出位置") {
		t.Fatalf("empty path: %v", err)
	}
	if err := ExportTextFile(dir, contents); err == nil {
		t.Fatal("directory target accepted")
	}
}

func TestSafeExportFileName(t *testing.T) {
	if got := SafeExportFileName("周报/2026:Q1*?.md"); got != "周报／2026：Q1＊？.md.md" {
		t.Fatalf("sanitized name: %q", got)
	}
	if got := SafeExportFileName("   "); got != "无标题笔记.md" {
		t.Fatalf("empty title: %q", got)
	}
	long := SafeExportFileName(strings.Repeat("很", 100))
	if len([]rune(strings.TrimSuffix(long, ".md"))) != 80 {
		t.Fatalf("long title truncated to %d", len([]rune(strings.TrimSuffix(long, ".md"))))
	}
}
