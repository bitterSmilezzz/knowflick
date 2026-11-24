package main

import (
	"os"
	"path/filepath"
	"testing"

	"knowflick.local/workbench-go/internal/archive"
)

func TestPackCardArchiveUsesLibrarySettings(t *testing.T) {
	dir := t.TempDir()
	const cards = `[{"id":"card-1"}]`
	settingsPath := filepath.Join(dir, "settings.json")
	assertSettings := func(want string) {
		t.Helper()
		data, err := packCardArchive(dir, cards)
		if err != nil {
			t.Fatal(err)
		}
		payload, err := archive.Read(data)
		if err != nil {
			t.Fatal(err)
		}
		if payload.Cards != cards || payload.Settings == nil || *payload.Settings != want {
			t.Fatal("archive cards or settings differ from the expected content")
		}
	}
	assertSettings("{}")
	if err := os.WriteFile(settingsPath, []byte(`{"theme":"dark","sync":{"password":"fixture-value","username":"demo"}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	assertSettings(`{"sync":{"username":"demo"},"theme":"dark"}`)
	if err := os.WriteFile(settingsPath, []byte(`{"password":"fixture-value"`), 0o600); err != nil {
		t.Fatal(err)
	}
	assertSettings("{}")
}
