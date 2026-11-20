package library

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"
)

func openSubscriptionDB(t *testing.T) *sql.DB {
	t.Helper()
	uri := "file:" + filepath.Join(t.TempDir(), "knowflick.db") + "?mode=rwc&_pragma=busy_timeout(10000)"
	db, err := sql.Open("sqlite", uri)
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(SubscriptionSchema); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

func TestSubscriptionCRUDKeepsPollProgress(t *testing.T) {
	ctx := context.Background()
	db := openSubscriptionDB(t)
	item := Subscription{ID: "sub-1", Type: "rss", Title: "示例订阅", TargetURL: "https://example.org/feed.xml", IntervalMinutes: 30, IsActive: true, CreatedAt: 1000}
	if err := SaveSubscription(ctx, db, item); err != nil {
		t.Fatal(err)
	}
	polled := int64(5000)
	if err := MarkSubscriptionPolled(ctx, db, "sub-1", polled); err != nil {
		t.Fatal(err)
	}
	item.Title = "改过的标题"
	if err := SaveSubscription(ctx, db, item); err != nil {
		t.Fatal(err)
	}
	items, err := ListSubscriptions(ctx, db)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].Title != "改过的标题" || items[0].LastPolledAt == nil || *items[0].LastPolledAt != polled {
		t.Fatalf("items: %+v", items)
	}
	if err := DeleteSubscription(ctx, db, "sub-1"); err != nil {
		t.Fatal(err)
	}
	if err := DeleteSubscription(ctx, db, "sub-1"); err == nil {
		t.Fatal("重复删除被当成成功")
	}
	if items, err := ListSubscriptions(ctx, db); err != nil || len(items) != 0 {
		t.Fatalf("after delete: %+v %v", items, err)
	}
}

func TestValidateSubscriptionRejectsUnsafeTargets(t *testing.T) {
	base := Subscription{ID: "sub-2", Type: "rss", Title: "订阅", TargetURL: "https://example.org/feed.xml", IntervalMinutes: 30, IsActive: true, CreatedAt: 1}
	if err := ValidateSubscription(base); err != nil {
		t.Fatalf("valid rejected: %v", err)
	}
	bad := base
	bad.TargetURL = "https://example.org/feed.xml?token=secret"
	if err := ValidateSubscription(bad); err == nil {
		t.Fatal("带查询参数的地址被接受")
	}
	bad = base
	bad.Type = "unknown"
	if err := ValidateSubscription(bad); err == nil {
		t.Fatal("未知类型被接受")
	}
	bad = base
	bad.IntervalMinutes = 1
	if err := ValidateSubscription(bad); err == nil {
		t.Fatal("过短间隔被接受")
	}
}
