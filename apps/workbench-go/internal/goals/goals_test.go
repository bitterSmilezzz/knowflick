package goals

import (
	"context"
	"database/sql"
	"path/filepath"
	"strings"
	"testing"

	_ "modernc.org/sqlite"
)

const goalSchema = `
CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, archived_at INTEGER);
CREATE TABLE notes (id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', body_md TEXT NOT NULL DEFAULT '', is_deleted INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE materials (id TEXT PRIMARY KEY, title TEXT NOT NULL, raw_text TEXT NOT NULL, is_deleted INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE goals (id TEXT PRIMARY KEY, title TEXT NOT NULL, done_criteria TEXT NOT NULL, scope TEXT, created_at INTEGER NOT NULL, achieved_at INTEGER, abandoned_at INTEGER, review_note TEXT NOT NULL DEFAULT '');
CREATE TABLE goal_evidence (goal_id TEXT NOT NULL, evidence_id TEXT NOT NULL, kind TEXT NOT NULL, linked_at INTEGER NOT NULL, PRIMARY KEY (goal_id, evidence_id));
`

func openGoals(t *testing.T) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", "file:"+filepath.Join(t.TempDir(), "lib.db")+"?mode=rwc")
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(goalSchema); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("INSERT INTO projects (id,name,created_at,updated_at) VALUES ('p1','项目甲',1,1),('p2','项目乙',1,1)"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("UPDATE projects SET archived_at = 2 WHERE id = 'p2'"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("INSERT INTO notes (id,title,created_at,updated_at) VALUES ('n1','笔记一',1,1),('n2','已删笔记',1,1)"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("UPDATE notes SET is_deleted = 1 WHERE id = 'n2'"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("INSERT INTO materials (id,title,raw_text,created_at,updated_at) VALUES ('m1','素材一','正文',1,1)"); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

func TestGoalLifecycle(t *testing.T) {
	db := openGoals(t)
	ctx := context.Background()
	scope := "p1"
	goal := CreateInput{ID: "g1", Title: "  目标一  ", DoneCriteria: "  条件一  ", Scope: &scope}
	if err := Create(ctx, db, goal, 100); err != nil {
		t.Fatal(err)
	}
	if err := Create(ctx, db, CreateInput{ID: "bad", Title: " ", DoneCriteria: "x"}, 100); err == nil || !strings.Contains(err.Error(), "标题不能为空") {
		t.Fatalf("empty title: %v", err)
	}
	if err := Create(ctx, db, CreateInput{ID: "bad", Title: "x", DoneCriteria: " "}, 100); err == nil || !strings.Contains(err.Error(), "完成条件不能为空") {
		t.Fatalf("empty criteria: %v", err)
	}
	archived := "p2"
	if err := Create(ctx, db, CreateInput{ID: "bad", Title: "x", DoneCriteria: "y", Scope: &archived}, 100); err == nil || !strings.Contains(err.Error(), "项目不存在或已封存") {
		t.Fatalf("archived scope: %v", err)
	}
	active, err := ListActive(ctx, db)
	if err != nil || len(active) != 1 || active[0].Title != "目标一" || active[0].DoneCriteria != "条件一" || active[0].EvidenceCount != 0 {
		t.Fatalf("active: %+v, %v", active, err)
	}
	if err := LinkEvidence(ctx, db, "missing", "n1", "note", 200); err == nil || !strings.Contains(err.Error(), "目标不存在") {
		t.Fatalf("missing goal: %v", err)
	}
	if err := LinkEvidence(ctx, db, "g1", "n1", "bogus", 200); err == nil || !strings.Contains(err.Error(), "只认 note") {
		t.Fatalf("bad kind: %v", err)
	}
	if err := LinkEvidence(ctx, db, "g1", "missing", "note", 200); err == nil || !strings.Contains(err.Error(), "没有 id") {
		t.Fatalf("missing evidence: %v", err)
	}
	if err := LinkEvidence(ctx, db, "g1", "n1", "note", 200); err != nil {
		t.Fatal(err)
	}
	if err := LinkEvidence(ctx, db, "g1", "n1", "note", 999); err != nil {
		t.Fatal(err)
	}
	var linkedAt int64
	if err := db.QueryRow("SELECT linked_at FROM goal_evidence WHERE goal_id='g1' AND evidence_id='n1'").Scan(&linkedAt); err != nil || linkedAt != 200 {
		t.Fatalf("linked_at after re-link: %d, %v", linkedAt, err)
	}
	active, err = ListActive(ctx, db)
	if err != nil || len(active) != 1 || active[0].EvidenceCount != 1 {
		t.Fatalf("evidence count: %+v, %v", active, err)
	}
	// 封存项目不能作为归属，改回全局可以。
	if err := SetScope(ctx, db, "g1", &archived); err == nil || !strings.Contains(err.Error(), "项目不存在、已封存") {
		t.Fatalf("set archived scope: %v", err)
	}
	if err := SetScope(ctx, db, "g1", nil); err != nil {
		t.Fatal(err)
	}
	// 达成只由显式确认决定：1 条证据照常需要确认。
	if achieved, err := Achieve(ctx, db, "g1", "已完成", 300); err != nil || !achieved {
		t.Fatalf("achieve: %v, %v", achieved, err)
	}
	if achieved, err := Achieve(ctx, db, "g1", "再确认", 301); err != nil || achieved {
		t.Fatalf("re-achieve: %v, %v", achieved, err)
	}
	if abandoned, err := Abandon(ctx, db, "g1", "放弃", 302); err != nil || abandoned {
		t.Fatalf("abandon achieved: %v, %v", abandoned, err)
	}
	active, err = ListActive(ctx, db)
	if err != nil || len(active) != 0 {
		t.Fatalf("active after achieve: %+v, %v", active, err)
	}
	var note, achievedAt string
	if err := db.QueryRow("SELECT review_note,achieved_at FROM goals WHERE id='g1'").Scan(&note, &achievedAt); err != nil || note != "已完成" || achievedAt != "300" {
		t.Fatalf("stored outcome: %q %q, %v", note, achievedAt, err)
	}
	if err := SetScope(ctx, db, "g1", nil); err == nil || !strings.Contains(err.Error(), "目标不可用") {
		t.Fatalf("set scope on achieved: %v", err)
	}
}

func TestEvidencePeriodAndReviewSnapshot(t *testing.T) {
	db := openGoals(t)
	ctx := context.Background()
	if err := Create(ctx, db, CreateInput{ID: "g1", Title: "目标一", DoneCriteria: "条件一"}, 100); err != nil {
		t.Fatal(err)
	}
	if err := LinkEvidence(ctx, db, "g1", "n1", "note", 200); err != nil {
		t.Fatal(err)
	}
	if err := LinkEvidence(ctx, db, "g1", "n2", "note", 250); err != nil {
		t.Fatal(err)
	}
	if err := LinkEvidence(ctx, db, "g1", "m1", "material", 300); err != nil {
		t.Fatal(err)
	}
	if _, err := EvidenceInPeriod(ctx, db, 300, 200); err == nil || !strings.Contains(err.Error(), "起点不能晚于终点") {
		t.Fatalf("inverted period: %v", err)
	}
	items, err := EvidenceInPeriod(ctx, db, 200, 250)
	if err != nil || len(items) != 2 || items[0].EvidenceID != "n2" || items[0].Title != nil || items[1].Title == nil {
		t.Fatalf("evidence period: %+v, %v", items, err)
	}
	snapshot, err := ReviewSnapshot(ctx, db, 200, 400)
	if err != nil || len(snapshot.Goals) != 1 || len(snapshot.Evidence) != 3 {
		t.Fatalf("snapshot: %+v, %v", snapshot, err)
	}
	if snapshot.Goals[0].EvidenceCount != 3 {
		t.Fatalf("snapshot evidence count: %d", snapshot.Goals[0].EvidenceCount)
	}
	if _, err := ReviewSnapshot(ctx, db, 400, 200); err == nil {
		t.Fatal("inverted snapshot accepted")
	}
	// 周期之前已达成的目标不进入复盘快照。
	if _, err := Achieve(ctx, db, "g1", "完成", 150); err != nil {
		t.Fatal(err)
	}
	snapshot, err = ReviewSnapshot(ctx, db, 200, 400)
	if err != nil || len(snapshot.Goals) != 0 || len(snapshot.Evidence) != 0 {
		t.Fatalf("snapshot after early achievement: %+v, %v", snapshot, err)
	}
}
