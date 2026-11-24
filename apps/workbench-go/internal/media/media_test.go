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

func TestReadRejectsSymlinksThatLeaveMedia(t *testing.T) {
	dir := t.TempDir()
	outside := filepath.Join(dir, "outside")
	if err := os.Mkdir(outside, 0o700); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(outside, "image.png")
	if err := os.WriteFile(file, []byte("outside media"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Run("media root", func(t *testing.T) {
		root := t.TempDir()
		if err := os.Symlink(outside, filepath.Join(root, "media")); err != nil {
			t.Skipf("symlinks unavailable: %v", err)
		}
		if _, err := Read(root, "media/image.png"); err == nil {
			t.Fatal("read followed a symlink in place of the media root")
		}
	})
	t.Run("file in media", func(t *testing.T) {
		folder := filepath.Join(dir, "media", "image")
		if err := os.MkdirAll(folder, 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.Symlink(file, filepath.Join(folder, "image.png")); err != nil {
			t.Skipf("symlinks unavailable: %v", err)
		}
		if _, err := Read(dir, "media/image/image.png"); err == nil {
			t.Fatal("read followed a symlink outside the media root")
		}
	})
}

func TestSaveRejectsSymlinkInAttachmentDirectory(t *testing.T) {
	for _, relative := range []string{"media", "media/image"} {
		t.Run(relative, func(t *testing.T) {
			root, outside := t.TempDir(), t.TempDir()
			link := filepath.Join(root, filepath.FromSlash(relative))
			if err := os.MkdirAll(filepath.Dir(link), 0700); err != nil {
				t.Fatal(err)
			}
			if err := os.Symlink(outside, link); err != nil {
				t.Skipf("symlinks unavailable: %v", err)
			}
			if _, err := Save(root, "image", "image/png", []byte("image")); err == nil {
				t.Fatal("accepted symlinked media directory")
			}
			entries, err := os.ReadDir(outside)
			if err != nil || len(entries) != 0 {
				t.Fatalf("write escaped into symlink target: %v, %v", entries, err)
			}
		})
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

func TestRestoreKeepsRelativePathAndIsIdempotent(t *testing.T) {
	dir := t.TempDir()
	rel := "media/image/backup-fixed.png"
	payload := []byte("backup bytes with fixed name")
	got, err := Restore(dir, rel, payload)
	if err != nil || got != rel {
		t.Fatalf("restore: %q %v", got, err)
	}
	read, err := Read(dir, rel)
	if err != nil || !bytes.Equal(read, payload) {
		t.Fatalf("read back: %q %v", read, err)
	}
	// 同内容重复恢复：幂等成功，不覆盖。
	if again, err := Restore(dir, rel, payload); err != nil || again != rel {
		t.Fatalf("idempotent restore: %q %v", again, err)
	}
	// 同路径不同内容：明确拒绝，绝不覆盖（备份重放的保守口径）。
	if _, err := Restore(dir, rel, []byte("different")); err == nil {
		t.Fatal("overwrote an existing attachment with different content")
	}
	read, _ = Read(dir, rel)
	if !bytes.Equal(read, payload) {
		t.Fatalf("existing attachment was modified: %q", read)
	}
}

func TestRestoreRejectsUnsafePaths(t *testing.T) {
	dir := t.TempDir()
	for _, rel := range []string{
		"media/image/../escape.png",
		"media/image/sub/x.png",
		"media/image/x.exe",
		"media/audio/x.json",
		"/media/image/x.png",
		"media\\image\\x.png",
	} {
		if _, err := Restore(dir, rel, []byte("x")); err == nil {
			t.Fatalf("accepted unsafe backup path %q", rel)
		}
	}
}

// TestExportRestoreFixture 生成由 Go 恢复（保持原路径）的附件夹具。
func TestExportRestoreFixture(t *testing.T) {
	target := os.Getenv("KF_GO_RESTORE_FIXTURE")
	if target == "" {
		t.Skip("set KF_GO_RESTORE_FIXTURE to export the restore fixture")
	}
	if _, err := os.Lstat(target); !os.IsNotExist(err) {
		t.Fatalf("fixture dir must not exist: %v", err)
	}
	rel := "media/image/fixed-restore.png"
	if got, err := Restore(target, rel, []byte("go-restored-payload")); err != nil || got != rel {
		t.Fatalf("restore export: %q %v", got, err)
	}
}

func TestListReturnsReusableAttachments(t *testing.T) {
	dir := t.TempDir()
	relative, err := Save(dir, "image", "image/png", []byte{1, 2, 3})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "media", "image", "notes.txt"), []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	items, err := List(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].Path != relative || !strings.HasPrefix(items[0].Label, "图片 · ") {
		t.Fatalf("attachments: %+v", items)
	}
}
