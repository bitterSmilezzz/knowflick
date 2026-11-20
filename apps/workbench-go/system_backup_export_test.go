package main

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"knowflick.local/workbench-go/internal/library"
)

func TestSaveSystemBackupWritesOnlyValidDestination(t *testing.T) {
	path := os.Getenv("KF_SYSTEM_BACKUP_DB_FIXTURE_DIR")
	if path == "" {
		t.Skip("set KF_SYSTEM_BACKUP_DB_FIXTURE_DIR")
	}
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "source.kfbackup")
	source, err := os.ReadFile(filepath.Join(path, "knowflick.db"))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(dbPath, source, 0o600); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"media/image/material.png", "media/ink/note.json"} {
		target := filepath.Join(dir, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(target, []byte(strings.Repeat(name, 2)), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	repo, err := library.Open(context.Background(), dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer repo.Close()
	service := &PreviewService{current: repo, path: dbPath, generation: 7}
	ctx := context.Background()
	cases := []struct{ dest, expected string }{
		{filepath.Join(dir, "backup.txt"), ".kfbackup"},
		{dbPath, "资料库"},
		{filepath.Join(dir, "missing", "backup.kfbackup"), "无法创建备份文件"},
	}
	for _, tc := range cases {
		if _, err := service.saveSystemBackup(ctx, 7, dbPath, tc.dest); err == nil || !strings.Contains(err.Error(), tc.expected) {
			t.Fatalf("%s: got %v, want %q", tc.dest, err, tc.expected)
		}
	}
	if _, err := service.saveSystemBackup(ctx, 6, dbPath, filepath.Join(dir, "ok.kfbackup")); err == nil {
		t.Fatal("stale generation should be rejected")
	}
	dest := filepath.Join(dir, "ok.kfbackup")
	got, err := service.saveSystemBackup(ctx, 7, dbPath, dest)
	if err != nil || got != dest {
		t.Fatalf("valid export: %q %v", got, err)
	}
	data, err := os.ReadFile(dest)
	if err != nil {
		t.Fatal(err)
	}
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatalf("invalid ZIP: %v", err)
	}
	manifestData, err := reader.Open("manifest.json")
	if err != nil {
		t.Fatal(err)
	}
	var manifest map[string]any
	if err := json.NewDecoder(manifestData).Decode(&manifest); err != nil {
		t.Fatal(err)
	}
	manifestData.Close()
	if manifest["format"] != "knowflick-backup" || manifest["schemaVersion"] != float64(4) {
		t.Fatalf("unexpected manifest: %v", manifest)
	}
	cardData, err := reader.Open("cards.json")
	if err != nil {
		t.Fatal(err)
	}
	var cards []json.RawMessage
	if err := json.NewDecoder(cardData).Decode(&cards); err != nil {
		t.Fatal(err)
	}
	cardData.Close()
	if len(cards) == 0 {
		t.Fatal("no cards exported")
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if strings.HasSuffix(entry.Name(), ".tmp") {
			t.Fatalf("temporary file left behind: %s", entry.Name())
		}
	}
}
