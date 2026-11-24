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
	if _, err := service.CaptureCapsuleMaterial(ctx, "只读胶囊草稿"); err == nil {
		t.Fatal("capsule capture accepted in a read-only library")
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
	capsuleID, err := service.CaptureCapsuleMaterial(ctx, "胶囊速记")
	if err != nil || capsuleID == "" {
		t.Fatalf("capsule capture: %q, %v", capsuleID, err)
	}
	var body, statusValue string
	if err := db.QueryRow("SELECT raw_text, inbox_status FROM materials WHERE id = ?", capsuleID).Scan(&body, &statusValue); err != nil || body != "胶囊速记" || statusValue != "inbox" {
		t.Fatalf("capsule row: %q %q %v", body, statusValue, err)
	}
}

func TestMailboxMaterialFlowOnRustLibrary(t *testing.T) {
	fixture := os.Getenv("KF_GO_RESTORE_TARGET_DIR")
	if fixture == "" {
		t.Skip("set KF_GO_RESTORE_TARGET_DIR to an empty Rust-created database fixture")
	}
	path := filepath.Join(t.TempDir(), "knowflick.db")
	fixtureBytes, err := os.ReadFile(filepath.Join(fixture, "knowflick.db"))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, fixtureBytes, 0600); err != nil {
		t.Fatal(err)
	}
	service := &PreviewService{initialPath: path}
	t.Cleanup(func() { _ = service.ServiceShutdown() })
	ctx := t.Context()
	opened, err := service.OpenInitialLibrary(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.SaveMailDigest(ctx, opened.Generation, "标题", "正文", "{}"); !errors.Is(err, library.ErrReadOnly) {
		t.Fatalf("read-only digest: %v", err)
	}
	writable, err := service.EnableEditing(ctx)
	if err != nil {
		t.Fatal(err)
	}
	generation := writable.Generation
	db, err := sql.Open("sqlite", "file:"+path+"?mode=rw")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	for _, material := range []library.ImportedMaterial{
		{ID: "mail-old", SourceType: "email", Title: "原件", RawText: "邮件正文", MetadataJSON: "{}", InboxStatus: "inbox", CreatedAt: 1, UpdatedAt: 1},
		{ID: "mail-deleted", SourceType: "email", RawText: "已删除邮件", MetadataJSON: "{}", InboxStatus: "inbox"},
		{ID: "other", SourceType: "manual", RawText: "其他素材", MetadataJSON: "{}", InboxStatus: "inbox"},
	} {
		if inserted, err := library.SaveImportedMaterial(ctx, db, material); err != nil || !inserted {
			t.Fatalf("seed %s: %v", material.ID, err)
		}
	}
	if _, err := db.ExecContext(ctx, "UPDATE materials SET is_deleted = 1 WHERE id = 'mail-deleted'"); err != nil {
		t.Fatal(err)
	}
	if err := service.UpdateMaterialStatus(ctx, generation, "mail-old", "processed"); err != nil {
		t.Fatal(err)
	}
	emails, err := service.ListEmailMaterials(ctx, generation)
	if err != nil || len(emails) != 1 || emails[0].ID != "mail-old" || emails[0].InboxStatus != "processed" || emails[0].RawText != "邮件正文" {
		t.Fatalf("emails: %+v, %v", emails, err)
	}
	if deleted, err := service.GetMaterial(ctx, generation, "mail-deleted"); err != nil || deleted != nil {
		t.Fatalf("deleted email: %+v, %v", deleted, err)
	}
	if _, err := service.GetMaterial(ctx, opened.Generation, "mail-old"); err == nil {
		t.Fatal("stale library generation accepted")
	}
	const markdown = "# 摘要\n\n邮件原件 [邮件 1]"
	const metadata = "{\"generatedBy\":\"mail-summary\",\"sources\":[{\"materialId\":\"mail-old\",\"subject\":\"原件\",\"from\":\"\",\"date\":\"\"}]}"
	id, err := service.SaveMailDigest(ctx, generation, "邮件整理", markdown, metadata)
	if err != nil {
		t.Fatal(err)
	}
	saved, err := service.GetMaterial(ctx, generation, id)
	if err != nil || saved == nil || saved.SourceType != "email-digest" || saved.RawText != markdown || saved.MetadataJSON != metadata {
		t.Fatalf("digest: %+v, %v", saved, err)
	}
	hits, err := service.SearchMaterials(ctx, generation, "邮件整理", 10)
	if err != nil || len(hits) != 1 || hits[0].ID != id {
		t.Fatalf("digest search: %+v, %v", hits, err)
	}
}
