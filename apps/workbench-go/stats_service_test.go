package main

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestPreviewStatsOnRustLibrary(t *testing.T) {
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
	got, err := service.GetStats(ctx, opened.Generation)
	if err != nil {
		t.Fatal(err)
	}
	// 夹具里那张卡还没学过：收藏/已学/待复习都应为 0。
	if got.TotalCards != 1 || got.TotalMaterials != 1 || got.InboxMaterials != 1 || got.SeenCards != 0 || got.DueCards != 0 {
		t.Fatalf("fixture stats: %+v", got)
	}
}
