package materials

import (
	"database/sql"
	"errors"
	"path/filepath"
	"strings"
	"testing"

	_ "modernc.org/sqlite"
)

const matSchema = `
CREATE TABLE materials (
  id TEXT PRIMARY KEY, source_type TEXT NOT NULL, title TEXT NOT NULL, source_url TEXT,
  raw_text TEXT NOT NULL, cleaned_markdown TEXT, content_hash TEXT NOT NULL, media_path TEXT,
  media_size_bytes INTEGER NOT NULL DEFAULT 0, metadata_json TEXT NOT NULL,
  inbox_status TEXT NOT NULL DEFAULT 'inbox', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1, is_deleted INTEGER NOT NULL DEFAULT 0, deleted_at INTEGER
);
CREATE VIRTUAL TABLE fts_materials USING fts5(material_id UNINDEXED, title, raw_text, source_url);
CREATE TABLE cards (
  id TEXT PRIMARY KEY, material_id TEXT, category TEXT NOT NULL DEFAULT '未分类', headline TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '', details TEXT NOT NULL DEFAULT '', links_json TEXT NOT NULL DEFAULT '[]',
  tags_json TEXT NOT NULL DEFAULT '[]', source TEXT NOT NULL DEFAULT 'imported',
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, version INTEGER NOT NULL DEFAULT 1,
  is_deleted INTEGER NOT NULL DEFAULT 0
);
CREATE VIRTUAL TABLE fts_cards USING fts5(card_id UNINDEXED, headline, summary, details, category, tags);
CREATE TABLE card_embeddings (card_id TEXT PRIMARY KEY);
`

func openMaterialDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "lib.db"))
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(matSchema); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

func insertMaterial(t *testing.T, db *sql.DB, id, title, text, status string, created int64) {
	t.Helper()
	url := "https://example.org/" + id
	if _, err := db.Exec("INSERT INTO materials (id,source_type,title,source_url,raw_text,content_hash,metadata_json,inbox_status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
		id, "web", title, url, text, "hash-"+id, "{}", status, created, created); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("INSERT INTO fts_materials (material_id,title,raw_text,source_url) VALUES (?,?,?,?)", id, title, text, url); err != nil {
		t.Fatal(err)
	}
}

func TestListSearchAndStatus(t *testing.T) {
	db := openMaterialDB(t)
	ctx := t.Context()
	insertMaterial(t, db, "m1", "第一篇", "zebra 单词与中文内容", "inbox", 100)
	insertMaterial(t, db, "m2", "第二篇", "连续中文子串内容", "processed", 200)
	insertMaterial(t, db, "m3", "已删除", "zebra", "inbox", 300)
	if _, err := db.Exec("UPDATE materials SET is_deleted = 1 WHERE id = 'm3'"); err != nil {
		t.Fatal(err)
	}
	inbox, err := List(ctx, db, true, 10, 0)
	if err != nil || len(inbox) != 1 || inbox[0].ID != "m1" || inbox[0].SourceURL == nil {
		t.Fatalf("inbox: %+v, %v", inbox, err)
	}
	all, err := List(ctx, db, false, 10, 0)
	if err != nil || len(all) != 2 || all[0].ID != "m2" || all[1].ID != "m1" {
		t.Fatalf("all: %+v, %v", all, err)
	}
	page, err := List(ctx, db, false, 1, 1)
	if err != nil || len(page) != 1 || page[0].ID != "m1" {
		t.Fatalf("paged: %+v, %v", page, err)
	}
	for query, want := range map[string]string{"zeb": "m1", "连续中文": "m2"} {
		hits, err := Search(ctx, db, query, 10)
		if err != nil || len(hits) != 1 || hits[0].ID != want {
			t.Fatalf("search %q: %+v, %v", query, hits, err)
		}
	}
	if err := UpdateStatus(ctx, db, "m1", "processed", 400); err != nil {
		t.Fatal(err)
	}
	if err := UpdateStatus(ctx, db, "m1", "bogus", 401); err == nil {
		t.Fatal("invalid status accepted")
	}
	if err := UpdateStatus(ctx, db, "missing", "processed", 402); !strings.Contains(err.Error(), "不存在") {
		t.Fatalf("missing material: %v", err)
	}
	items, err := Search(ctx, db, "zeb", 10)
	if err != nil || len(items) != 1 || items[0].InboxStatus != "processed" {
		t.Fatalf("status update: %+v, %v", items, err)
	}
}

func TestConvertMaterialToCardOnce(t *testing.T) {
	db := openMaterialDB(t)
	ctx := t.Context()
	insertMaterial(t, db, "m1", "素材标题", "正文内容 zebra", "inbox", 100)
	created, err := ConvertToCard(ctx, db, "m1", "card-1", 500)
	if err != nil || !created {
		t.Fatalf("convert: %v, %v", created, err)
	}
	var materialID, category, headline, summary, source, links string
	var deleted int64
	if err := db.QueryRow("SELECT material_id, category, headline, summary, source, links_json, is_deleted FROM cards WHERE id='card-1'").Scan(&materialID, &category, &headline, &summary, &source, &links, &deleted); err != nil {
		t.Fatal(err)
	}
	if materialID != "m1" || category != "随手笔记" || headline != "素材标题" || summary != "正文内容 zebra" || source != "imported" || !strings.Contains(links, "原始来源") || deleted != 0 {
		t.Fatalf("card: %+v %+v %+v %+v %+v %+v", materialID, category, headline, summary, source, links)
	}
	var indexed int
	if err := db.QueryRow("SELECT COUNT(*) FROM fts_cards WHERE card_id='card-1'").Scan(&indexed); err != nil || indexed != 1 {
		t.Fatalf("card index: %d, %v", indexed, err)
	}
	created, err = ConvertToCard(ctx, db, "m1", "card-2", 501)
	if err != nil || created {
		t.Fatalf("second convert should reuse: %v, %v", created, err)
	}
	var count int
	if err := db.QueryRow("SELECT COUNT(*) FROM cards WHERE material_id='m1'").Scan(&count); err != nil || count != 1 {
		t.Fatalf("duplicate cards: %d, %v", count, err)
	}
	var status string
	if err := db.QueryRow("SELECT inbox_status FROM materials WHERE id='m1'").Scan(&status); err != nil || status != "processed" {
		t.Fatalf("status: %q, %v", status, err)
	}
	if _, err := ConvertToCard(ctx, db, "missing", "card-3", 502); !strings.Contains(err.Error(), "不存在") {
		t.Fatalf("missing material: %v", err)
	}
	if _, err := db.Exec("CREATE TRIGGER reject_card BEFORE INSERT ON cards BEGIN SELECT RAISE(ABORT, '拒绝建卡'); END"); err != nil {
		t.Fatal(err)
	}
	insertMaterial(t, db, "m4", "另一篇", "正文", "inbox", 400)
	if _, err := ConvertToCard(ctx, db, "m4", "card-4", 503); err == nil {
		t.Fatal("convert succeeded despite card insert failure")
	}
	if err := db.QueryRow("SELECT inbox_status FROM materials WHERE id='m4'").Scan(&status); err != nil || status != "inbox" {
		t.Fatalf("status after rollback: %q, %v", status, err)
	}
	_ = errors.Is
}
