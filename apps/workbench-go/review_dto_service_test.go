package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"path/filepath"
	"testing"

	"knowflick.local/workbench-go/internal/cards"
	"knowflick.local/workbench-go/internal/library"
	"knowflick.local/workbench-go/internal/reviewhistory"
	_ "modernc.org/sqlite"
)

// 共享工作台评分后发的是**整张卡 + 事件**（review_record 的 card 参数）。
// 这条回归钉住 wire 契约：camelCase 的卡片必须能映射成学习状态并真的落库。
func TestRecordReviewAcceptsRatedCardFromShell(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	created, err := library.Create(ctx, filepath.Join(dir, "knowflick.db"))
	if err != nil {
		t.Fatal(err)
	}
	created.Close()
	lib, err := library.OpenForWrite(ctx, filepath.Join(dir, "knowflick.db"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := lib.Upsert(ctx, library.Note{ID: "review-note", Title: "复习", Body: "正文"}, 0, 1000); err != nil {
		t.Fatal(err)
	}
	if err := lib.SaveCardContent(ctx, cards.EditableCard{ID: "rated-card", Source: "imported", Content: cards.Content{Category: "验收", Headline: "评分卡", Summary: "摘要", Details: "正文"}}, 1000); err != nil {
		t.Fatal(err)
	}
	service := &PreviewService{current: lib, generation: 7, path: filepath.Join(dir, "knowflick.db")}
	// 与 store.ts 发出的 JSON 同形：评分后的卡片带新的学习字段。
	var payload cards.Card
	if err := json.Unmarshal([]byte(`{
		"id":"rated-card","materialId":null,"category":"验收","headline":"评分卡","summary":"摘要",
		"details":"正文","links":[],"tags":[],"source":"imported","seenAt":null,"swiped":null,
		"isFavorite":false,"favoritedAt":null,"reviewCount":1,"masteryLevel":1,
		"lastReviewedAt":2000,"repetition":1,"intervalDays":1,"easeFactor":2.5,
		"stability":0,"difficulty":0,"subject":null,"branch":null,"level":null,"track":null,
		"orderKey":null,"prereq":[],"createdAt":1000,"editedAt":null
	}`), &payload); err != nil {
		t.Fatal(err)
	}
	event := reviewhistory.Event{ID: "55555555-5555-4555-8555-555555555555", CardID: "rated-card", ReviewedAt: 2000, Rating: reviewhistory.RatingGood, Algorithm: reviewhistory.AlgorithmFsrs}
	if ok, err := service.RecordReview(ctx, 7, payload, event); err != nil || !ok {
		t.Fatalf("record review: %v, %v", ok, err)
	}
	if ok, err := service.RecordReview(ctx, 7, payload, event); err != nil || ok {
		t.Fatalf("duplicate review must be a no-op: %v, %v", ok, err)
	}
	// 直接读库：EditableCard 不暴露学习字段，读回才是真证据。
	read, err := sql.Open("sqlite", "file:"+filepath.Join(dir, "knowflick.db")+"?mode=ro")
	if err != nil {
		t.Fatal(err)
	}
	defer read.Close()
	var reviewCount int64
	var lastReviewedAt *int64
	var events int
	if err := read.QueryRow("SELECT review_count, last_reviewed_at, (SELECT COUNT(*) FROM review_events) FROM cards WHERE id=?1", "rated-card").Scan(&reviewCount, &lastReviewedAt, &events); err != nil {
		t.Fatal(err)
	}
	if reviewCount != 1 || lastReviewedAt == nil || *lastReviewedAt != 2000 || events != 1 {
		t.Fatalf("review not persisted: count=%d at=%v events=%d", reviewCount, lastReviewedAt, events)
	}
}
