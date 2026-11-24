package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestReadDroppedFileReadsTextAndBinary(t *testing.T) {
	dir := t.TempDir()
	text := filepath.Join(dir, "note.md")
	if err := os.WriteFile(text, []byte("# 标题\n正文"), 0o600); err != nil {
		t.Fatal(err)
	}
	service := &PreviewService{}
	got, err := service.ReadDroppedFile(t.Context(), text)
	if err != nil {
		t.Fatal(err)
	}
	if got.Name != "note.md" || got.Text != "# 标题\n正文" || got.Mime != "text/markdown" || got.Size != int64(len("# 标题\n正文")) {
		t.Fatalf("text file: %+v", got)
	}
	if got.DataB64 != "" {
		t.Fatalf("text file should not carry base64 payload: %+v", got)
	}

	binary := filepath.Join(dir, "photo.png")
	if err := os.WriteFile(binary, []byte{0x89, 0x50, 0x4e, 0x47}, 0o600); err != nil {
		t.Fatal(err)
	}
	got, err = service.ReadDroppedFile(t.Context(), binary)
	if err != nil {
		t.Fatal(err)
	}
	if got.Text != "" || got.DataB64 == "" || got.Mime != "image/png" {
		t.Fatalf("binary file: %+v", got)
	}
}

// 一批文件里有一个读不了时，其余仍要导入：拖 5 个文件不该被 1 个坏文件拖掉。
func TestCollectDroppedFilesSkipsUnreadableEntries(t *testing.T) {
	dir := t.TempDir()
	good := filepath.Join(dir, "good.md")
	if err := os.WriteFile(good, []byte("正文"), 0o600); err != nil {
		t.Fatal(err)
	}
	service := &PreviewService{}
	dropped := service.collectDroppedFiles([]string{good, filepath.Join(dir, "missing.md"), dir})
	if len(dropped) != 1 || dropped[0].Name != "good.md" {
		t.Fatalf("collect: %+v", dropped)
	}
}

func TestReadDroppedFileRejectsIrregularPaths(t *testing.T) {
	service := &PreviewService{}
	for _, path := range []string{"", "   ", "/no/such/file.md"} {
		if _, err := service.ReadDroppedFile(t.Context(), path); err == nil {
			t.Fatalf("accepted invalid path %q", path)
		}
	}
	// 目录不是常规文件：不能读成内容。
	dir := t.TempDir()
	if _, err := service.ReadDroppedFile(t.Context(), dir); err == nil {
		t.Fatal("accepted a directory")
	}
}
