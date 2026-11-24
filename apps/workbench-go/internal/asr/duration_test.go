package asr

import (
	"os"
	"path/filepath"
	"testing"
)

func TestProbeDurationReadsWavHeader(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "tone.wav")
	// 16 kHz、单声道、16-bit PCM：byteRate = 32000；8000 字节数据 = 250ms。
	header := []byte("RIFF\x24\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00\x80\x3e\x00\x00\x00\x7d\x00\x00\x02\x00\x10\x00data\x40\x1f\x00\x00")
	if err := os.WriteFile(path, header, 0600); err != nil {
		t.Fatal(err)
	}
	if ms, ok := ProbeDurationMS(path); !ok || ms != 250 {
		t.Fatalf("wav duration: %d, %v", ms, ok)
	}
	if _, ok := ProbeDurationMS(filepath.Join(dir, "missing.wav")); ok {
		t.Fatal("missing file reported a duration")
	}
}

func TestProbeDurationReadsCompressedAudioWhenAvailable(t *testing.T) {
	path := os.Getenv("KF_GO_AUDIO_FIXTURE")
	if path == "" {
		t.Skip("set KF_GO_AUDIO_FIXTURE to a real compressed audio file")
	}
	ms, ok := ProbeDurationMS(path)
	if !ok || ms < 1000 {
		t.Fatalf("compressed audio duration: %d, %v", ms, ok)
	}
	t.Logf("duration=%d ms", ms)
}
