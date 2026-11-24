package main

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"testing"
)

func TestSaveFileBytesWritesArchiveBytes(t *testing.T) {
	dest := filepath.Join(t.TempDir(), "nested", "backup.kfbackup")
	data := []byte("PK\x03\x04fake-archive")
	if got, err := (&PreviewService{}).SaveFileBytes(dest, base64.StdEncoding.EncodeToString(data)); err != nil || got != dest {
		t.Fatalf("save bytes: %q, %v", got, err)
	}
	written, err := os.ReadFile(dest)
	if err != nil || string(written) != string(data) {
		t.Fatalf("written bytes: %q, %v", written, err)
	}
	for _, bad := range []struct{ dest, data string }{
		{"", base64.StdEncoding.EncodeToString(data)},
		{"relative.kfbackup", base64.StdEncoding.EncodeToString(data)},
		{dest, "not-base64"},
		{dest, ""},
	} {
		if _, err := (&PreviewService{}).SaveFileBytes(bad.dest, bad.data); err == nil {
			t.Fatalf("accepted invalid export %+v", bad)
		}
	}
}
