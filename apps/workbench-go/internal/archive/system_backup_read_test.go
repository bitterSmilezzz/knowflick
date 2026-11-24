package archive

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"os"
	"slices"
	"strings"
	"testing"
	"time"
)

func buildZip(t *testing.T, files map[string][]byte, deflate []string) []byte {
	t.Helper()
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	names := make([]string, 0, len(files))
	for name := range files {
		names = append(names, name)
	}
	slices.Sort(names)
	for _, name := range names {
		method := zip.Store
		if slices.Contains(deflate, name) {
			method = zip.Deflate
		}
		entry, err := writer.CreateHeader(&zip.FileHeader{Name: name, Method: method})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := entry.Write(files[name]); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

func minimalV4(t *testing.T) map[string][]byte {
	t.Helper()
	snapshot := SystemSnapshotV4{
		Cards:          json.RawMessage("[{\"id\":\"card-1\"}]"),
		Materials:      json.RawMessage("[{\"id\":\"material-1\",\"mediaPath\":\"media/ink/a.json\"}]"),
		Artifacts:      json.RawMessage("[]"),
		Notes:          json.RawMessage("[]"),
		KnowledgeBases: json.RawMessage("{\"knowledgeBases\":[],\"membership\":{}}"),
		Settings:       "{}",
		Media:          map[string][]byte{"media/ink/a.json": []byte("{}\n")},
	}
	var output bytes.Buffer
	if err := WriteSystemBackupV4(&output, snapshot, time.UnixMilli(1700000000000)); err != nil {
		t.Fatal(err)
	}
	reader, err := zip.NewReader(bytes.NewReader(output.Bytes()), int64(output.Len()))
	if err != nil {
		t.Fatal(err)
	}
	files := map[string][]byte{}
	for _, entry := range reader.File {
		file, err := entry.Open()
		if err != nil {
			t.Fatal(err)
		}
		var buf bytes.Buffer
		if _, err := buf.ReadFrom(file); err != nil {
			t.Fatal(err)
		}
		file.Close()
		files[entry.Name] = buf.Bytes()
	}
	return files
}

func TestReadSystemBackupAcceptsGoExport(t *testing.T) {
	files := minimalV4(t)
	backup, err := ReadSystemBackup(buildZip(t, files, nil))
	if err != nil {
		t.Fatal(err)
	}
	if backup.SchemaVersion != 4 || len(backup.Media) != 1 || string(backup.Cards) == "" {
		t.Fatalf("unexpected backup: %+v", backup)
	}
}

func TestReadSystemBackupRejectsTamperingAndUnsupportedEntries(t *testing.T) {
	files := minimalV4(t)
	tampered := map[string][]byte{}
	for name, body := range files {
		tampered[name] = body
	}
	tampered["cards.json"] = append(tampered["cards.json"], 0x20)
	if _, err := ReadSystemBackup(buildZip(t, tampered, nil)); err == nil || !strings.Contains(err.Error(), "校验和不匹配") {
		t.Fatalf("tampered cards accepted: %v", err)
	}
	withSecret := map[string][]byte{}
	for name, body := range files {
		withSecret[name] = body
	}
	withSecret["credentials/apiKey.credential"] = []byte("secret")
	if _, err := ReadSystemBackup(buildZip(t, withSecret, nil)); err == nil || !strings.Contains(err.Error(), "不支持的条目") {
		t.Fatalf("credential entry accepted: %v", err)
	}
	if _, err := ReadSystemBackup(buildZip(t, files, []string{"cards.json"})); err == nil || !strings.Contains(err.Error(), "压缩方式") {
		t.Fatalf("deflate entry accepted: %v", err)
	}
	wrongStats := map[string][]byte{}
	for name, body := range files {
		wrongStats[name] = body
	}
	var manifest map[string]any
	if err := json.Unmarshal(wrongStats["manifest.json"], &manifest); err != nil {
		t.Fatal(err)
	}
	manifest["stats"].(map[string]any)["cards"] = 2.0
	encoded, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	wrongStats["manifest.json"] = encoded
	if _, err := ReadSystemBackup(buildZip(t, wrongStats, nil)); err == nil || !strings.Contains(err.Error(), "计数对不上") {
		t.Fatalf("wrong stats accepted: %v", err)
	}
}

func TestLegacyFNVMatchesFrontend(t *testing.T) {
	if got := legacyFNV([]byte("备份示例 mixed")); got != "2d610d15" {
		t.Fatalf("legacy FNV = %s", got)
	}
}

func TestReadSystemBackupAcceptsFullV11Fixture(t *testing.T) {
	path := os.Getenv("KF_GO_SQLITE_BACKUP_FIXTURE")
	if path == "" {
		t.Skip("set KF_GO_SQLITE_BACKUP_FIXTURE")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	backup, err := ReadSystemBackup(data)
	if err != nil {
		t.Fatal(err)
	}
	if backup.SchemaVersion != 11 || len(backup.Media) != 2 || len(backup.DeletedRecords) == 0 || len(backup.Mail) == 0 {
		t.Fatalf("unexpected v11 backup: %+v", backup)
	}
}
