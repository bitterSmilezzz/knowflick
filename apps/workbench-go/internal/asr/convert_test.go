package asr

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestToWAV16kMonoKeepsWavAsIs(t *testing.T) {
	dir := t.TempDir()
	input := filepath.Join(dir, "voice.WAV")
	if err := os.WriteFile(input, []byte("RIFFdata"), 0600); err != nil {
		t.Fatal(err)
	}
	output, err := ToWAV16kMono(input)
	if err != nil || output != input {
		t.Fatalf("wav passthrough: %q, %v", output, err)
	}
}

func TestToWAV16kMonoRejectsUnconvertibleAudio(t *testing.T) {
	if !isDarwin() {
		t.Skip("非 macOS 没有内置转换器，与桌面端一致")
	}
	dir := t.TempDir()
	input := filepath.Join(dir, "broken.mp3")
	if err := os.WriteFile(input, []byte("not really audio"), 0600); err != nil {
		t.Fatal(err)
	}
	output, err := ToWAV16kMono(input)
	if err == nil {
		_ = os.Remove(output)
		t.Fatal("afconvert accepted a fake mp3")
	}
	if !strings.Contains(err.Error(), "无法转换") {
		t.Fatalf("error: %v", err)
	}
	if _, statErr := os.Stat(filepath.Join(dir, "knowflick-asr")); statErr == nil {
		t.Fatal("unexpected output left behind")
	}
}
