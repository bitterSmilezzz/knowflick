package library

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

const recordingFixturePath = `../../../../.scratch/go-migration/phase82/speech.webm`

var testNow = time.UnixMilli(1737440000000)

func openImportDirectory(t *testing.T) (string, string) {
	dir := t.TempDir()
	return dir, filepath.Join(dir, "import.webm")
}

func TestSaveAudioFileRejectsInvalidInput(t *testing.T) {
	db := openImportDB(t)
	lib := &Library{db: db, writable: true}
	dir := t.TempDir()
	ctx := t.Context()
	if _, err := lib.SaveAudioFile(ctx, dir, filepath.Join(dir, "missing.webm"), testNow); err == nil {
		t.Fatal("missing file accepted")
	}
	dir2, file := openImportDirectory(t)
	if _, err := lib.SaveAudioFile(ctx, dir2, file, testNow); err == nil {
		t.Fatal("empty directory accepted")
	}
	broken := filepath.Join(t.TempDir(), "broken.mp3")
	if err := os.WriteFile(broken, []byte("not audio"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := lib.SaveAudioFile(ctx, dir, broken, testNow); err == nil {
		t.Fatal("unsupported extension accepted")
	}
}

func TestSaveAudioFileKeepsOriginalAndIndexes(t *testing.T) {
	source, err := os.ReadFile(recordingFixturePath)
	if errors.Is(err, os.ErrNotExist) {
		t.Skip("audio fixture missing outside the migration workspace")
	}
	if err != nil {
		t.Fatal(err)
	}
	db := openImportDB(t)
	lib := &Library{db: db, writable: true}
	dir := t.TempDir()
	ctx := t.Context()
	fixture := filepath.Join(t.TempDir(), "speech.webm")
	if err := os.WriteFile(fixture, source, 0600); err != nil {
		t.Fatal(err)
	}
	id, err := lib.SaveAudioFile(ctx, dir, fixture, testNow)
	if err != nil || id == "" {
		t.Fatalf("import audio: %q, %v", id, err)
	}
	items, err := lib.SearchMaterials(ctx, "语音笔记", 10)
	if err != nil || len(items) != 1 {
		t.Fatalf("indexed audio: %v, %v", items, err)
	}
	item := items[0]
	if item.SourceType != "audio" || item.MediaPath == nil || !strings.HasSuffix(*item.MediaPath, ".webm") {
		t.Fatalf("audio metadata: %+v", item)
	}
	var metadata recordingMetadata
	if err := json.Unmarshal([]byte(item.MetadataJSON), &metadata); err != nil || metadata.DurationMs < 3000 || metadata.MIME != "audio/webm" {
		t.Fatalf("imported duration metadata: %s, %v", item.MetadataJSON, err)
	}
}
