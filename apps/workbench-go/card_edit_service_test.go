package main

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"knowflick.local/workbench-go/internal/cards"
	"knowflick.local/workbench-go/internal/library"
)

func TestPreviewCardEditOnRustLibrary(t *testing.T) {
	fixture := os.Getenv("KF_SYSTEM_BACKUP_DB_FIXTURE_DIR")
	if fixture == "" {
		t.Skip("set KF_SYSTEM_BACKUP_DB_FIXTURE_DIR to the Rust-created database fixture")
	}
	fixture, err := filepath.Abs(fixture)
	if err != nil {
		t.Fatal(err)
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
	service := &PreviewService{initialPath: path}
	t.Cleanup(func() { _ = service.ServiceShutdown() })
	ctx := t.Context()
	opened, err := service.OpenInitialLibrary(ctx)
	if err != nil {
		t.Fatal(err)
	}
	page, err := service.BrowseCards(ctx, opened.Generation, "活动", 0)
	if err != nil || len(page.Cards) != 1 || page.Cards[0].ID != "card-active" || len(page.Cards[0].Content.Tags) != 1 {
		t.Fatalf("card search: %+v, %v", page, err)
	}
	card := page.Cards[0]
	if err := service.SaveCardContent(ctx, opened.Generation, cards.EditableCard{ID: card.ID, Version: card.Version, Content: card.Content}); !errors.Is(err, library.ErrReadOnly) {
		t.Fatalf("read-only save: %v", err)
	}
	writable, err := service.EnableEditing(ctx)
	if err != nil {
		t.Fatal(err)
	}
	card.Content.Headline = "已编辑的活动卡片"
	card.Content.Details = "新正文 newtag"
	if err := service.SaveCardContent(ctx, writable.Generation, card); err != nil {
		t.Fatal(err)
	}
	card.Version++
	card.Version--
	if err := service.SaveCardContent(ctx, writable.Generation, card); err == nil {
		t.Fatal("stale save succeeded")
	}
	card.Version++
	edited, err := service.BrowseCards(ctx, writable.Generation, "已编辑", 0)
	if err != nil || len(edited.Cards) != 1 || edited.Cards[0].Version != card.Version {
		t.Fatalf("edited card search: %+v, %v", edited, err)
	}
	if err := service.DeleteCardContent(ctx, writable.Generation, card.ID, card.Version); err != nil {
		t.Fatal(err)
	}
	page, err = service.BrowseCards(ctx, writable.Generation, "活动", 0)
	if err != nil || len(page.Cards) != 0 {
		t.Fatalf("deleted card: %+v, %v", page, err)
	}
}

func TestPreviewCardCreationOnRustLibrary(t *testing.T) {
	service, _ := openFixtureCopy(t)
	ctx := t.Context()
	opened, err := service.OpenInitialLibrary(ctx)
	if err != nil {
		t.Fatal(err)
	}
	draft := cards.EditableCard{
		ID: "ai-card-1", Version: 0,
		Content:    cards.Content{Category: "架构", Headline: "AI 提炼的卡片", Summary: "摘要", Details: "这是一段由 AI 提炼出的卡片正文，用来验证新建卡片路径。", Tags: []string{"提炼"}},
		MaterialID: stringPtr("material-active"), Source: "ai",
	}
	if err := service.SaveCardContent(ctx, opened.Generation, draft); !errors.Is(err, library.ErrReadOnly) {
		t.Fatalf("read-only create: %v", err)
	}
	writable, err := service.EnableEditing(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err := service.SaveCardContent(ctx, writable.Generation, draft); err != nil {
		t.Fatal(err)
	}
	found, err := service.BrowseCards(ctx, writable.Generation, "AI 提炼", 0)
	if err != nil || len(found.Cards) != 1 || found.Cards[0].ID != "ai-card-1" || found.Cards[0].Version != 1 {
		t.Fatalf("created card: %+v, %v", found, err)
	}
	if found.Cards[0].Content.Tags[0] != "提炼" || found.Cards[0].Content.Category != "架构" {
		t.Fatalf("created card content: %+v", found.Cards[0])
	}
	if err := service.SaveCardContent(ctx, writable.Generation, draft); err == nil {
		t.Fatal("duplicate create with version 0 overwrote the card")
	}
}

func stringPtr(value string) *string { return &value }
