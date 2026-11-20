package media

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSaveReadRoundTripAndPathSafety(t *testing.T) {
	dir := t.TempDir()
	payload := make([]byte, 0, 256)
	for i := 0; i < 256; i++ {
		payload = append(payload, byte(i))
	}
	relative, err := Save(dir, "audio", "audio/webm", payload)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(relative, "media/audio/") || !strings.HasSuffix(relative, ".webm") {
		t.Fatalf("unexpected relative path %q", relative)
	}
	got, err := Read(dir, relative)
	if err != nil || !bytes.Equal(got, payload) {
		t.Fatalf("round trip: %d bytes, err=%v", len(got), err)
	}
	entries, err := os.ReadDir(filepath.Join(dir, "media", "audio"))
	if err != nil || len(entries) != 1 {
		t.Fatalf("temp left behind: %v %v", entries, err)
	}
	for _, bad := range []string{"", "/etc/passwd", "../outside", "media/../secret", "media\\audio\\x", "media/audio/../../x"} {
		if _, err := Read(dir, bad); err == nil {
			t.Fatalf("accepted unsafe path %q", bad)
		}
	}
}

func TestKindMimeAndSizeGuards(t *testing.T) {
	dir := t.TempDir()
	if _, err := Save(dir, "audio", "application/json", []byte("x")); err == nil {
		t.Fatal("mismatched kind/mime accepted")
	}
	if _, err := Save(dir, "image", "image/png", nil); err == nil {
		t.Fatal("empty payload accepted")
	}
	big := bytes.Repeat([]byte("x"), MaxInk+1)
	if _, err := Save(dir, "ink", "application/json", big); err == nil {
		t.Fatal("oversized ink accepted")
	}
	if relative, err := Save(dir, "ink", "application/json", []byte("{}")); err != nil || !strings.HasSuffix(relative, ".json") {
		t.Fatalf("ink save: %q %v", relative, err)
	}
}

// TestExportMediaFixture 生成由 Go 写入的附件，供 Rust 读回对拍。
func TestExportMediaFixture(t *testing.T) {
	target := os.Getenv("KF_GO_MEDIA_FIXTURE")
	if target == "" {
		t.Skip("set KF_GO_MEDIA_FIXTURE to export the media fixture")
	}
	if _, err := os.Lstat(target); !os.IsNotExist(err) {
		t.Fatalf("fixture dir must not exist: %v", err)
	}
	payload := make([]byte, 0, 256)
	for i := 0; i < 256; i++ {
		payload = append(payload, byte(i))
	}
	relative, err := Save(target, "audio", "audio/webm", payload)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(target, "relative.txt"), []byte(relative), 0644); err != nil {
		t.Fatal(err)
	}
}

// TestReadRustWrittenMedia 读回 Rust 写入的附件，验证跨运行时一致。
func TestReadRustWrittenMedia(t *testing.T) {
	target := os.Getenv("KF_RUST_MEDIA_FIXTURE")
	if target == "" {
		t.Skip("set KF_RUST_MEDIA_FIXTURE to the Rust-written media fixture")
	}
	entries, err := os.ReadDir(filepath.Join(target, "media", "image"))
	if err != nil || len(entries) == 0 {
		t.Fatalf("no Rust-written attachment: %v %v", entries, err)
	}
	got, err := Read(target, "media/image/"+entries[0].Name())
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, []byte("rust-cross-runtime-media")) {
		t.Fatalf("payload mismatch: %q", got)
	}
}
