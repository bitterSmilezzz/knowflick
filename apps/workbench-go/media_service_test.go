package main

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSaveMediaCaptureAndReadBack(t *testing.T) {
	service, _ := openFixtureCopy(t)
	ctx := t.Context()
	opened, err := service.OpenInitialLibrary(ctx)
	if err != nil {
		t.Fatal(err)
	}
	data := []byte("PNGDATA-STUB")
	encoded := base64.StdEncoding.EncodeToString(data)
	path, err := service.SaveMediaCapture(ctx, opened.Generation, "image", "image/png", encoded)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(path, "media/image/") {
		t.Fatalf("saved path: %q", path)
	}
	full := filepath.Join(filepath.Dir(service.path), path)
	if _, err := os.Stat(full); err != nil {
		t.Fatalf("saved file: %v", err)
	}
	back, err := service.ReadMediaBytes(ctx, opened.Generation, path)
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := base64.StdEncoding.DecodeString(back)
	if err != nil || string(decoded) != "PNGDATA-STUB" {
		t.Fatalf("read back: %q %v", decoded, err)
	}
	audioPath, err := service.SaveMediaCapture(ctx, opened.Generation, "audio", `audio/mp4; codecs="mp4a.40.2"`, encoded)
	if err != nil || !strings.HasSuffix(audioPath, ".m4a") {
		t.Fatalf("parameterized MP4 recording: %q, %v", audioPath, err)
	}
	// 逃逸路径被拒绝。
	if _, err := service.ReadMediaBytes(ctx, opened.Generation, "../cards.json"); err == nil {
		t.Fatal("path escape accepted")
	}
	if _, err := service.SaveMediaCapture(ctx, 99, "image", "image/png", encoded); err == nil {
		t.Fatal("stale generation accepted")
	}
}
