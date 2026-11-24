package main

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"knowflick.local/workbench-go/internal/library"
)

func TestPreviewClaimFlowOnRustLibrary(t *testing.T) {
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
	all, err := service.ListClaims(ctx, opened.Generation, "all", 0)
	if err != nil || len(all) != 1 || all[0].ID != "claim-1" {
		t.Fatalf("fixture claims: %+v, %v", all, err)
	}
	if _, err := service.AddClaim(ctx, opened.Generation, "fact", "新断言", []string{"note-active"}, ""); !errors.Is(err, library.ErrReadOnly) {
		t.Fatalf("read-only add: %v", err)
	}
	writable, err := service.EnableEditing(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if confirmed, err := service.ConfirmClaim(ctx, writable.Generation, "claim-1"); err != nil || !confirmed {
		t.Fatalf("confirm: %v, %v", confirmed, err)
	}
	// 夹具这条断言的 scope 为空，不属于全局问答记忆。
	if answers, err := service.ListClaims(ctx, writable.Generation, "global", time.Now().UnixMilli()); err != nil || len(answers) != 0 {
		t.Fatalf("global answers: %+v, %v", answers, err)
	}
	if paused, err := service.PauseClaim(ctx, writable.Generation, "claim-1"); err != nil || !paused {
		t.Fatalf("pause: %v, %v", paused, err)
	}
	if resumed, err := service.ResumeClaim(ctx, writable.Generation, "claim-1"); err != nil || !resumed {
		t.Fatalf("resume: %v, %v", resumed, err)
	}
	id, err := service.AddClaim(ctx, writable.Generation, "fact", "断言二", []string{"note-active"}, "")
	if err != nil || id == "" {
		t.Fatalf("add: %q, %v", id, err)
	}
	if denied, err := service.DenyClaim(ctx, writable.Generation, id); err != nil || !denied {
		t.Fatalf("deny: %v, %v", denied, err)
	}
	if _, err := service.AddClaim(ctx, writable.Generation, "fact", "断言三", []string{"note-active"}, ""); err == nil || !strings.Contains(err.Error(), "已被否认过") {
		t.Fatalf("rebuild after deny: %v", err)
	}
	denials, err := service.ListClaimDenials(ctx, writable.Generation)
	if err != nil || len(denials) != 1 {
		t.Fatalf("denials: %+v, %v", denials, err)
	}
	if cleared, err := service.ClearClaimDenial(ctx, writable.Generation, []string{"note-active"}); err != nil || !cleared {
		t.Fatalf("clear denial: %v, %v", cleared, err)
	}
	if _, err := service.AddClaim(ctx, writable.Generation, "fact", "断言四", []string{"note-active"}, ""); err != nil {
		t.Fatalf("rebuild after clearing: %v", err)
	}
	if claims, err := service.ListProjectClaims(ctx, writable.Generation, "project-1"); err != nil || len(claims) != 0 {
		t.Fatalf("project claims: %+v, %v", claims, err)
	}
}
