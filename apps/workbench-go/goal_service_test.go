package main

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"knowflick.local/workbench-go/internal/goals"
	"knowflick.local/workbench-go/internal/library"
)

func TestPreviewGoalFlowOnRustLibrary(t *testing.T) {
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
	active, err := service.ListGoals(ctx, opened.Generation)
	if err != nil || len(active) != 1 || active[0].ID != "goal-1" {
		t.Fatalf("fixture goals: %+v, %v", active, err)
	}
	if _, err := service.CreateGoal(ctx, opened.Generation, "目标", "条件", "project-1"); !errors.Is(err, library.ErrReadOnly) {
		t.Fatalf("read-only create: %v", err)
	}
	writable, err := service.EnableEditing(ctx)
	if err != nil {
		t.Fatal(err)
	}
	id, err := service.CreateGoal(ctx, writable.Generation, "  目标  ", "  条件  ", "project-1")
	if err != nil || id == "" {
		t.Fatalf("create: %q, %v", id, err)
	}
	if _, err := service.CreateGoal(ctx, writable.Generation, "x", "y", "missing-project"); err == nil {
		t.Fatal("missing scope accepted")
	}
	if err := service.LinkGoalEvidence(ctx, writable.Generation, id, "note-active", "note"); err != nil {
		t.Fatal(err)
	}
	if err := service.LinkGoalEvidence(ctx, writable.Generation, id, "material-active", "material"); err != nil {
		t.Fatal(err)
	}
	if err := service.LinkGoalEvidence(ctx, writable.Generation, id, "missing", "note"); err == nil {
		t.Fatal("missing evidence accepted")
	}
	active, err = service.ListGoals(ctx, writable.Generation)
	if err != nil || len(active) != 2 {
		t.Fatalf("active goals: %+v, %v", active, err)
	}
	var created *goals.Goal
	for i := range active {
		if active[i].ID == id {
			created = &active[i]
		}
	}
	if created == nil || created.EvidenceCount != 2 || created.Title != "目标" || created.Scope == nil || *created.Scope != "project-1" {
		t.Fatalf("created goal: %+v", created)
	}
	now := time.Now().UnixMilli()
	snapshot, err := service.GoalReview(ctx, writable.Generation, now-60000, now+60000)
	// 快照包含周期内新建及此前仍活跃的目标（goal-1 较早创建但未结束），证据只取闭区间内的。
	if err != nil || len(snapshot.Goals) != 2 || len(snapshot.Evidence) != 2 {
		t.Fatalf("review: %+v, %v", snapshot, err)
	}
	if achieved, err := service.AchieveGoal(ctx, writable.Generation, id, "已确认达成"); err != nil || !achieved {
		t.Fatalf("achieve: %v, %v", achieved, err)
	}
	if achieved, err := service.AchieveGoal(ctx, writable.Generation, id, "再来"); err != nil || achieved {
		t.Fatalf("re-achieve: %v, %v", achieved, err)
	}
	active, err = service.ListGoals(ctx, writable.Generation)
	if err != nil || len(active) != 1 || active[0].ID != "goal-1" {
		t.Fatalf("active after achieve: %+v, %v", active, err)
	}
}
