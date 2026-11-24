package main

import (
	"context"
	"database/sql"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"knowflick.local/workbench-go/internal/library"
)

func TestSubscriptionServiceFetchesImportsAndMarksPolled(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "knowflick.db")
	db, err := sql.Open("sqlite", "file:"+path+"?mode=rwc&_pragma=busy_timeout(10000)")
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	for _, statement := range []string{
		library.SubscriptionSchema,
		"CREATE TABLE materials (id TEXT PRIMARY KEY, source_type TEXT NOT NULL, title TEXT NOT NULL, source_url TEXT, raw_text TEXT NOT NULL, cleaned_markdown TEXT, content_hash TEXT NOT NULL, media_path TEXT, media_size_bytes INTEGER NOT NULL DEFAULT 0, metadata_json TEXT NOT NULL, inbox_status TEXT NOT NULL DEFAULT 'inbox', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, version INTEGER NOT NULL DEFAULT 1, is_deleted INTEGER NOT NULL DEFAULT 0, deleted_at INTEGER)",
		"CREATE VIRTUAL TABLE fts_materials USING fts5(material_id UNINDEXED, title, raw_text, source_url)",
	} {
		if _, err := db.Exec(statement); err != nil {
			t.Fatal(err)
		}
	}
	if err := library.SaveSubscription(context.Background(), db, library.Subscription{ID: "sub-1", Type: "rss", Title: "测试源", TargetURL: "http://127.0.0.1/feed.xml", IntervalMinutes: 30, IsActive: true, CreatedAt: 1000}); err != nil {
		t.Fatal(err)
	}
	_ = db.Close()

	feed := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/rss+xml; charset=utf-8")
		_, _ = w.Write([]byte("<rss><channel><item><title>条目一</title></item></channel></rss>"))
	}))
	defer feed.Close()

	service := &SubscriptionService{preview: &PreviewService{path: path, writable: true}}
	ctx := context.Background()
	// 地址来自库里的 target_url，这里先改成真实测试端口再读。
	db, err = sql.Open("sqlite", "file:"+path+"?mode=rwc&_pragma=busy_timeout(10000)")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("UPDATE subscriptions SET target_url = ? WHERE id = 'sub-1'", feed.URL+"/feed.xml"); err != nil {
		t.Fatal(err)
	}
	payload, err := service.FetchSubscriptionPayload(ctx, "sub-1")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(payload, "条目一") {
		t.Fatalf("payload: %q", payload)
	}
	materials := []library.ImportedMaterial{
		{ID: "m1", SourceType: "web", Title: "条目一", SourceURL: "https://example.org/a", RawText: "正文一", MetadataJSON: "{}", InboxStatus: "inbox", CreatedAt: 1000, UpdatedAt: 1000},
		{ID: "m2", SourceType: "web", Title: "条目二", SourceURL: "https://example.org/b", RawText: "正文二", MetadataJSON: "{}", InboxStatus: "inbox", CreatedAt: 1000, UpdatedAt: 1000},
	}
	added, err := service.ImportSubscriptionMaterials(ctx, materials)
	if err != nil || added != 2 {
		t.Fatalf("import: %d %v", added, err)
	}
	added, err = service.ImportSubscriptionMaterials(ctx, materials)
	if err != nil || added != 0 {
		t.Fatalf("repeat import should add nothing: %d %v", added, err)
	}
	if err := service.MarkSubscriptionPolled(ctx, "sub-1", 5000); err != nil {
		t.Fatal(err)
	}
	items, err := library.ListSubscriptions(ctx, db)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].LastPolledAt == nil || *items[0].LastPolledAt != 5000 {
		t.Fatalf("polled: %+v", items)
	}
	urls, err := service.ListMaterialSourceURLs(ctx)
	if err != nil || len(urls) != 2 {
		t.Fatalf("urls: %v %v", urls, err)
	}
	_ = db.Close()
}
