package library

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"knowflick.local/workbench-go/internal/archive"
)

// 整库恢复必须重建笔记索引：正文可搜不算够，分块检索也要能命中。
func TestRestoreCoreBackupRebuildsNoteIndexes(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	sourcePath := filepath.Join(dir, "source.db")
	source, err := Create(ctx, sourcePath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := source.Upsert(ctx, Note{ID: "note-index-1", Title: "索引重建", Body: "第一段讲检索。\n\n第二段讲分块。"}, 0, 1000); err != nil {
		t.Fatal(err)
	}
	// 备份包要求 search_history.json 存在（可选内容也要有条目）。
	if err := os.WriteFile(filepath.Join(dir, "search_history.json"), []byte("[]"), 0o600); err != nil {
		t.Fatal(err)
	}
	backupFile := filepath.Join(dir, "backup.kfbackup")
	file, err := os.Create(backupFile)
	if err != nil {
		t.Fatal(err)
	}
	if err := source.WriteSystemBackupV4(ctx, file, dir, time.UnixMilli(2000)); err != nil {
		file.Close()
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	if err := source.Close(); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(backupFile)
	if err != nil {
		t.Fatal(err)
	}
	backup, err := archive.ReadSystemBackup(data)
	if err != nil {
		t.Fatal(err)
	}

	targetPath := filepath.Join(dir, "target.db")
	target, err := Create(ctx, targetPath)
	if err != nil {
		t.Fatal(err)
	}
	defer target.Close()
	if _, err := target.RestoreCoreBackup(ctx, backup, dir); err != nil {
		t.Fatal(err)
	}
	hits, err := target.SearchChunks(ctx, "分块", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(hits) == 0 {
		t.Fatal("restored note has no chunk hits")
	}
	if countRows(t, targetPath, "SELECT COUNT(*) FROM fts_notes") != 1 {
		t.Fatal("restored note is missing its full text index row")
	}
}
