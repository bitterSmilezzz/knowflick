package asr

import (
	"context"
	"encoding/binary"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCatalogMatchesRust(t *testing.T) {
	want := map[string]struct {
		file string
		size int64
	}{
		"tiny":  {"ggml-tiny.bin", 77_700_000},
		"base":  {"ggml-base.bin", 147_900_000},
		"small": {"ggml-small.bin", 487_600_000},
	}
	if len(Catalog) != len(want) {
		t.Fatalf("catalog size %d", len(Catalog))
	}
	for _, entry := range Catalog {
		expected, ok := want[entry.Name]
		if !ok || expected.file != entry.File || expected.size != entry.ExpectedSize {
			t.Fatalf("catalog entry drifted: %+v", entry)
		}
	}
}

func TestStatusTreatsNonEmptyFileAsInstalled(t *testing.T) {
	dir := t.TempDir()
	status, err := ModelStatus(dir, "tiny")
	if err != nil || status.Installed || status.Path != nil {
		t.Fatalf("missing model: %+v %v", status, err)
	}
	path, err := ModelPath(dir, "tiny")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("fake weights"), 0644); err != nil {
		t.Fatal(err)
	}
	status, err = ModelStatus(dir, "tiny")
	if err != nil || !status.Installed || status.Path == nil || status.SizeBytes != 12 {
		t.Fatalf("installed model: %+v %v", status, err)
	}
	if status.ExpectedBytes != 77_700_000 {
		t.Fatalf("expected bytes: %d", status.ExpectedBytes)
	}
	if _, err := ModelStatus(dir, "huge"); err == nil || !strings.Contains(err.Error(), "未知的语音模型") {
		t.Fatalf("unknown model: %v", err)
	}
}

// writeWAV 造一个 16-bit 单声道 WAV，采样为给定的 int16 值。
func writeWAV(t *testing.T, path string, samples []int16) {
	t.Helper()
	data := make([]byte, len(samples)*2)
	for i, s := range samples {
		binary.LittleEndian.PutUint16(data[i*2:], uint16(s))
	}
	var buf []byte
	buf = append(buf, []byte("RIFF")...)
	buf = binary.LittleEndian.AppendUint32(buf, uint32(36+len(data)))
	buf = append(buf, []byte("WAVEfmt ")...)
	buf = binary.LittleEndian.AppendUint32(buf, 16)
	buf = binary.LittleEndian.AppendUint16(buf, 1)
	buf = binary.LittleEndian.AppendUint16(buf, 1)
	buf = binary.LittleEndian.AppendUint32(buf, 16000)
	buf = binary.LittleEndian.AppendUint32(buf, 32000)
	buf = binary.LittleEndian.AppendUint16(buf, 2)
	buf = binary.LittleEndian.AppendUint16(buf, 16)
	buf = append(buf, []byte("data")...)
	buf = binary.LittleEndian.AppendUint32(buf, uint32(len(data)))
	buf = append(buf, data...)
	if err := os.WriteFile(path, buf, 0644); err != nil {
		t.Fatal(err)
	}
}

