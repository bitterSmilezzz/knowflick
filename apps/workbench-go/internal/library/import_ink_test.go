package library

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"knowflick.local/workbench-go/internal/media"
)

const inkFixture = `{"version":1,"width":100,"height":60,"strokes":[{"points":[{"x":0.2,"y":0.3},{"x":0.7,"y":0.8}],"width":0.004,"color":"ink"}]}`

func TestSaveInkPersistsAttachmentAndMetadata(t *testing.T) {
	lib, _ := captureLibrary(t, true)
	dir := t.TempDir()
	ctx := t.Context()
	encoded := []byte(inkFixture)
	for _, invalid := range []string{"{}", strings.Replace(inkFixture, "0.2", "1.2", 1), strings.Replace(inkFixture, "\"x\":0.2,", "", 1)} {
		if _, err := lib.SaveInk(ctx, dir, invalid, 1000); err == nil {
			t.Fatalf("invalid ink accepted: %s", invalid)
		}
	}
	id, err := lib.SaveInk(ctx, dir, inkFixture, 1737532800000)
	if err != nil || id == "" {
		t.Fatalf("save ink: %q, %v", id, err)
	}
	items, err := lib.SearchMaterials(ctx, "手写笔记", 10)
	if err != nil || len(items) != 1 {
		t.Fatalf("indexed material: %v, %v", items, err)
	}
	item := items[0]
	if item.SourceType != "ink" || item.InboxStatus != "inbox" || item.MediaPath == nil || item.MediaSizeBytes != int64(len(encoded)) {
		t.Fatalf("ink metadata: %+v", item)
	}
	if !strings.Contains(item.Title, "手写笔记 · ") || !strings.Contains(item.RawText, "1 笔") {
		t.Fatalf("ink title or body: %q %q", item.Title, item.RawText)
	}
	var metadata struct {
		Ink json.RawMessage
	}
	if err := json.Unmarshal([]byte(item.MetadataJSON), &metadata); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(metadata.Ink, encoded) {
		t.Fatal("metadata lost the ink document")
	}
	stored, err := media.Read(dir, *item.MediaPath)
	if err != nil || !bytes.Equal(stored, encoded) {
		t.Fatalf("stored strokes: %v", err)
	}
	if !strings.HasSuffix(*item.MediaPath, ".json") {
		t.Fatalf("ink file extension: %q", *item.MediaPath)
	}
}

func TestSaveInkRollsBackRecordIndexAndFile(t *testing.T) {
	lib, _ := captureLibrary(t, true)
	dir := t.TempDir()
	if _, err := lib.SaveInk(t.Context(), dir, inkFixture, 1000); err != nil {
		t.Fatal(err)
	}
	if _, err := lib.db.Exec("CREATE TRIGGER reject_ink BEFORE UPDATE OF media_path ON materials BEGIN SELECT RAISE(ABORT, '测试拒绝笔迹'); END"); err != nil {
		t.Fatal(err)
	}
	if _, err := lib.SaveInk(t.Context(), dir, inkFixture, 2000); err == nil || !strings.Contains(err.Error(), "测试拒绝笔迹") {
		t.Fatalf("expected failure: %v", err)
	}
	entries, err := os.ReadDir(filepath.Join(dir, "media", "ink"))
	if err != nil || len(entries) != 1 {
		t.Fatalf("failed save left files: %v, %v", entries, err)
	}
	var records, indexed int
	query := "SELECT (SELECT COUNT(*) FROM materials WHERE source_type='ink' AND created_at=2000), (SELECT COUNT(*) FROM fts_materials WHERE material_id NOT IN (SELECT id FROM materials))"
	if err := lib.db.QueryRow(query).Scan(&records, &indexed); err != nil || records != 0 || indexed != 0 {
		t.Fatalf("failed save left records: %d indexed %d, %v", records, indexed, err)
	}
}
