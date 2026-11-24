package main

import (
	"database/sql"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"knowflick.local/workbench-go/internal/library"
)

func TestMaterialAttachmentsRemainAvailableBeyondMaterialList(t *testing.T) {
	service, dir := openFixtureCopy(t)
	ctx := t.Context()
	writable, err := service.EnableEditing(ctx)
	if err != nil {
		t.Fatal(err)
	}
	db, err := sql.Open("sqlite", filepath.Join(dir, "knowflick.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	_, err = db.Exec(`WITH RECURSIVE recent(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM recent WHERE i<205)
		INSERT INTO materials (id, source_type, title, raw_text, content_hash, created_at, updated_at)
		SELECT 'recent-' || i, 'manual', '正文素材', '正文', 'text-' || i, 2000000000000+i, 2000000000000+i FROM recent`)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`INSERT INTO materials (id, source_type, title, raw_text, content_hash, media_path, created_at, updated_at, is_deleted) VALUES
		('duplicate-attachment','image','旧标题','正文','image','media/image/material.png',10,10,0),
		('recording-attachment','audio','录音','正文','audio','media/audio/recording.wav',20,20,0),
		('deleted-attachment','image','回收站图片','正文','deleted','media/image/deleted.png',30,30,1),
		('outside-attachment','image','无效路径','正文','invalid','media/image/../outside.png',40,40,0)`)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.ListMaterialAttachments(ctx, writable.Generation-1); err == nil {
		t.Fatal("accepted a stale library generation")
	}
	items, err := service.ListMaterialAttachments(ctx, writable.Generation)
	want := []library.MaterialAttachment{
		{Path: "media/image/material.png", Title: "素材附件"},
		{Path: "media/audio/recording.wav", Title: "录音"},
	}
	if err != nil || !reflect.DeepEqual(items, want) {
		t.Fatalf("attachment list: %v, %v", items, err)
	}
	page, err := service.ListNotes(ctx, writable.Generation, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Notes) == 0 {
		t.Fatal("fixture lacks an active note")
	}
	note := page.Notes[0]
	note.Body = "前文\n\n![录音](" + items[1].Path + ")\n\n后文"
	outcome, err := service.SaveNote(ctx, writable.Generation, note, note.Revision)
	if err != nil || outcome.Revision <= note.Revision {
		t.Fatalf("save note: %+v, %v", outcome, err)
	}
	var body string
	if err := db.QueryRow("SELECT body_md FROM notes WHERE id = ?", note.ID).Scan(&body); err != nil || body != note.Body {
		t.Fatalf("saved reference: %q, %v", body, err)
	}
	if _, err := os.Stat(filepath.Join(dir, "media")); err == nil || !os.IsNotExist(err) {
		t.Fatalf("listing and saving references must not create files: %v", err)
	}
	var count int
	if err := db.QueryRow("SELECT COUNT(*) FROM fts_notes WHERE note_id = ? AND body LIKE ?", note.ID, "%"+items[1].Path+"%").Scan(&count); err != nil || count != 1 {
		t.Fatalf("indexed note reference: %d, %v", count, err)
	}
}
