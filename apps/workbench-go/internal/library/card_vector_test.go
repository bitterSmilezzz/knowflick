package library

import (
	"database/sql"
	"encoding/binary"
	"math"
	"path/filepath"
	"testing"
)

func openVectorDB(t *testing.T) *sql.DB {
	t.Helper()
	uri := "file:" + filepath.Join(t.TempDir(), "knowflick.db") + "?mode=rwc"
	db, err := sql.Open("sqlite", uri)
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	schema := []string{
		"CREATE TABLE cards (id TEXT PRIMARY KEY, material_id TEXT, category TEXT NOT NULL DEFAULT '', headline TEXT NOT NULL DEFAULT '', summary TEXT NOT NULL DEFAULT '', details TEXT NOT NULL DEFAULT '', links_json TEXT NOT NULL DEFAULT '[]', tags_json TEXT NOT NULL DEFAULT '[]', source TEXT NOT NULL DEFAULT '', seen_at INTEGER, swiped TEXT, is_favorite INTEGER NOT NULL DEFAULT 0, favorited_at INTEGER, review_count INTEGER NOT NULL DEFAULT 0, mastery_level INTEGER NOT NULL DEFAULT 0, last_reviewed_at INTEGER, repetition INTEGER NOT NULL DEFAULT 0, interval_days REAL NOT NULL DEFAULT 1, ease_factor REAL NOT NULL DEFAULT 2.5, stability REAL NOT NULL DEFAULT 0, difficulty REAL NOT NULL DEFAULT 0, subject TEXT, branch TEXT, level INTEGER, track TEXT, order_key TEXT, prereq_json TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL, edited_at INTEGER, updated_at INTEGER NOT NULL, version INTEGER NOT NULL DEFAULT 1, is_deleted INTEGER NOT NULL DEFAULT 0, deleted_at INTEGER)",
		"CREATE TABLE card_embeddings (card_id TEXT PRIMARY KEY, dim INTEGER NOT NULL, embedding BLOB NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL, updated_at INTEGER NOT NULL)",
		"CREATE TABLE notes (id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', body_md TEXT NOT NULL DEFAULT '', notebook TEXT, tags_json TEXT NOT NULL DEFAULT '[]', pinned INTEGER NOT NULL DEFAULT 0, favorite INTEGER NOT NULL DEFAULT 0, archived_at INTEGER, source_material_id TEXT, revision INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, is_deleted INTEGER NOT NULL DEFAULT 0, deleted_at INTEGER, exclude_from_profile INTEGER NOT NULL DEFAULT 0)",
		"CREATE TABLE note_chunks (note_id TEXT NOT NULL, chunk_index INTEGER NOT NULL, content TEXT NOT NULL, char_start INTEGER NOT NULL, char_end INTEGER NOT NULL, content_revision INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(note_id, chunk_index))",
		"CREATE TABLE note_chunk_embeddings (note_id TEXT NOT NULL, chunk_index INTEGER NOT NULL, dim INTEGER NOT NULL, embedding BLOB NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL, content_revision INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(note_id, chunk_index))",
		"CREATE VIRTUAL TABLE fts_cards USING fts5(card_id UNINDEXED, headline, details, summary, category, tags)",
	}
	for _, statement := range schema {
		if _, err := db.Exec(statement); err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

func floatLE(values []float32) []byte {
	bytes := make([]byte, len(values)*4)
	for i, v := range values {
		binary.LittleEndian.PutUint32(bytes[i*4:], math.Float32bits(v))
	}
	return bytes
}

func insertCardWithVector(t *testing.T, db *sql.DB, id string, vector []float32) {
	t.Helper()
	if _, err := db.Exec("INSERT INTO cards (id, headline, details, created_at, updated_at) VALUES (?, '标题'+?, '正文', 1, 1)", id, id); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("INSERT INTO card_embeddings (card_id, dim, embedding, provider, model, updated_at) VALUES (?, ?, ?, 'p', 'm', 1)", id, len(vector), floatLE(vector)); err != nil {
		t.Fatal(err)
	}
}

func TestSearchCardsVectorScoresAndGuards(t *testing.T) {
	db := openVectorDB(t)
	lib := &Library{db: db, writable: true}
	ctx := t.Context()
	insertCardWithVector(t, db, "near", []float32{1, 0, 0})
	insertCardWithVector(t, db, "far", []float32{0, 1, 0})
	insertCardWithVector(t, db, "other-dim", []float32{1, 0})
	if _, err := db.Exec("INSERT INTO cards (id, headline, details, created_at, updated_at, is_deleted) VALUES ('gone', '删除卡', '正文', 1, 1, 1)"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("INSERT INTO card_embeddings (card_id, dim, embedding, provider, model, updated_at) VALUES ('gone', 3, ?, 'p', 'm', 1)", floatLE([]float32{1, 0, 0})); err != nil {
		t.Fatal(err)
	}
	hits, err := lib.SearchCardsVector(ctx, []float32{1, 0, 0}, "p", "m", 5)
	if err != nil {
		t.Fatal(err)
	}
	if len(hits) != 2 || hits[0].Card.ID != "near" || hits[0].Score < 0.99 {
		t.Fatalf("vector hits: %+v", hits)
	}
	if hits[1].Card.ID != "far" || hits[1].Score != 0 {
		t.Fatalf("second hit: %+v", hits[1])
	}
	if out, err := lib.SearchCardsVector(ctx, nil, "p", "m", 5); err != nil || len(out) != 0 {
		t.Fatalf("empty query: %v %v", out, err)
	}
}

func TestSearchCardsHybridFusesFTSAndVector(t *testing.T) {
	db := openVectorDB(t)
	lib := &Library{db: db, writable: true}
	ctx := t.Context()
	insertCardWithVector(t, db, "vec", []float32{1, 0, 0})
	if _, err := db.Exec("UPDATE cards SET headline = '性能优化指南', details = '讨论查询计划' WHERE id = 'vec'"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("INSERT INTO fts_cards (card_id, headline, details, summary, category, tags) SELECT id, headline, details, summary, category, tags_json FROM cards WHERE id = 'vec'"); err != nil {
		t.Fatal(err)
	}
	insertCardWithVector(t, db, "only-fts", []float32{0, 1, 0})
	if _, err := db.Exec("UPDATE cards SET headline = '无关卡片' WHERE id = 'only-fts'"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("INSERT INTO fts_cards (card_id, headline, details, summary, category, tags) SELECT id, headline, details, summary, category, tags_json FROM cards WHERE id = 'only-fts'"); err != nil {
		t.Fatal(err)
	}
	hits, err := lib.SearchCardsHybrid(ctx, "性能", []float32{1, 0, 0}, "p", "m", 5)
	if err != nil {
		t.Fatal(err)
	}
	if len(hits) != 2 || hits[0].Card.ID != "vec" {
		t.Fatalf("hybrid hits: %+v", hits)
	}
	if hits[0].Score <= hits[1].Score {
		t.Fatalf("rrf ordering: %+v", hits)
	}
	if hits[1].Card.ID != "only-fts" {
		t.Fatalf("second hit: %+v", hits[1])
	}
}

func TestNoteChunkVectorLifecycle(t *testing.T) {
	db := openVectorDB(t)
	lib := &Library{db: db, writable: true}
	ctx := t.Context()
	if _, err := db.Exec("INSERT INTO notes (id, title, body_md, created_at, updated_at) VALUES ('n1', '笔记一', '正文', 1, 1)"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("INSERT INTO note_chunks (note_id, chunk_index, content, char_start, char_end, content_revision) VALUES ('n1', 0, '第一块内容', 0, 5, 2)"); err != nil {
		t.Fatal(err)
	}
	missing, err := lib.ListNoteChunkTexts(ctx, 10, "p", "m")
	if err != nil || len(missing) != 1 || missing[0].ContentRevision != 2 {
		t.Fatalf("missing chunks: %+v, %v", missing, err)
	}
	saved, err := lib.SaveNoteChunkEmbeddings(ctx, []NoteChunkEmbeddingItem{{NoteID: "n1", ChunkIndex: 0, ContentRevision: 2, Embedding: []float32{1, 0, 0}}}, "p", "m")
	if err != nil || saved != 1 {
		t.Fatalf("save embeddings: %d, %v", saved, err)
	}
	missing, err = lib.ListNoteChunkTexts(ctx, 10, "p", "m")
	if err != nil || len(missing) != 0 {
		t.Fatalf("after save: %+v, %v", missing, err)
	}
	hits, err := lib.SearchNoteChunksVector(ctx, []float32{1, 0, 0}, "p", "m", 5)
	if err != nil || len(hits) != 1 || hits[0].NoteID != "n1" || hits[0].NoteTitle != "笔记一" || hits[0].Content != "第一块内容" {
		t.Fatalf("chunk vector hits: %+v, %v", hits, err)
	}
	// 修订号过期：分块重建后旧向量不参与召回。
	if _, err := db.Exec("UPDATE note_chunks SET content_revision = 3, content = '新内容' WHERE note_id = 'n1'"); err != nil {
		t.Fatal(err)
	}
	hits, err = lib.SearchNoteChunksVector(ctx, []float32{1, 0, 0}, "p", "m", 5)
	if err != nil || len(hits) != 0 {
		t.Fatalf("stale revision hits: %+v, %v", hits, err)
	}
	missing, err = lib.ListNoteChunkTexts(ctx, 10, "p", "m")
	if err != nil || len(missing) != 1 {
		t.Fatalf("stale revision missing: %+v, %v", missing, err)
	}
	if _, err := (&Library{db: db, writable: false}).SaveNoteChunkEmbeddings(ctx, nil, "p", "m"); err != ErrReadOnly {
		t.Fatalf("read-only save: %v", err)
	}
}
