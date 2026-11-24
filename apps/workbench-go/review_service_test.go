package main

import (
	"errors"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"knowflick.local/workbench-go/internal/library"
	"knowflick.local/workbench-go/internal/reviewhistory"
)

func TestPreviewReviewOnRustLibrary(t *testing.T) {
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
	if err := os.WriteFile(filepath.Join(dir, "settings.json"), []byte("{\"soundEffectsEnabled\":false}"), 0600); err != nil {
		t.Fatal(err)
	}
	service := &PreviewService{initialPath: path}
	t.Cleanup(func() { _ = service.ServiceShutdown() })
	ctx := t.Context()
	opened, err := service.OpenInitialLibrary(ctx)
	if err != nil {
		t.Fatal(err)
	}
	deck, err := service.LoadReviewDeck(ctx, opened.Generation)
	if err != nil || len(deck.Cards) != 1 || deck.SoundEnabled || !slices.Equal(deck.Projects["material-active"], []string{"project-1"}) {
		t.Fatalf("review deck: %+v, %v", deck, err)
	}
	card := deck.Cards[0]
	event := reviewhistory.Event{
		ID: "33333333-3333-4333-8333-333333333333", CardID: card.ID, ReviewedAt: 1700000000200,
		Rating: reviewhistory.RatingGood, Algorithm: reviewhistory.AlgorithmFsrs, ProjectIDs: []string{},
	}
	// 线上契约是 state（学习字段）+ event；这里按前端映射后的样子构造。
	state := reviewhistory.CardState{
		ID: card.ID, ReviewCount: card.ReviewCount + 1, MasteryLevel: 1, LastReviewedAt: &event.ReviewedAt,
		Repetition: 1, IntervalDays: 3, EaseFactor: 2.46, Stability: 3.1, Difficulty: 4,
	}
	if _, err := service.RecordReview(ctx, opened.Generation, state, event); !errors.Is(err, library.ErrReadOnly) {
		t.Fatalf("read-only review: %v", err)
	}
	writable, err := service.EnableEditing(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.RecordReview(ctx, opened.Generation, state, event); err == nil {
		t.Fatal("accepted a stale library generation")
	}
	if inserted, err := service.RecordReview(ctx, writable.Generation, state, event); err != nil || !inserted {
		t.Fatalf("review: %v, %v", inserted, err)
	}
	deck, err = service.LoadReviewDeck(ctx, writable.Generation)
	if err != nil || len(deck.Cards) != 1 || deck.Cards[0].ReviewCount != state.ReviewCount || deck.Cards[0].Stability != state.Stability {
		t.Fatalf("review card: %+v, %v", deck, err)
	}
	history, err := service.ReadReviewHistoryPeriod(writable.Generation, event.ReviewedAt, event.ReviewedAt)
	if err != nil || len(history.Events) != 1 || history.Events[0].ID != event.ID || history.Events[0].ProjectAttributionComplete {
		t.Fatalf("review history: %+v, %v", history, err)
	}
}
