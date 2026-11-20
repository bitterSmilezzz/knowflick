package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCopyBackupToDirectoryVersionsAndSidecar(t *testing.T) {
	service := &PreviewService{}
	dir := t.TempDir()
	result, err := service.CopyBackupToDirectory(t.Context(), dir, []byte("包内容一"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(result.FileName, "knowflick-backup-") || !strings.HasSuffix(result.FileName, ".kfbackup") {
		t.Fatalf("file name: %q", result.FileName)
	}
	if result.Bytes != len("包内容一") {
		t.Fatalf("bytes: %d", result.Bytes)
	}
	data, err := os.ReadFile(filepath.Join(dir, result.FileName))
	if err != nil || string(data) != "包内容一" {
		t.Fatalf("archive bytes: %v", err)
	}
	sidecar, err := os.ReadFile(result.Sidecar)
	if err != nil || !strings.HasPrefix(string(sidecar), result.SHA256+"  ") {
		t.Fatalf("sidecar: %q %v", sidecar, err)
	}
	// 同一天第二次备份：序号递增。
	result2, err := service.CopyBackupToDirectory(t.Context(), dir, []byte("包内容二"))
	if err != nil || result2.FileName == result.FileName {
		t.Fatalf("second backup: %+v, %v", result2, err)
	}
	if _, err := service.CopyBackupToDirectory(t.Context(), filepath.Join(dir, "不存在"), nil); err == nil {
		t.Fatal("missing directory accepted")
	}
}
