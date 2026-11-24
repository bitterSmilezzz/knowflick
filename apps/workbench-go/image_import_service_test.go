package main

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"knowflick.local/workbench-go/internal/library"
)

func TestImageImportBatchOnRustLibrary(t *testing.T) {
	service, _ := openFixtureCopy(t)
	ctx := t.Context()
	image := filepath.Join(t.TempDir(), "batch.gif")
	if err := os.WriteFile(image, []byte("原图内容"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := service.importImages(ctx, 1, []string{image}); !errors.Is(err, library.ErrReadOnly) {
		t.Fatalf("read-only import: %v", err)
	}
	writable, err := service.EnableEditing(ctx)
	if err != nil {
		t.Fatal(err)
	}
	result, err := service.importImages(ctx, writable.Generation, []string{image, "无效.txt", image})
	if err != nil || len(result.ImportedIDs) != 1 || result.Skipped != 1 || len(result.Failures) != 1 {
		t.Fatalf("mixed batch: %+v, %v", result, err)
	}
	materials, err := service.ListMaterials(ctx, writable.Generation, true, 10, 0)
	if err != nil || len(materials) != 2 || materials[0].ID != result.ImportedIDs[0] {
		t.Fatalf("inbox after import: %+v, %v", materials, err)
	}
	stats, err := service.GetStats(ctx, writable.Generation)
	if err != nil || stats.TotalMaterials != 2 || stats.InboxMaterials != 2 {
		t.Fatalf("stats after import: %+v, %v", stats, err)
	}
}
