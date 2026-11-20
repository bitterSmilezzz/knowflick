package library

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"knowflick.local/workbench-go/internal/media"
)

func TestImportImageIndexesAndDeduplicatesBeforeSavingFile(t *testing.T) {
	db := openImportDB(t)
	lib := &Library{db: db, writable: true}
	ctx := t.Context()
	dir := t.TempDir()
	source := filepath.Join(t.TempDir(), "图片 sample.PNG")
	data := []byte("原图内容")
	if err := os.WriteFile(source, data, 0600); err != nil {
		t.Fatal(err)
	}
	id, err := lib.ImportImage(ctx, dir, source, 100)
	if err != nil || id == "" {
		t.Fatalf("import: %q, %v", id, err)
	}
	items, err := lib.SearchMaterials(ctx, "sample", 10)
	if err != nil || len(items) != 1 || items[0].ID != id {
		t.Fatalf("indexed material: %v, %v", items, err)
	}
	item := items[0]
	if item.SourceType != "image" || item.Title != "图片 sample" || item.InboxStatus != "inbox" || item.MediaSizeBytes != int64(len(data)) || item.MediaPath == nil || !strings.HasSuffix(*item.MediaPath, ".png") {
		t.Fatalf("imported metadata: %+v", item)
	}
	stored, err := media.Read(dir, *item.MediaPath)
	if err != nil || !bytes.Equal(stored, data) {
		t.Fatalf("stored bytes differ: %v", err)
	}
	duplicate, err := lib.ImportImage(ctx, dir, source, 200)
	if err != nil || duplicate != "" {
		t.Fatalf("repeated import: %q, %v", duplicate, err)
	}
	files, err := os.ReadDir(filepath.Join(dir, "media", "image"))
	if err != nil || len(files) != 1 {
		t.Fatalf("duplicate left media files: %v, %v", files, err)
	}
	var count int
	if err := db.QueryRow("SELECT COUNT(*) FROM fts_materials").Scan(&count); err != nil || count != 1 {
		t.Fatalf("duplicate left index entries: %d, %v", count, err)
	}
}

func TestImportImageRollsBackRecordIndexAndOriginal(t *testing.T) {
	db := openImportDB(t)
	lib := &Library{db: db, writable: true}
	dir := t.TempDir()
	source := filepath.Join(t.TempDir(), "record.png")
	if err := os.WriteFile(source, []byte("图片内容"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("CREATE TRIGGER reject_original BEFORE UPDATE OF media_path ON materials BEGIN SELECT RAISE(ABORT, '测试拒绝关联'); END"); err != nil {
		t.Fatal(err)
	}
	if _, err := lib.ImportImage(t.Context(), dir, source, 100); err == nil || !strings.Contains(err.Error(), "测试拒绝关联") {
		t.Fatalf("image import failure: %v", err)
	}
	files, err := os.ReadDir(filepath.Join(dir, "media", "image"))
	if err != nil || len(files) != 0 {
		t.Fatalf("failed import left files: %v, %v", files, err)
	}
	var records, indexed int
	if err := db.QueryRow("SELECT (SELECT COUNT(*) FROM materials), (SELECT COUNT(*) FROM fts_materials)").Scan(&records, &indexed); err != nil || records != 0 || indexed != 0 {
		t.Fatalf("failed import left records: %d indexed %d, %v", records, indexed, err)
	}
	if _, err := db.Exec("DROP TRIGGER reject_original"); err != nil {
		t.Fatal(err)
	}
	if id, err := lib.ImportImage(t.Context(), dir, source, 200); err != nil || id == "" {
		t.Fatalf("retry: %q, %v", id, err)
	}
}
