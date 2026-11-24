package embed

import (
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

func TestStatusBeforeDownload(t *testing.T) {
	dir := t.TempDir()
	s := Status(dir)
	if s.Model != LocalModelID || s.Dim != LocalModelDim || s.Downloaded {
		t.Fatalf("status: %+v", s)
	}
	if filepath.Base(s.CacheDir) != "fastembed" {
		t.Fatalf("cache dir: %s", s.CacheDir)
	}
	if err := RequireModel(dir); !errors.Is(err, ErrNotDownloaded) {
		t.Fatalf("expected ErrNotDownloaded, got %v", err)
	}
}

func TestDetectsNestedOnnxWeights(t *testing.T) {
	dir := t.TempDir()
	nested := filepath.Join(CacheDir(dir), "models--intfloat--multilingual-e5-small", "onnx")
	if err := os.MkdirAll(nested, 0755); err != nil {
		t.Fatal(err)
	}
	if IsDownloaded(dir) {
		t.Fatal("empty directory counted as downloaded")
	}
	if err := os.WriteFile(filepath.Join(nested, "model.onnx"), []byte("fake"), 0644); err != nil {
		t.Fatal(err)
	}
	if !IsDownloaded(dir) {
		t.Fatal("nested onnx not detected")
	}
	if err := RequireModel(dir); err != nil {
		t.Fatalf("RequireModel after download: %v", err)
	}
}

func TestHashEmbeddingIsDeterministicAndNormalized(t *testing.T) {
	a := HashEmbedding("知识库检索与向量", HashDim)
	b := HashEmbedding("知识库检索与向量", HashDim)
	if len(a) != HashDim {
		t.Fatalf("dim %d", len(a))
	}
	for i := range a {
		if a[i] != b[i] {
			t.Fatalf("not deterministic at %d: %v vs %v", i, a[i], b[i])
		}
	}
	norm := 0.0
	for _, v := range a {
		norm += v * v
	}
	if norm < 0.99 || norm > 1.01 {
		t.Fatalf("not L2 normalized: %v", norm)
	}
}

func TestHashEmbeddingRanksRelatedTextHigher(t *testing.T) {
	base := HashEmbedding("知识库检索与向量", HashDim)
	related := HashEmbedding("知识库检索与向量索引", HashDim)
	unrelated := HashEmbedding("今天晚饭吃什么", HashDim)
	if Cosine(base, related) <= Cosine(base, unrelated) {
		t.Fatalf("related %.4f should beat unrelated %.4f", Cosine(base, related), Cosine(base, unrelated))
	}
}

func TestHashEmbeddingEmptyInputIsZeroVector(t *testing.T) {
	for _, v := range HashEmbedding("   ", HashDim) {
		if v != 0 {
			t.Fatal("empty input produced non-zero vector")
		}
	}
}

func TestCosineEdgeCases(t *testing.T) {
	if Cosine([]float64{1, 0}, []float64{1, 0, 0}) != 0 {
		t.Fatal("length mismatch should be 0")
	}
	if Cosine([]float64{0, 0}, []float64{1, 0}) != 0 {
		t.Fatal("zero vector should be 0")
	}
	if got := Cosine([]float64{1, 0}, []float64{1, 0}); got < 0.999 || got > 1.001 {
		t.Fatalf("identical vectors: %v", got)
	}
}

// TestExportHashVector 导出哈希向量，供前端对拍同一文本的投影。
func TestExportHashVector(t *testing.T) {
	target := os.Getenv("KF_GO_HASH_FIXTURE")
	if target == "" {
		t.Skip("set KF_GO_HASH_FIXTURE to export the hash vector fixture")
	}
	vec := HashEmbedding("知识库检索与向量", HashDim)
	lines := make([]string, 0, len(vec))
	for _, v := range vec {
		lines = append(lines, formatFloat(v))
	}
	if err := os.WriteFile(target, []byte(joinLines(lines)), 0644); err != nil {
		t.Fatal(err)
	}
}

func formatFloat(v float64) string { return strconv.FormatFloat(v, 'f', 6, 64) }

func joinLines(lines []string) string { return strings.Join(lines, "\n") + "\n" }
