package main

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"knowflick.local/workbench-go/internal/library"
	"knowflick.local/workbench-go/internal/mcpgrants"
)

func TestPreviewMcpGrantFlowOnRustLibrary(t *testing.T) {
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
	service := &PreviewService{initialPath: path, path: path}
	t.Cleanup(func() { _ = service.ServiceShutdown() })
	ctx := context.Background()
	opened, err := service.OpenInitialLibrary(ctx)
	if err != nil {
		t.Fatal(err)
	}
	empty, err := service.ListMcpGrants(ctx, opened.Generation)
	if empty == nil {
		t.Fatal("empty grants must encode as [] not null")
	}
	if err != nil || len(empty) != 0 {
		t.Fatalf("fixture grants: %+v, %v", empty, err)
	}
	project := "project-1"
	if _, err := service.CreateMcpGrant(ctx, opened.Generation, mcpgrants.Request{
		ClientLabel: "客户端", Scope: "project", ProjectID: &project,
	}); !errors.Is(err, library.ErrReadOnly) {
		t.Fatalf("read-only create: %v", err)
	}
	writable, err := service.EnableEditing(ctx)
	if err != nil {
		t.Fatal(err)
	}
	created, err := service.CreateMcpGrant(ctx, writable.Generation, mcpgrants.Request{
		ClientLabel: "  客户端  ", Scope: "project", ProjectID: &project,
	})
	if err != nil || len(created.Token) != 64 {
		t.Fatalf("create: %+v, %v", created, err)
	}
	if created.Grant.ClientLabel != "客户端" || created.Grant.ProjectID == nil || *created.Grant.ProjectID != "project-1" {
		t.Fatalf("grant: %+v", created.Grant)
	}
	if _, err := service.CreateMcpGrant(ctx, writable.Generation, mcpgrants.Request{
		ClientLabel: "越权", Scope: "project", ProjectID: &project, CardWrite: true,
	}); err == nil {
		t.Fatal("project grant with card write accepted")
	}
	libraryGrant, err := service.CreateMcpGrant(ctx, writable.Generation, mcpgrants.Request{
		ClientLabel: "全库客户端", Scope: "library", LibraryRead: true,
	})
	if err != nil || libraryGrant.Grant.ProjectID != nil {
		t.Fatalf("library grant: %+v, %v", libraryGrant, err)
	}
	grants, err := service.ListMcpGrants(ctx, writable.Generation)
	if err != nil || len(grants) != 2 {
		t.Fatalf("grants: %+v, %v", grants, err)
	}
	encoded, err := json.Marshal(grants)
	if err != nil || strings.Contains(string(encoded), created.Token) {
		t.Fatalf("token leaked into list: %s, %v", encoded, err)
	}
	if changed, err := service.RevokeMcpGrant(ctx, writable.Generation, created.Grant.ID); err != nil || !changed {
		t.Fatalf("revoke: %v, %v", changed, err)
	}
	if changed, err := service.RevokeMcpGrant(ctx, writable.Generation, created.Grant.ID); err != nil || !changed {
		t.Fatalf("re-revoke: %v, %v", changed, err)
	}
	if changed, err := service.RevokeMcpGrant(ctx, writable.Generation, "missing"); err != nil || changed {
		t.Fatalf("missing revoke: %v, %v", changed, err)
	}
	paths, err := service.McpServerPaths(ctx, writable.Generation)
	if err != nil {
		t.Fatal(err)
	}
	if !filepath.IsAbs(paths.ScriptPath) || !strings.HasSuffix(paths.ScriptPath, filepath.Join("tools", "mcp-server.mjs")) {
		t.Fatalf("script path: %+v", paths)
	}
	if paths.LibraryDir != filepath.Dir(path) {
		t.Fatalf("library dir: %+v", paths)
	}
}
