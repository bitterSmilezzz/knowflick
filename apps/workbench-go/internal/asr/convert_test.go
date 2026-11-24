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
	output, err := ToWAV16kMono(t.Context(), input)
	if err != nil || output != input {
		t.Fatalf("wav passthrough: %q, %v", output, err)
	}
}

func TestToWAV16kMonoRejectsUnconvertibleAudio(t *testing.T) {
	dir := t.TempDir()
	input := filepath.Join(dir, "broken.mp3")
	if err := os.WriteFile(input, []byte("not really audio"), 0600); err != nil {
		t.Fatal(err)
	}
	output, err := ToWAV16kMono(t.Context(), input)
	if err == nil {
		_ = os.Remove(output)
		t.Fatal("converter accepted a fake mp3")
	}
	if !strings.Contains(err.Error(), "无法转换") {
		t.Fatalf("error: %v", err)
	}
	if _, statErr := os.Stat(filepath.Join(dir, "knowflick-asr")); statErr == nil {
		t.Fatal("unexpected output left behind")
	}
}
