package library

import (
	"context"
	"database/sql"
	"strings"
	"testing"

	_ "modernc.org/sqlite"
)

func captureOnce(t *testing.T, db *sql.DB, ctx context.Context) (backupSubscriptions, error) {
	t.Helper()
	tx, err := db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	return captureSubscriptions(ctx, tx)
}

func TestCaptureSubscriptionsExcludesPrivateTargets(t *testing.T) {
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	ctx := context.Background()
	if _, err := db.ExecContext(ctx, "CREATE TABLE subscriptions (id TEXT, type TEXT, title TEXT, target_url TEXT, interval_minutes INTEGER, last_polled_at INTEGER, is_active INTEGER, created_at INTEGER)"); err != nil {
		t.Fatal(err)
	}
	empty, err := captureOnce(t, db, ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(empty.Items) != 0 || empty.ExcludedCount != 0 {
		t.Fatalf("empty table: %+v", empty)
	}
	for _, row := range [][]any{
		{"ok", "rss", "公开", "https://example.org/feed.xml", 30, 123, 1, 10},
		{"release", "github_release", "发行", "owner/repo", 90, nil, 0, 11},
		{"secret", "rss", "私有", "https://example.org/feed?token=fixture-value", 30, nil, 1, 12},
		{"bad-kind", "unknown", "未知", "x", 30, nil, 1, 13},
	} {
		if _, err := db.ExecContext(ctx, "INSERT INTO subscriptions VALUES (?,?,?,?,?,?,?,?)", row...); err != nil {
			t.Fatal(err)
		}
	}
	snapshot, err := captureOnce(t, db, ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Items) != 2 || snapshot.ExcludedCount != 2 {
		t.Fatalf("got %d items, %d excluded", len(snapshot.Items), snapshot.ExcludedCount)
	}
	if !snapshot.Items[0].IsActive || snapshot.Items[1].IsActive {
		t.Fatalf("active flags: %+v", snapshot.Items)
	}
	if _, err := db.ExecContext(ctx, `UPDATE subscriptions SET is_active = 2 WHERE id = 'ok'`); err != nil {
		t.Fatal(err)
	}
	if _, err := captureOnce(t, db, ctx); err == nil || !strings.Contains(err.Error(), "启用标记") {
		t.Fatalf("invalid active flag accepted: %v", err)
	}
}
