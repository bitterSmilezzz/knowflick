package library

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"knowflick.local/workbench-go/internal/archive"
)

func TestRestoreCoreBackupRebuildsNoteIndexes(t *testing.T) {
	ctx := t.Context()
	sourceDir := t.TempDir()
	source, err := Create(ctx, filepath.Join(sourceDir, "source.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer source.Close()
	for _, note := range []Note{
		{ID: "active-note", Title: "索引重建", Body: "正文：shoreline"},
		{ID: "trashed-note", Title: "回收站笔记", Body: "正文：tideline"},
	} {
		if _, err := source.Upsert(ctx, note, 0, 1000); err != nil {
			t.Fatal(err)
		}
	}
	if deleted, err := source.Delete(ctx, "trashed-note", 1100); err != nil || !deleted {
		t.Fatalf("move note to trash: %v, %v", deleted, err)
	}
	var output bytes.Buffer
	if err := source.WriteSystemBackupV4(ctx, &output, sourceDir, time.UnixMilli(2000)); err != nil {
		t.Fatal(err)
	}
	backup, err := archive.ReadSystemBackup(output.Bytes())
	if err != nil || backup.SchemaVersion != 11 || string(backup.SearchHistory) != "[]" {
		t.Fatalf("library with no searches must export a readable v11 archive: %s, %v", backup.SearchHistory, err)
	}

	targetDir := t.TempDir()
	targetPath := filepath.Join(targetDir, "target.db")
	target, err := Create(ctx, targetPath)
	if err != nil {
		t.Fatal(err)
	}
	defer target.Close()
	if counts, err := target.RestoreCoreBackup(ctx, backup, targetDir); err != nil || counts.Notes != 2 {
		t.Fatalf("restore notes: %+v, %v", counts, err)
	}
	hits, err := target.SearchChunks(ctx, "shoreline", 10)
	if err != nil || len(hits) != 1 || hits[0].NoteID != "active-note" {
		t.Fatalf("restored search hits: %+v, %v", hits, err)
	}
	if countRows(t, targetPath, "SELECT COUNT(*) FROM fts_notes WHERE note_id='active-note'") != 1 ||
		countRows(t, targetPath, "SELECT COUNT(*) FROM fts_note_chunks WHERE note_id='trashed-note'") != 0 {
		t.Fatal("restored indexes do not match the notes' deletion state")
	}

	// 复现旧 Go 写出的 v11：三个搜索历史字段都缺失。声明存在但文件缺失时仍拒绝恢复。
	if legacy, err := archive.ReadSystemBackup(omitBackupSearchHistory(t, output.Bytes(), true)); err != nil || len(legacy.SearchHistory) != 0 {
		t.Fatalf("legacy backup with no search history: %s, %v", legacy.SearchHistory, err)
	}
	if _, err := archive.ReadSystemBackup(omitBackupSearchHistory(t, output.Bytes(), false)); err == nil || !strings.Contains(err.Error(), "search_history.json") {
		t.Fatalf("declared search history missing: %v", err)
	}
}

func omitBackupSearchHistory(t *testing.T, data []byte, omitDeclarations bool) []byte {
	t.Helper()
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	var output bytes.Buffer
	writer := zip.NewWriter(&output)
	for _, file := range reader.File {
		if file.Name == "search_history.json" {
			continue
		}
		if file.Name != "manifest.json" || !omitDeclarations {
			if err := writer.Copy(file); err != nil {
				t.Fatal(err)
			}
			continue
		}
		entry, err := file.Open()
		if err != nil {
			t.Fatal(err)
		}
		var manifest map[string]json.RawMessage
		decodeErr := json.NewDecoder(entry).Decode(&manifest)
		entry.Close()
		if decodeErr != nil {
			t.Fatal(decodeErr)
		}
		for section, field := range map[string]string{"checksums": "search_history.json", "stats": "searchHistory"} {
			var values map[string]json.RawMessage
			if err := json.Unmarshal(manifest[section], &values); err != nil {
				t.Fatal(err)
			}
			delete(values, field)
			manifest[section], err = json.Marshal(values)
			if err != nil {
				t.Fatal(err)
			}
		}
		out, err := writer.CreateHeader(&zip.FileHeader{Name: file.Name, Method: zip.Store})
		if err != nil {
			t.Fatal(err)
		}
		if err := json.NewEncoder(out).Encode(manifest); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return output.Bytes()
}
