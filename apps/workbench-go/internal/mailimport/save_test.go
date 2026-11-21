package mailimport

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"testing"

	_ "modernc.org/sqlite"
)

const materialsSchema = `
CREATE TABLE materials (
  id TEXT PRIMARY KEY, source_type TEXT NOT NULL, title TEXT NOT NULL,
  source_url TEXT, raw_text TEXT NOT NULL, cleaned_markdown TEXT,
  content_hash TEXT NOT NULL, media_path TEXT, media_size_bytes INTEGER NOT NULL DEFAULT 0,
  metadata_json TEXT NOT NULL, inbox_status TEXT NOT NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1, is_deleted INTEGER NOT NULL DEFAULT 0,
  deleted_at INTEGER);
CREATE VIRTUAL TABLE fts_materials USING fts5(material_id UNINDEXED,title,raw_text,source_url);
`

func openTestDB(t *testing.T) *sql.DB {
	t.Helper()
	path := filepath.Join(t.TempDir(), "materials.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(materialsSchema); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

func TestSaveMaterialInsertsAndIndexes(t *testing.T) {
	db := openTestDB(t)
	material, err := FromMail(testAccount(), 7, 42, Mail{Subject: "周报", MessageID: "<m1@x>", Text: "本周进展"}, 1000)
	if err != nil {
		t.Fatal(err)
	}
	if err := SaveMaterial(context.Background(), db, material, 1000); err != nil {
		t.Fatal(err)
	}
	var title, hash string
	var version int
	if err := db.QueryRow("SELECT title, content_hash, version FROM materials WHERE id=?1", material.ID).Scan(&title, &hash, &version); err != nil {
		t.Fatal(err)
	}
	if title != "周报" || version != 1 {
		t.Fatalf("row: title=%q version=%d", title, version)
	}
	if hash != sha256Hex("本周进展") {
		t.Fatalf("content hash mismatch: %s", hash)
	}
	var ftsTitle, ftsBody string
	if err := db.QueryRow("SELECT title, raw_text FROM fts_materials WHERE material_id=?1", material.ID).Scan(&ftsTitle, &ftsBody); err != nil {
		t.Fatal(err)
	}
	if ftsTitle != "周报" || ftsBody != "本周进展" {
		t.Fatalf("fts row: title=%q body=%q", ftsTitle, ftsBody)
	}
}

func TestSaveMaterialUpsertBumpsVersionAndResetsDeleted(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()
	material, _ := FromMail(testAccount(), 7, 42, Mail{Subject: "初版", MessageID: "<m1@x>", Text: "旧正文"}, 1000)
	if err := SaveMaterial(ctx, db, material, 1000); err != nil {
		t.Fatal(err)
	}
	// 模拟被软删：再次保存必须复位删除态。
	if _, err := db.Exec("UPDATE materials SET is_deleted=1, deleted_at=555 WHERE id=?1", material.ID); err != nil {
		t.Fatal(err)
	}
	updated, _ := FromMail(testAccount(), 7, 42, Mail{Subject: "改版", MessageID: "<m1@x>", Text: "新正文"}, 2000)
	if updated.ID != material.ID {
		t.Fatal("same message should map to the same material id")
	}
	if err := SaveMaterial(ctx, db, updated, 2000); err != nil {
		t.Fatal(err)
	}
	var title string
	var version int
	var deleted int
	var deletedAt sql.NullInt64
	if err := db.QueryRow("SELECT title, version, is_deleted, deleted_at FROM materials WHERE id=?1", material.ID).Scan(&title, &version, &deleted, &deletedAt); err != nil {
		t.Fatal(err)
	}
	if title != "改版" || version != 2 || deleted != 0 || deletedAt.Valid {
		t.Fatalf("upsert: title=%q version=%d deleted=%d deletedAt=%v", title, version, deleted, deletedAt)
	}
	// 旧正文必须从索引里消失。
	var ftsBody string
	if err := db.QueryRow("SELECT raw_text FROM fts_materials WHERE material_id=?1", material.ID).Scan(&ftsBody); err != nil {
		t.Fatal(err)
	}
	if ftsBody != "新正文" {
		t.Fatalf("stale fts body: %q", ftsBody)
	}
}

func TestSaveMaterialKeepsSingleRowAcrossUids(t *testing.T) {
	db := openTestDB(t)
	ctx := context.Background()
	first, _ := FromMail(testAccount(), 7, 42, Mail{Subject: "同名", MessageID: "<same@x>", Text: "正文"}, 1000)
	second, _ := FromMail(testAccount(), 7, 43, Mail{Subject: "同名", MessageID: "<same@x>", Text: "正文"}, 2000)
	if err := SaveMaterial(ctx, db, first, 1000); err != nil {
		t.Fatal(err)
	}
	if err := SaveMaterial(ctx, db, second, 2000); err != nil {
		t.Fatal(err)
	}
	var rows int
	if err := db.QueryRow("SELECT COUNT(*) FROM materials").Scan(&rows); err != nil {
		t.Fatal(err)
	}
	if rows != 1 {
		t.Fatalf("duplicate materials: %d", rows)
	}
}

// TestExportWriteFixture 写出由 Go 写入的素材库，供 Rust 读回对拍。
func TestExportWriteFixture(t *testing.T) {
	target := os.Getenv("KF_GO_MATERIAL_DB")
	if target == "" {
		t.Skip("set KF_GO_MATERIAL_DB to export the material database")
	}
	if _, err := os.Lstat(target); !os.IsNotExist(err) {
		t.Fatalf("fixture must be a new file: %v", err)
	}
	db, err := sql.Open("sqlite", target)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(materialsSchema); err != nil {
		t.Fatal(err)
	}
	material, _ := FromMail(testAccount(), 7, 42, Mail{Subject: "夹具标题", MessageID: "<fixture@x>", Text: "夹具正文，含记忆与检索"}, 1000)
	if err := SaveMaterial(context.Background(), db, material, 1000); err != nil {
		t.Fatal(err)
	}
	// 同时写出真实 id：Rust 侧读它而不是猜——猜 id 会让「查不到行」伪装成写入失败。
	if err := os.WriteFile(target+".id", []byte(material.ID), 0644); err != nil {
		t.Fatal(err)
	}
}
