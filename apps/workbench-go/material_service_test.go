package main

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"knowflick.local/workbench-go/internal/library"

	_ "modernc.org/sqlite"
)

func TestPreviewMaterialFlowOnRustLibrary(t *testing.T) {
	fixture := os.Getenv("KF_SYSTEM_BACKUP_DB_FIXTURE_DIR")
	if fixture == "" {
		t.Skip("set KF_SYSTEM_BACKUP_DB_FIXTURE_DIR to the Rust-created database fixture")
	}
	dir := t.TempDir()
	path := filepath.Join(dir, "knowflick.db")
	data, err := os.ReadFile(filepath.Join(fixture, "knowflick.db"))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	service := &PreviewService{initialPath: path}
	t.Cleanup(func() { _ = service.ServiceShutdown() })
	ctx := context.Background()
	opened, err := service.OpenInitialLibrary(ctx)
	if err != nil {
		t.Fatal(err)
	}
	inbox, err := service.ListMaterials(ctx, opened.Generation, true, 100, 0)
	if err != nil || len(inbox) != 1 || inbox[0].ID != "material-active" || inbox[0].InboxStatus != "inbox" {
		t.Fatalf("inbox: %+v, %v", inbox, err)
	}
	all, err := service.ListMaterials(ctx, opened.Generation, false, 100, 0)
	if err != nil || len(all) != 1 {
		t.Fatalf("all materials: %+v, %v", all, err)
	}
	hits, err := service.SearchMaterials(ctx, opened.Generation, "素材", 100)
	if err != nil || len(hits) != 1 || hits[0].ID != "material-active" {
		t.Fatalf("search: %+v, %v", hits, err)
	}
	if err := service.UpdateMaterialStatus(ctx, opened.Generation, "material-active", "dismissed"); !errors.Is(err, library.ErrReadOnly) {
		t.Fatalf("read-only status: %v", err)
	}
	writable, err := service.EnableEditing(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err := service.UpdateMaterialStatus(ctx, writable.Generation, "material-active", "bogus"); err == nil {
		t.Fatal("invalid status accepted")
	}
	// 夹具里 material-active 已经有卡片：转卡应复用而不是再建一张。
	created, err := service.ConvertMaterialToCard(ctx, writable.Generation, "material-active")
	if err != nil || created {
		t.Fatalf("convert existing: %v, %v", created, err)
	}
	again, err := service.ConvertMaterialToCard(ctx, writable.Generation, "material-active")
	if err != nil || again {
		t.Fatalf("second convert: %v, %v", again, err)
	}
	db, err := sql.Open("sqlite", "file:"+path+"?mode=rw&_pragma=busy_timeout(10000)")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec("INSERT INTO materials (id,source_type,title,source_url,raw_text,content_hash,metadata_json,inbox_status,created_at,updated_at) VALUES ('material-new','web','新素材',NULL,'正文 zebra','hash-new','{}','inbox',1,1)"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("INSERT INTO fts_materials (material_id,title,raw_text,source_url) VALUES ('material-new','新素材','正文 zebra','')"); err != nil {
		t.Fatal(err)
	}
	created, err = service.ConvertMaterialToCard(ctx, writable.Generation, "material-new")
	if err != nil || !created {
		t.Fatalf("convert new: %v, %v", created, err)
	}
	var cards int
	if err := db.QueryRow("SELECT COUNT(*) FROM cards WHERE is_deleted = 0").Scan(&cards); err != nil || cards != 2 {
		t.Fatalf("active cards after convert: %d, %v", cards, err)
	}
	status, err := service.ListMaterials(ctx, writable.Generation, true, 100, 0)
	if err != nil || len(status) != 0 {
		t.Fatalf("inbox after convert: %+v, %v", status, err)
	}
	if _, err := service.ConvertMaterialToCard(ctx, writable.Generation, "material-deleted"); err == nil {
		t.Fatal("deleted material converted")
	}
	captured, err := service.CaptureMaterial(ctx, writable.Generation, "", "闪念正文 zebra", "https://example.org/note")
	if err != nil || captured == "" {
		t.Fatalf("capture: %q, %v", captured, err)
	}
	if _, err := service.CaptureMaterial(ctx, writable.Generation, "", "", ""); err == nil {
		t.Fatal("empty capture accepted")
	}
	inbox, err = service.ListMaterials(ctx, writable.Generation, true, 100, 0)
	if err != nil || len(inbox) != 1 || inbox[0].ID != captured || inbox[0].SourceType != "web" {
		t.Fatalf("inbox after capture: %+v, %v", inbox, err)
	}
}
