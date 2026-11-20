package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLegacyStoreSnapshotAndSaves(t *testing.T) {
	service, _ := openFixtureCopy(t)
	ctx := t.Context()
	opened, err := service.OpenInitialLibrary(ctx)
	if err != nil {
		t.Fatal(err)
	}
	snapshot, err := service.LoadStore(ctx, opened.Generation)
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.Dir == "" || snapshot.Cards != nil {
		t.Fatalf("snapshot: dir=%q cards=%v", snapshot.Dir, snapshot.Cards)
	}
	if err := service.SaveCardsJSON(ctx, opened.Generation, "[{\"id\":\"legacy-1\"}]"); err != nil {
		t.Fatal(err)
	}
	if err := service.SaveCardsJSON(ctx, opened.Generation, "[{\"id\":\"legacy-2\"}]"); err != nil {
		t.Fatal(err)
	}
	if err := service.SaveSettingsJSON(ctx, opened.Generation, "{\"model\":\"m\"}"); err != nil {
		t.Fatal(err)
	}
	snapshot, err = service.LoadStore(ctx, opened.Generation)
	if err != nil || snapshot.Cards == nil || !strings.Contains(*snapshot.Cards, "legacy-2") {
		t.Fatalf("updated snapshot: %+v, %v", snapshot, err)
	}
	if snapshot.Backup == nil || !strings.Contains(*snapshot.Backup, "legacy-1") {
		t.Fatalf("rotation backup: %+v", snapshot)
	}
	if snapshot.Settings == nil || !strings.Contains(*snapshot.Settings, "\"model\":\"m\"") {
		t.Fatalf("settings snapshot: %+v", snapshot)
	}
	if _, err := service.LoadStore(ctx, 99); err == nil {
		t.Fatal("stale generation accepted")
	}
}

func TestExportArchiveAndCardsJSON(t *testing.T) {
	service, _ := openFixtureCopy(t)
	ctx := t.Context()
	opened, err := service.OpenInitialLibrary(ctx)
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	zipDest := filepath.Join(dir, "导出", "backup.kfstore")
	if err := service.ExportArchive(ctx, opened.Generation, zipDest); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(zipDest)
	if err != nil || len(data) < 4 || string(data[:2]) != "PK" {
		t.Fatalf("zip archive: %d bytes, %v", len(data), err)
	}
	payload, err := service.ReadImportArchiveFile(ctx, zipDest)
	if err != nil || !strings.Contains(payload.Cards, "card-active") {
		t.Fatalf("roundtrip payload: %+v, %v", payload, err)
	}
	jsonDest := filepath.Join(dir, "cards.json")
	if err := service.ExportCardsJSONFile(ctx, opened.Generation, jsonDest); err != nil {
		t.Fatal(err)
	}
	text, err := os.ReadFile(jsonDest)
	if err != nil || !strings.Contains(string(text), "card-active") {
		t.Fatalf("cards json export: %s, %v", text, err)
	}
	if err := service.ExportArchive(ctx, opened.Generation, ""); err == nil {
		t.Fatal("empty destination accepted")
	}
}
