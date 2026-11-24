package reviewhistory

import (
	"strings"
	"testing"
)

func TestRecordReviewCommitsOnceAndRollsBack(t *testing.T) {
	db := openDB(t)
	seed(t, db)
	const schema = `CREATE TABLE cards (
		id TEXT PRIMARY KEY, headline TEXT NOT NULL, review_count INTEGER NOT NULL DEFAULT 0,
		mastery_level INTEGER NOT NULL DEFAULT 0, last_reviewed_at INTEGER, repetition INTEGER NOT NULL DEFAULT 0,
		interval_days REAL NOT NULL DEFAULT 0, ease_factor REAL NOT NULL DEFAULT 2.5,
		stability REAL NOT NULL DEFAULT 0, difficulty REAL NOT NULL DEFAULT 0,
		version INTEGER NOT NULL DEFAULT 1, is_deleted INTEGER NOT NULL DEFAULT 0
	);
	INSERT INTO cards (id,headline) VALUES ('card-1','并行编辑后的标题');`
	if _, err := db.Exec(schema); err != nil {
		t.Fatal(err)
	}
	ctx := t.Context()
	first := event(eventID, "card-1", 2000)
	first.Algorithm, first.ProjectAttributionComplete = AlgorithmFsrs, true
	state := CardState{ID: first.CardID, ReviewCount: 1, MasteryLevel: 1, LastReviewedAt: &first.ReviewedAt, Repetition: 1, IntervalDays: 3, EaseFactor: 2.46, Stability: 3.1, Difficulty: 4}
	if inserted, err := Record(ctx, db, state, first); err != nil || !inserted {
		t.Fatalf("initial review: %v, %v", inserted, err)
	}
	if inserted, err := Record(ctx, db, state, first); err != nil || inserted {
		t.Fatalf("retry: %v, %v", inserted, err)
	}
	conflicting := first
	conflicting.Rating = RatingHard
	if _, err := Record(ctx, db, state, conflicting); err == nil || !strings.Contains(err.Error(), "标识已被不同内容占用") {
		t.Fatalf("event ID conflict: %v", err)
	}
	next := event("11111111-1111-4111-8111-111111111111", first.CardID, 3000)
	state.LastReviewedAt = &next.ReviewedAt
	if _, err := Record(ctx, db, state, next); err == nil || !strings.Contains(err.Error(), "卡片学习状态已变化") {
		t.Fatalf("stale review: %v", err)
	}
	if _, err := db.Exec("CREATE TRIGGER reject_review BEFORE INSERT ON review_events BEGIN SELECT RAISE(ABORT, '拒绝写入'); END"); err != nil {
		t.Fatal(err)
	}
	state.ReviewCount = 2
	state.IntervalDays = 5
	if _, err := Record(ctx, db, state, next); err == nil || !strings.Contains(err.Error(), "拒绝写入") {
		t.Fatalf("event write failure: %v", err)
	}

	var title string
	var count, version, reviewedAt int64
	var days float64
	if err := db.QueryRow("SELECT headline,review_count,version,last_reviewed_at,interval_days FROM cards WHERE id = 'card-1'").Scan(&title, &count, &version, &reviewedAt, &days); err != nil {
		t.Fatal(err)
	}
	if title != "并行编辑后的标题" || count != 1 || version != 2 || reviewedAt != first.ReviewedAt || days != 3 {
		t.Fatalf("card: %q %d %d %d %g", title, count, version, reviewedAt, days)
	}
	snapshot, err := Period(db, first.ReviewedAt, next.ReviewedAt)
	if err != nil || snapshot.CoverageStartedAt != 1000 || len(snapshot.Events) != 1 || !equalEvent(snapshot.Events[0], first) {
		t.Fatalf("review ledger: %+v, %v", snapshot, err)
	}
	if _, err := db.Exec("UPDATE cards SET is_deleted = 1 WHERE id = 'card-1'"); err != nil {
		t.Fatal(err)
	}
	if _, err := Record(ctx, db, state, next); err == nil || !strings.Contains(err.Error(), "复习卡片已删除或不存在") {
		t.Fatalf("deleted card review: %v", err)
	}
}
