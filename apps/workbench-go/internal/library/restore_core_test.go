package library

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"knowflick.local/workbench-go/internal/archive"
)

func TestRestoreCoreBackupIntoEmptyLibrary(t *testing.T) {
	source := os.Getenv("KF_SYSTEM_BACKUP_DB_FIXTURE_DIR")
	target := os.Getenv("KF_GO_RESTORE_TARGET_DIR")
	if source == "" || target == "" {
		t.Skip("set KF_SYSTEM_BACKUP_DB_FIXTURE_DIR and KF_GO_RESTORE_TARGET_DIR")
	}
	sourceDir := t.TempDir()
	sourceDB := filepath.Join(sourceDir, "knowflick.db")
	copyFileForTest(t, filepath.Join(source, "knowflick.db"), sourceDB)
	writeFixtureFile(t, filepath.Join(sourceDir, "media/image/material.png"), []byte{0x89, 0x50, 0x4e, 0x47, 0xff})
	writeFixtureFile(t, filepath.Join(sourceDir, "media/ink/note.json"), []byte("{\"strokes\":[]}"))
	writeFixtureFile(t, filepath.Join(sourceDir, "search_history.json"), []byte("[\"迁移测试\",\"备份\"]"))
	writeFixtureFile(t, filepath.Join(sourceDir, "settings.json"), []byte("{\"ui\":{\"theme\":\"dark\"},\"sync\":{\"password\":\"fixture-value\",\"username\":\"demo\"}}"))
	repo, err := OpenForWrite(context.Background(), sourceDB)
	if err != nil {
		t.Fatal(err)
	}
	defer repo.Close()
	var output bytes.Buffer
	if err := repo.WriteSystemBackupV4(context.Background(), &output, sourceDir, time.UnixMilli(1700000000000)); err != nil {
		t.Fatal(err)
	}
	backup, err := archive.ReadSystemBackup(output.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	restoreDir := t.TempDir()
	restoreDB := filepath.Join(restoreDir, "knowflick.db")
	copyFileForTest(t, filepath.Join(target, "knowflick.db"), restoreDB)
	restored, err := OpenForWrite(context.Background(), restoreDB)
	if err != nil {
		t.Fatal(err)
	}
	defer restored.Close()
	counts, err := restored.RestoreCoreBackup(context.Background(), backup, restoreDir)
	if err != nil {
		t.Fatal(err)
	}
	if counts.Materials != 1 || counts.Cards != 1 || counts.Artifacts != 1 || counts.Media != 2 || counts.Skipped != 0 {
		t.Fatalf("unexpected counts: %+v", counts)
	}
	again, err := restored.RestoreCoreBackup(context.Background(), backup, restoreDir)
	if err != nil {
		t.Fatal(err)
	}
	if again.Materials != 0 || again.Cards != 0 || again.Artifacts != 0 || again.Notes != 0 || again.Revisions != 0 ||
		again.KnowledgeBases != 0 || again.Membership != 0 || again.Skipped != 11 {
		t.Fatalf("second restore should skip existing rows: %+v", again)
	}
	var headline, tags string
	if err := restored.db.QueryRowContext(context.Background(), "SELECT headline, tags_json FROM cards WHERE id = 'card-active'").Scan(&headline, &tags); err != nil {
		t.Fatal(err)
	}
	if headline != "活动卡片" || tags != "[\"标签\"]" {
		t.Fatalf("restored card differs: %q %q", headline, tags)
	}
	var noteCount int
	if err := restored.db.QueryRowContext(context.Background(), "SELECT COUNT(*) FROM notes").Scan(&noteCount); err != nil {
		t.Fatal(err)
	}
	if noteCount != 2 {
		t.Fatalf("notes restored: %d", noteCount)
	}
	var deletedNotes, revisionCount, membershipCount int
	if err := restored.db.QueryRowContext(context.Background(), "SELECT COUNT(*) FROM notes WHERE is_deleted = 1").Scan(&deletedNotes); err != nil {
		t.Fatal(err)
	}
	if deletedNotes != 1 {
		t.Fatalf("deleted note lost its tombstone: %d", deletedNotes)
	}
	if err := restored.db.QueryRowContext(context.Background(), "SELECT COUNT(*) FROM note_revisions").Scan(&revisionCount); err != nil {
		t.Fatal(err)
	}
	if revisionCount != 3 {
		t.Fatalf("revisions: %d", revisionCount)
	}
	if err := restored.db.QueryRowContext(context.Background(), "SELECT COUNT(*) FROM kb_membership").Scan(&membershipCount); err != nil {
		t.Fatal(err)
	}
	if membershipCount != 2 {
		t.Fatalf("membership: %d", membershipCount)
	}
	settings, err := os.ReadFile(filepath.Join(restoreDir, "settings.json"))
	if err != nil {
		t.Fatal(err)
	}
	var gotSettings, wantSettings map[string]any
	if err := json.Unmarshal(settings, &gotSettings); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal([]byte("{\"ui\":{\"theme\":\"dark\"},\"sync\":{\"username\":\"demo\"}}"), &wantSettings); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(gotSettings, wantSettings) {
		t.Fatalf("settings: %s", settings)
	}
}

func copyFileForTest(t *testing.T, source, target string) {
	t.Helper()
	body, err := os.ReadFile(source)
	if err != nil {
		t.Skipf("fixture missing %s: %v", source, err)
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(target, body, 0o600); err != nil {
		t.Fatal(err)
	}
}
