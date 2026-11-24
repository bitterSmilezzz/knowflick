package library

import (
	"database/sql"
	"path/filepath"
	"testing"
)

func openNoteRestoreDB(t *testing.T) *Library {
	t.Helper()
	uri := "file:" + filepath.Join(t.TempDir(), "knowflick.db") + "?mode=rwc"
	db, err := sql.Open("sqlite", uri)
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	schema := []string{
		"CREATE TABLE notes (id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', body_md TEXT NOT NULL DEFAULT '', notebook TEXT, tags_json TEXT NOT NULL DEFAULT '[]', is_pinned INTEGER NOT NULL DEFAULT 0, is_favorite INTEGER NOT NULL DEFAULT 0, archived_at INTEGER, source_material_id TEXT, current_revision INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, is_deleted INTEGER NOT NULL DEFAULT 0, deleted_at INTEGER, exclude_from_profile INTEGER NOT NULL DEFAULT 0)",
		"CREATE TABLE note_revisions (note_id TEXT NOT NULL, revision INTEGER NOT NULL, title TEXT NOT NULL, body_md TEXT NOT NULL, saved_at INTEGER NOT NULL, PRIMARY KEY(note_id, revision))",
		"CREATE TABLE note_chunks (note_id TEXT NOT NULL, chunk_index INTEGER NOT NULL, content TEXT NOT NULL, char_start INTEGER NOT NULL, char_end INTEGER NOT NULL, content_revision INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(note_id, chunk_index))",
		"CREATE VIRTUAL TABLE fts_notes USING fts5(note_id UNINDEXED, title, body)",
		"CREATE VIRTUAL TABLE fts_note_chunks USING fts5(note_id UNINDEXED, chunk_index UNINDEXED, content)",
	}
	for _, statement := range schema {
		if _, err := db.Exec(statement); err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() { _ = db.Close() })
	return &Library{db: db, writable: true}
}

func TestRestoreNoteCreatesUpdatesSkips(t *testing.T) {
	lib := openNoteRestoreDB(t)
	ctx := t.Context()
	note := Note{ID: "n1", Title: "标题一", Body: "正文一", TagsJSON: "[]", CreatedAt: 10, UpdatedAt: 10, Revision: 2}
	outcome, err := lib.RestoreNoteWithHistory(ctx, note, 2, nil, nil)
	if err != nil || outcome.Status != RestoreCreated || outcome.Revision != 2 {
		t.Fatalf("create: %+v, %v", outcome, err)
	}
	var chunkCount int
	if err := lib.db.QueryRow("SELECT COUNT(*) FROM note_chunks WHERE note_id='n1'").Scan(&chunkCount); err != nil || chunkCount == 0 {
		t.Fatalf("chunks: %d %v", chunkCount, err)
	}
	var ftsCount int
	if err := lib.db.QueryRow("SELECT COUNT(*) FROM fts_notes WHERE note_id='n1'").Scan(&ftsCount); err != nil || ftsCount == 0 {
		t.Fatalf("fts: %d %v", ftsCount, err)
	}
	// 本地相同：幂等 current。
	outcome, err = lib.RestoreNoteWithHistory(ctx, note, 2, nil, nil)
	if err != nil || outcome.Status != RestoreCurrent {
		t.Fatalf("idempotent: %+v, %v", outcome, err)
	}
	// 本地更新：跳过。
	newer := note
	newer.Body = "本地更新的正文"
	if _, err := lib.Upsert(ctx, newer, 2, 20); err != nil {
		t.Fatal(err)
	}
	outcome, err = lib.RestoreNoteWithHistory(ctx, note, 2, nil, nil)
	if err != nil || outcome.Status != RestoreSkippedLocalNew {
		t.Fatalf("skip newer: %+v, %v", outcome, err)
	}
	// 本地落后：更新到备份修订。
	older, err := lib.get(ctx, "n1")
	if err != nil {
		t.Fatal(err)
	}
	_ = older
	if _, err := lib.db.Exec("UPDATE notes SET current_revision = 1, body_md = '旧正文' WHERE id = 'n1'"); err != nil {
		t.Fatal(err)
	}
	outcome, err = lib.RestoreNoteWithHistory(ctx, note, 2, nil, nil)
	if err != nil || outcome.Status != RestoreUpdated {
		t.Fatalf("update: %+v, %v", outcome, err)
	}
	if _, err := (&Library{db: lib.db, writable: false}).RestoreNoteWithHistory(ctx, note, 2, nil, nil); err != ErrReadOnly {
		t.Fatalf("read-only restore: %v", err)
	}
}

func TestRestoreNoteHistoryAndBinding(t *testing.T) {
	lib := openNoteRestoreDB(t)
	ctx := t.Context()
	note := Note{ID: "n2", Title: "标题二改", Body: "正文二改", TagsJSON: "[]", CreatedAt: 10, UpdatedAt: 20}
	history := []backupNoteRevision{
		{NoteID: "n2", Revision: 1, Title: "标题二", BodyMD: "正文二", SavedAt: 10},
		{NoteID: "n2", Revision: 2, Title: "标题二改", BodyMD: "正文二改", SavedAt: 20},
	}
	outcome, err := lib.RestoreNoteWithHistory(ctx, note, 2, nil, history)
	if err != nil || outcome.Status != RestoreCreated {
		t.Fatalf("create with history: %+v, %v", outcome, err)
	}
	var revisions int
	if err := lib.db.QueryRow("SELECT COUNT(*) FROM note_revisions WHERE note_id='n2'").Scan(&revisions); err != nil || revisions != 2 {
		t.Fatalf("revisions: %d %v", revisions, err)
	}
	// 历史与当前修订不一致。
	conflict := []backupNoteRevision{{NoteID: "n2", Revision: 2, Title: "不一致", BodyMD: "不一致", SavedAt: 20}}
	if _, err := lib.RestoreNoteWithHistory(ctx, note, 2, nil, conflict); err == nil {
		t.Fatal("inconsistent history accepted")
	}
	// 绑定核对：期望空但本地存在。
	empty := ""
	if _, err := lib.RestoreNoteWithHistory(ctx, note, 2, &empty, nil); err == nil {
		t.Fatal("binding mismatch accepted")
	}
	if _, err := lib.RestoreNoteWithHistory(ctx, Note{ID: "missing", Title: "x", Body: "y"}, 2, &empty, nil); err == nil {
		t.Fatal("missing binding mismatch accepted")
	}
}
