package library

import (
	"archive/zip"
	"bytes"
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestWriteSystemBackupV4FromRustDatabase(t *testing.T) {
	source := os.Getenv("KF_SYSTEM_BACKUP_DB_FIXTURE_DIR")
	if source == "" {
		t.Skip("set KF_SYSTEM_BACKUP_DB_FIXTURE_DIR to the Rust-created database fixture")
	}
	dir := t.TempDir()
	path := filepath.Join(dir, "knowflick.db")
	writeFixtureFile(t, path, readFixtureFile(t, filepath.Join(source, "knowflick.db")))
	repo, err := Open(t.Context(), path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = repo.Close() })

	material := []byte{0x89, 0x50, 0x4e, 0x47, 0xff}
	ink := []byte(`{"strokes":[]}`)
	writeFixtureFile(t, filepath.Join(dir, "media", "image", "material.png"), material)
	writeFixtureFile(t, filepath.Join(dir, "settings.json"), []byte(`{"ui":{"theme":"dark"},"sync":{"password":"fixture-value","username":"demo"}}`))
	var output bytes.Buffer
	at := time.UnixMilli(1_700_000_000_123)
	if err := repo.WriteSystemBackupV4(t.Context(), &output, dir, at); err == nil || !strings.Contains(err.Error(), "media/ink/note.json") || output.Len() != 0 {
		t.Fatalf("missing attachment should abort the export before writing: %v", err)
	}
	writeFixtureFile(t, filepath.Join(dir, "media", "ink", "note.json"), ink)
	if err := repo.WriteSystemBackupV4(t.Context(), &output, dir, at); err != nil {
		t.Fatal(err)
	}

	reader, err := zip.NewReader(bytes.NewReader(output.Bytes()), int64(output.Len()))
	if err != nil {
		t.Fatal(err)
	}
	var rust map[string]json.RawMessage
	if err := json.Unmarshal(readFixtureFile(t, filepath.Join(source, "knowflick.json")), &rust); err != nil {
		t.Fatal(err)
	}
	for _, pair := range [][2]string{
		{"cards", "cards"}, {"materials", "materials"}, {"artifacts", "artifacts"},
		{"note_revisions", "noteRevisions"},
	} {
		assertJSONMatchesRust(t, pair[0], readZIPFixtureFile(t, reader, pair[0]+".json"), rust[pair[1]])
	}
	var bases map[string]json.RawMessage
	if err := json.Unmarshal(readZIPFixtureFile(t, reader, "knowledge_bases.json"), &bases); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"knowledgeBases", "membership"} {
		assertJSONMatchesRust(t, key, bases[key], rust[key])
	}
	if !bytes.Equal(readZIPFixtureFile(t, reader, "media/image/material.png"), material) ||
		!bytes.Equal(readZIPFixtureFile(t, reader, "media/ink/note.json"), ink) {
		t.Fatal("attachment bytes changed during export")
	}
	if dest := os.Getenv("KF_GO_SQLITE_BACKUP_FIXTURE"); dest != "" {
		writeFixtureFile(t, dest, output.Bytes())
	}

	writer, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = writer.Close() })
	for _, statement := range []struct{ corrupt, repair, expected string }{
		{`UPDATE cards SET tags_json='[null]' WHERE id='card-active'`, `UPDATE cards SET tags_json='[]' WHERE id='card-active'`, "卡片"},
		{`UPDATE cards SET links_json='[{"title":null}]' WHERE id='card-active'`, `UPDATE cards SET links_json='[]' WHERE id='card-active'`, "卡片"},
		{`UPDATE notes SET tags_json='null' WHERE id='note-active'`, `UPDATE notes SET tags_json='[]' WHERE id='note-active'`, "笔记"},
		{`UPDATE artifacts SET source_note_ids='[' WHERE id='artifact-active'`, `UPDATE artifacts SET source_note_ids='[]' WHERE id='artifact-active'`, "产物"},
	} {
		execute(t, writer, statement.corrupt)
		output.Reset()
		err := repo.WriteSystemBackupV4(t.Context(), &output, dir, at)
		if err == nil || !strings.Contains(err.Error(), statement.expected) || output.Len() != 0 {
			t.Fatalf("invalid SQLite fields should abort the export before writing: %v", err)
		}
		execute(t, writer, statement.repair)
	}
	assertJSONMatchesRust(t, "r4", readZIPFixtureFile(t, reader, "r4.json"), rust["r4"])
}

func readFixtureFile(t *testing.T, path string) []byte {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func writeFixtureFile(t *testing.T, path string, data []byte) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
}

func readZIPFixtureFile(t *testing.T, reader *zip.Reader, name string) []byte {
	t.Helper()
	data, err := reader.Open(name)
	if err != nil {
		t.Fatal(err)
	}
	defer data.Close()
	var buf bytes.Buffer
	if _, err := buf.ReadFrom(data); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func assertJSONMatchesRust(t *testing.T, location string, got, want []byte) {
	t.Helper()
	var actual, expected any
	if err := json.Unmarshal(got, &actual); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(want, &expected); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(actual, expected) {
		t.Fatalf("%s differs from Rust snapshot", location)
	}
}