func TestReadWAVMonoF32(t *testing.T) {
	path := filepath.Join(t.TempDir(), "a.wav")
	writeWAV(t, path, []int16{0, 16384, -32768, 8192})
	samples, err := ReadWAVMonoF32(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(samples) != 4 {
		t.Fatalf("samples: %d", len(samples))
	}
	if samples[0] != 0 || samples[1] != 0.5 || samples[2] != -1 || samples[3] != 0.25 {
		t.Fatalf("decoded: %v", samples)
	}
}

func TestReadWAVRejectsNonWAVAndWrongDepth(t *testing.T) {
	dir := t.TempDir()
	bad := filepath.Join(dir, "bad.wav")
	if err := os.WriteFile(bad, []byte("not a wav at all"), 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := ReadWAVMonoF32(bad); err == nil || !strings.Contains(err.Error(), "不是合法的 WAV") {
		t.Fatalf("non-wav accepted: %v", err)
	}
	deep := filepath.Join(dir, "deep.wav")
	writeWAV(t, deep, []int16{1, 2})
	bytes, err := os.ReadFile(deep)
	if err != nil {
		t.Fatal(err)
	}
	// 把 fmt 块里的 bitsPerSample 从 16 改成 24：位深不支持必须报错，不能猜。
	if i := strings.Index(string(bytes), "fmt "); i >= 0 {
		binary.LittleEndian.PutUint16(bytes[i+8+14:], 24)
	}
	if err := os.WriteFile(deep, bytes, 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := ReadWAVMonoF32(deep); err == nil || !strings.Contains(err.Error(), "16-bit") {
		t.Fatalf("24-bit accepted: %v", err)
	}
}

func TestDownloadWritesPartThenRenames(t *testing.T) {
	payload := []byte("fake ggml weights")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write(payload)
	}))
	defer server.Close()
	target := filepath.Join(t.TempDir(), "models", "ggml-tiny.bin")
	var progressCalls int
	done, err := Download(context.Background(), server.URL, target, func(int64, int64) { progressCalls++ })
	if err != nil {
		t.Fatal(err)
	}
	if done != int64(len(payload)) || progressCalls == 0 {
		t.Fatalf("done %d progress %d", done, progressCalls)
	}
	if _, err := os.Stat(target + ".part"); !os.IsNotExist(err) {
		t.Fatal(".part left behind")
	}
	stored, err := os.ReadFile(target)
	if err != nil || string(stored) != string(payload) {
		t.Fatalf("stored bytes: %q %v", stored, err)
	}
}

func TestDownloadRejectsExternalHTTPAndCleansPart(t *testing.T) {
	target := filepath.Join(t.TempDir(), "models", "ggml-tiny.bin")
	if _, err := Download(context.Background(), "http://example.com/x.bin", target, nil); err == nil {
		t.Fatal("non-loopback http accepted")
	}
	if _, err := os.Stat(target + ".part"); !os.IsNotExist(err) {
		t.Fatal(".part left behind after rejection")
	}
}

// TestTranscribeEndToEnd 需要真实模型与音频：设 KF_ASR_MODEL 与 KF_ASR_WAV。
// 默认跳过——CI 不装 77 MB 权重。
func TestTranscribeEndToEnd(t *testing.T) {
	modelPath := os.Getenv("KF_ASR_MODEL")
	wavPath := os.Getenv("KF_ASR_WAV")
	if modelPath == "" || wavPath == "" {
		t.Skip("set KF_ASR_MODEL and KF_ASR_WAV for the end-to-end check")
	}
	result, err := Transcribe(context.Background(), modelPath, wavPath, "tiny")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(strings.ToLower(result.Text), "speech recognition") {
		t.Fatalf("unexpected transcript: %q", result.Text)
	}
	if result.AudioMS <= 0 || result.ElapsedMS <= 0 || result.Model != "tiny" {
		t.Fatalf("result metadata: %+v", result)
	}
	t.Logf("transcript=%q audioMs=%d elapsedMs=%d", result.Text, result.AudioMS, result.ElapsedMS)
}

// TestExportTranscription 导出 Go 的转写结果，供 Rust 侧对拍同一段音频。
func TestExportTranscription(t *testing.T) {
	target := os.Getenv("KF_GO_ASR_FIXTURE")
	modelPath := os.Getenv("KF_ASR_MODEL")
	wavPath := os.Getenv("KF_ASR_WAV")
	if target == "" || modelPath == "" || wavPath == "" {
		t.Skip("set KF_GO_ASR_FIXTURE, KF_ASR_MODEL and KF_ASR_WAV")
	}
	result, err := Transcribe(context.Background(), modelPath, wavPath, "tiny")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(target, []byte(result.Text), 0644); err != nil {
		t.Fatal(err)
	}
}
