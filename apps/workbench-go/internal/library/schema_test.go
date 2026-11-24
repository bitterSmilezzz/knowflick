package library

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"

	_ "modernc.org/sqlite"
)

func tableExists(t *testing.T, db *sql.DB, name string) bool {
	t.Helper()
	var exists int
	if err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE name = ?)", name).Scan(&exists); err != nil {
		t.Fatalf("查表 %s: %v", name, err)
	}
	return exists == 1
}

func TestCreateBuildsFullSchema(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "新建资料库.db")
	lib, err := Create(ctx, path)
	if err != nil {
		t.Fatalf("新建资料库: %v", err)
	}
	defer lib.Close()

	// 建库必须覆盖 Rust 时代 init_tables 的核心表与 FTS 索引——Go 现在是唯一建库方。
	for _, name := range []string{
		"meta", "notes", "note_revisions", "note_chunks", "fts_notes", "fts_note_chunks",
		"cards", "fts_cards", "materials", "fts_materials", "review_events",
		"projects", "project_members", "goals", "goal_evidence",
	} {
		if !tableExists(t, lib.db, name) {
			t.Fatalf("新建资料库缺少表 %s", name)
		}
	}

	// 新建出来的库必须直接可用：能写、只读打开也能读。
	if _, err := lib.Upsert(ctx, draftNote("n1", "标题", "正文：记忆与知识"), 0, 1000); err != nil {
		t.Fatalf("新建库写入失败: %v", err)
	}
	ro, err := Open(ctx, path)
	if err != nil {
		t.Fatalf("只读打开新建库: %v", err)
	}
	defer ro.Close()
	page, err := ro.List(ctx, 0)
	if err != nil || len(page.Notes) != 1 || page.Notes[0].Title != "标题" {
		t.Fatalf("新库首篇笔记: %+v %v", page, err)
	}
}

func TestCreateIsIdempotent(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "重复打开.db")
	for i := 0; i < 2; i++ {
		lib, err := Create(ctx, path)
		if err != nil {
			t.Fatalf("第 %d 次打开: %v", i+1, err)
		}
		lib.Close()
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var rows int
	if err := db.QueryRow("SELECT COUNT(*) FROM meta WHERE key = 'review_history_started_at'").Scan(&rows); err != nil {
		t.Fatal(err)
	}
	if rows != 1 {
		t.Fatalf("review_history_started_at 应只有一行，得到 %d", rows)
	}
}

// 老库（Rust 时代建的表）打开时要补齐历史列；分块向量只在首次核对时清空一次。
func TestCreateMigratesLegacyLibrary(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "老库.db")
	raw, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	// 先按完整结构建库，再把迁移段要补的列删掉——模拟 Rust 时代还没有这些列的老库。
	if _, err := raw.Exec(SchemaSQL); err != nil {
		t.Fatalf("建老库: %v", err)
	}
	for _, statement := range []string{
		"ALTER TABLE notes DROP COLUMN exclude_from_profile",
		"ALTER TABLE cards DROP COLUMN edited_at",
		"ALTER TABLE card_embeddings DROP COLUMN provider",
		"ALTER TABLE card_embeddings DROP COLUMN model",
		"ALTER TABLE artifacts DROP COLUMN source_note_ids",
	} {
		if _, err := raw.Exec(statement); err != nil {
			t.Fatalf("造老库结构（%s）: %v", statement, err)
		}
	}
	if _, err := raw.Exec("INSERT INTO card_embeddings (card_id, dim, embedding, updated_at) VALUES ('c1', 3, x'000000', 1)"); err != nil {
		t.Fatal(err)
	}
	if _, err := raw.Exec("INSERT INTO note_chunk_embeddings (note_id, chunk_index, dim, embedding, provider, model, content_revision, updated_at) VALUES ('n1', 0, 3, x'000000', '', '', 1, 1)"); err != nil {
		t.Fatal(err)
	}
	raw.Close()

	lib, err := Create(ctx, path)
	if err != nil {
		t.Fatalf("迁移老库: %v", err)
	}
	defer lib.Close()
	if ok, err := hasColumn(ctx, lib.db, "notes", "exclude_from_profile"); err != nil || !ok {
		t.Fatalf("notes 应补 exclude_from_profile: ok=%v err=%v", ok, err)
	}
	if ok, err := hasColumn(ctx, lib.db, "cards", "edited_at"); err != nil || !ok {
		t.Fatalf("cards 应补 edited_at: ok=%v err=%v", ok, err)
	}
	for _, column := range []string{"provider", "model"} {
		if ok, err := hasColumn(ctx, lib.db, "card_embeddings", column); err != nil || !ok {
			t.Fatalf("card_embeddings 应补 %s: ok=%v err=%v", column, ok, err)
		}
	}
	if ok, err := hasColumn(ctx, lib.db, "artifacts", "source_note_ids"); err != nil || !ok {
		t.Fatalf("artifacts 应补 source_note_ids: ok=%v err=%v", ok, err)
	}
	var remaining int
	if err := lib.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM note_chunk_embeddings").Scan(&remaining); err != nil {
		t.Fatal(err)
	}
	if remaining != 0 {
		t.Fatalf("首次核对应清空旧分块向量，剩 %d 行", remaining)
	}
	var verified int
	if err := lib.db.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM meta WHERE key = 'note_chunk_revision_verified'").Scan(&verified); err != nil {
		t.Fatal(err)
	}
	if verified != 1 {
		t.Fatalf("应写入 note_chunk_revision_verified，得到 %d", verified)
	}
}
