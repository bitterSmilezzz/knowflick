package main

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"knowflick.local/workbench-go/internal/embed"
	"knowflick.local/workbench-go/internal/library"
)

func TestEmbeddingFlowOnRustLibrary(t *testing.T) {
	fixture := os.Getenv("KF_SYSTEM_BACKUP_DB_FIXTURE_DIR")
	if fixture == "" {
		t.Skip("set KF_SYSTEM_BACKUP_DB_FIXTURE_DIR to the Rust-created database fixture")
	}
	dir := t.TempDir()
	path := filepath.Join(dir, "knowflick.db")
	data, err := os.ReadFile(filepath.Join(fixture, "knowflick.db"))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	service := &PreviewService{initialPath: path, path: path}
	t.Cleanup(func() { _ = service.ServiceShutdown() })
	ctx := context.Background()
	opened, err := service.OpenInitialLibrary(ctx)
	if err != nil {
		t.Fatal(err)
	}
	unembedded, err := service.ListUnembeddedCardIDs(ctx, opened.Generation, 10)
	if err != nil || len(unembedded) != 1 || unembedded[0] != "card-active" {
		t.Fatalf("unembedded: %+v, %v", unembedded, err)
	}
	if err := service.SaveCardEmbedding(ctx, opened.Generation, "card-active", []float32{1, 2}, "hash", "char-ngram-128"); !errors.Is(err, library.ErrReadOnly) {
		t.Fatalf("read-only save: %v", err)
	}
	status, err := service.LocalEmbedStatus(ctx)
	if err != nil || status.Model != "multilingual-e5-small" || status.Dim != 384 || status.Downloaded {
		t.Fatalf("local status: %+v, %v", status, err)
	}
	first, err := service.LocalEmbed(ctx, []string{"知识库检索与向量"}, false)
	if err != nil || len(first) != 1 || len(first[0]) != embed.HashDim {
		t.Fatalf("local embed: %d vectors, %v", len(first), err)
	}
	second, err := service.LocalEmbed(ctx, []string{"知识库检索与向量"}, false)
	if err != nil || len(second) != 1 || second[0][0] != first[0][0] {
		t.Fatal("hash embedding not deterministic")
	}
	writable, err := service.EnableEditing(ctx)
	if err != nil {
		t.Fatal(err)
	}
	built, err := service.RebuildHashEmbeddings(ctx, writable.Generation, 10)
	if err != nil || built != 1 {
		t.Fatalf("rebuild: %d, %v", built, err)
	}
	unembedded, err = service.ListUnembeddedCardIDs(ctx, writable.Generation, 10)
	if err != nil || len(unembedded) != 0 {
		t.Fatalf("unembedded after rebuild: %+v, %v", unembedded, err)
	}
	stale, err := service.ListStaleEmbeddingCardIDs(ctx, writable.Generation, int64(embed.HashDim), embed.HashProvider, embed.HashModel, 10)
	if err != nil || len(stale) != 0 {
		t.Fatalf("stale with matching identity: %+v, %v", stale, err)
	}
	stale, err = service.ListStaleEmbeddingCardIDs(ctx, writable.Generation, 384, "local", "multilingual-e5-small", 10)
	if err != nil || len(stale) != 1 || stale[0] != "card-active" {
		t.Fatalf("stale after engine switch: %+v, %v", stale, err)
	}
	if err := service.SaveCardEmbeddingsBatch(ctx, writable.Generation, []embed.Item{{CardID: "card-active", Vector: []float32{0, 1, 0}}}, "hash", "char-ngram-128"); err != nil {
		t.Fatal(err)
	}
	stale, err = service.ListStaleEmbeddingCardIDs(ctx, writable.Generation, 3, embed.HashProvider, embed.HashModel, 10)
	if err != nil || len(stale) != 0 {
		t.Fatalf("stale after batch: %+v, %v", stale, err)
	}
}
