package library

import (
	"testing"
)

func TestBackfillMaterialFTSOnlyFillsMissingLiveRows(t *testing.T) {
	db := openImportDB(t)
	lib := &Library{db: db, writable: true}
	ctx := t.Context()
	_, err := db.Exec(`INSERT INTO materials (id, source_type, title, raw_text, content_hash, metadata_json, inbox_status, created_at, updated_at, is_deleted)
		VALUES ('indexed','manual','已有索引','正文','h1','{}','inbox',1,1,0),
		       ('missing','manual','缺索引','待补正文','h2','{}','inbox',2,2,0),
		       ('deleted','manual','删除素材','不该补','h3','{}','inbox',3,3,1)`)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("INSERT INTO fts_materials (material_id,title,raw_text,source_url) VALUES ('indexed','已有索引','正文','')"); err != nil {
		t.Fatal(err)
	}
	count, err := lib.BackfillMaterialFTS(ctx)
	if err != nil || count != 1 {
		t.Fatalf("backfill: %d, %v", count, err)
	}
	var title, text string
	if err := db.QueryRow("SELECT title, raw_text FROM fts_materials WHERE material_id='missing'").Scan(&title, &text); err != nil || title != "缺索引" || text != "待补正文" {
		t.Fatalf("backfilled row: %q %q, %v", title, text, err)
	}
	if count, err := lib.BackfillMaterialFTS(ctx); err != nil || count != 0 {
		t.Fatalf("second backfill: %d, %v", count, err)
	}
	var deleted int
	if err := db.QueryRow("SELECT COUNT(*) FROM fts_materials WHERE material_id='deleted'").Scan(&deleted); err != nil || deleted != 0 {
		t.Fatalf("deleted row indexed: %d, %v", deleted, err)
	}
	if _, err := (&Library{db: db, writable: false}).BackfillMaterialFTS(ctx); err != ErrReadOnly {
		t.Fatalf("read-only backfill: %v", err)
	}
}
