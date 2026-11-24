package archive

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"io"
	"os"
	"slices"
	"testing"
	"time"
)

func systemFixture() SystemSnapshotV4 {
	return SystemSnapshotV4{
		Cards:          json.RawMessage(`[{"id":"card-1","headline":"迁移测试","createdAt":1700000000000}]`),
		Materials:      json.RawMessage(`[{"id":"material-1","mediaPath":"media/image/test.png","sourceType":"image"}]`),
		Artifacts:      json.RawMessage(`[{"id":"artifact-1","sourceCardIds":["card-1"]}]`),
		Notes:          json.RawMessage(`[{"id":"note-1","title":"笔记","bodyMd":"正文","tags":["备份"],"createdAt":1700000000000,"updatedAt":1700000000000}]`),
		KnowledgeBases: json.RawMessage(`{"knowledgeBases":[{"id":"kb-1","name":"测试库"}],"membership":{"kb-1\nnote-1":1700000000000}}`),
		Settings:       `{"ui":{"theme":"dark"},"sync":{"username":"demo","password":"fixture-only"}}`,
		Media:          map[string][]byte{"media/image/test.png": {0x89, 0x50, 0x4e, 0x47, 0, 0xff, 0x80}},
	}
}

func TestWriteSystemBackupV4(t *testing.T) {
	var output bytes.Buffer
	if err := WriteSystemBackupV4(&output, systemFixture(), time.UnixMilli(1700000000123)); err != nil {
		t.Fatal(err)
	}
	reader, err := zip.NewReader(bytes.NewReader(output.Bytes()), int64(output.Len()))
	if err != nil {
		t.Fatal(err)
	}
	gotNames := make([]string, 0, len(reader.File))
	for _, entry := range reader.File {
		if entry.Flags&8 != 0 || entry.Method != zip.Store {
			t.Fatalf("entry %s is incompatible with the local-header reader", entry.Name)
		}
		file, err := entry.Open()
		if err != nil {
			t.Fatal(err)
		}
		_, readErr := io.Copy(io.Discard, file)
		file.Close()
		if readErr != nil {
			t.Fatal(readErr)
		}
		gotNames = append(gotNames, entry.Name)
	}
	wantNames := []string{"manifest.json", "cards.json", "materials.json", "artifacts.json", "notes.json", "knowledge_bases.json", "settings.json", "media/image/test.png"}
	if !slices.Equal(gotNames, wantNames) {
		t.Fatalf("unexpected archive entries: %v", gotNames)
	}
	if dest := os.Getenv("KF_GO_SYSTEM_BACKUP_FIXTURE"); dest != "" {
		if err := os.WriteFile(dest, output.Bytes(), 0o600); err != nil {
			t.Fatal(err)
		}
	}
}

func TestWriteSystemBackupV4RejectsInvalidInputsBeforeWriting(t *testing.T) {
	cases := map[string]func(*SystemSnapshotV4){
		"missing cards": func(s *SystemSnapshotV4) { s.Cards = nil },
		"null notes":    func(s *SystemSnapshotV4) { s.Notes = json.RawMessage("null") },
		"invalid membership": func(s *SystemSnapshotV4) {
			s.KnowledgeBases = json.RawMessage(`{"knowledgeBases":[],"membership":[] }`)
		},
		"noncanonical knowledge bases field": func(s *SystemSnapshotV4) {
			s.KnowledgeBases = json.RawMessage(`{"KnowledgeBases":[],"membership":{}}`)
		},
		"unsafe attachment path": func(s *SystemSnapshotV4) { s.Media["media/image/.."] = []byte{1} },
		"credential entry":       func(s *SystemSnapshotV4) { s.Media["credentials/apiKey.credential"] = []byte{1} },
	}
	for name, change := range cases {
		t.Run(name, func(t *testing.T) {
			snapshot := systemFixture()
			change(&snapshot)
			var output bytes.Buffer
			if err := WriteSystemBackupV4(&output, snapshot, time.Now()); err == nil || output.Len() != 0 {
				t.Fatal("invalid snapshot must fail before emitting an archive")
			}
		})
	}
}
