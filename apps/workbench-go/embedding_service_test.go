package main

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"knowflick.local/workbench-go/internal/dataroot"
	"knowflick.local/workbench-go/internal/embed"
)

func TestLocalEmbedWarmUpRequiresModel(t *testing.T) {
	service := &PreviewService{}
	// 指向一个空的 data root：模型必然缺失。
	t.Setenv("KNOWFLICK_DEBUG_DATA_ROOT", t.TempDir())
	_, err := service.LocalEmbedWarmUp(t.Context())
	if !errors.Is(err, embed.ErrNotDownloaded) {
		t.Fatalf("warm-up without model: %v", err)
	}
	status, err := service.LocalEmbedStatus(t.Context())
	if err != nil || status.Downloaded || status.Model != embed.LocalModelID || status.Dim != embed.LocalModelDim {
		t.Fatalf("status: %+v, %v", status, err)
	}
	// 检索路径同样拒绝。
	if _, err := service.LocalEmbedStrict(t.Context(), []string{"文本"}, false); !errors.Is(err, embed.ErrNotDownloaded) {
		t.Fatalf("strict embed without model: %v", err)
	}
}

func TestLocalEmbedWarmUpWithWeights(t *testing.T) {
	service := &PreviewService{}
	root := t.TempDir()
	t.Setenv("KNOWFLICK_DEBUG_DATA_ROOT", root)
	cache := embed.CacheDir(dataroot.Dir())
	if err := os.MkdirAll(cache, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(cache, "model.onnx"), []byte("stub"), 0o644); err != nil {
		t.Fatal(err)
	}
	status, err := service.LocalEmbedWarmUp(t.Context())
	if err != nil || !status.Downloaded {
		t.Fatalf("warm-up with weights: %+v, %v", status, err)
	}
	vectors, err := service.LocalEmbedStrict(t.Context(), []string{"检索文本"}, false)
	if err != nil || len(vectors) != 1 || len(vectors[0]) != embed.HashDim {
		t.Fatalf("strict embed: %d vectors, %v", len(vectors), err)
	}
}
