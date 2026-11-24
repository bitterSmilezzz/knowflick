package library

import (
	"errors"
	"testing"
)

func TestRestoreRevisionAppendsHistoryAndRebuildsSearch(t *testing.T) {
	lib, _ := newWritable(t)
	ctx := t.Context()
	note := draftNote("revision-test", "初稿", "恢复正文 oldphrase")
	if _, err := lib.Upsert(ctx, note, 0, 100); err != nil {
		t.Fatal(err)
	}
	note.Title, note.Body, note.Pinned = "第二稿", "updatedphrase", true
	if _, err := lib.Upsert(ctx, note, 1, 200); err != nil {
		t.Fatal(err)
	}
	history, err := lib.History(ctx, note.ID)
	if err != nil || len(history) != 2 || history[0].Revision != 2 || history[1].Chars != 14 {
		t.Fatalf("history: %+v, %v", history, err)
	}
	missing, err := lib.ReadRevision(ctx, note.ID, 99)
	if err != nil || missing != nil {
		t.Fatalf("missing revision: %+v, %v", missing, err)
	}
	var conflict *ConflictError
	if _, err := lib.RestoreRevision(ctx, note.ID, 1, 1, 300); !errors.As(err, &conflict) || conflict.CurrentRevision != 2 {
		t.Fatalf("expected revision conflict, got %v", err)
	}

	outcome, err := lib.RestoreRevision(ctx, note.ID, 1, 2, 300)
	if err != nil || outcome.Revision != 3 {
		t.Fatalf("restore: %+v, %v", outcome, err)
	}
	restored, err := lib.get(ctx, note.ID)
	if err != nil || restored == nil || restored.Title != "初稿" || restored.Body != "恢复正文 oldphrase" || !restored.Pinned || restored.UpdatedAt != 300 {
		t.Fatalf("current note: %+v, %v", restored, err)
	}
	previous, err := lib.ReadRevision(ctx, note.ID, 2)
	if err != nil || previous == nil || previous.BodyMD != "updatedphrase" {
		t.Fatalf("previous revision: %+v, %v", previous, err)
	}
	history, err = lib.History(ctx, note.ID)
	if err != nil || len(history) != 3 || history[0].Revision != 3 {
		t.Fatalf("history after restore: %+v, %v", history, err)
	}
	var indexedBody string
	if err := lib.db.QueryRowContext(ctx, "SELECT body FROM fts_notes WHERE note_id = ?", note.ID).Scan(&indexedBody); err != nil || indexedBody != restored.Body {
		t.Fatalf("indexed body: %q, %v", indexedBody, err)
	}
	var chunkRevision int64
	if err := lib.db.QueryRowContext(ctx, "SELECT content_revision FROM note_chunks WHERE note_id = ?", note.ID).Scan(&chunkRevision); err != nil || chunkRevision != 3 {
		t.Fatalf("chunk revision: %d, %v", chunkRevision, err)
	}

	outcome, err = lib.RestoreRevision(ctx, note.ID, 1, 3, 400)
	if err != nil || outcome.Revision != 3 {
		t.Fatalf("repeat restore: %+v, %v", outcome, err)
	}
	if _, err := lib.Delete(ctx, note.ID, 500); err != nil {
		t.Fatal(err)
	}
	if _, err := lib.RestoreRevision(ctx, note.ID, 2, 3, 600); err == nil {
		t.Fatal("restore accepted a deleted note")
	}
}
