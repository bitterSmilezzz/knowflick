package projects

import (
	"context"
	"database/sql"
	"path/filepath"
	"strings"
	"testing"

	_ "modernc.org/sqlite"
)

const projSchema = `
CREATE TABLE projects (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, archived_at INTEGER
);
CREATE TABLE notes (
  id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', body_md TEXT NOT NULL DEFAULT '',
  source_material_id TEXT, is_deleted INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE project_members (
  project_id TEXT NOT NULL, note_id TEXT NOT NULL, added_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, note_id)
);
`

func openProjects(t *testing.T) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", "file:"+filepath.Join(t.TempDir(), "lib.db")+"?mode=rwc")
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(projSchema); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

func addNoteRow(t *testing.T, db *sql.DB, id, title, body string, deleted bool) {
	t.Helper()
	flag := 0
	if deleted {
		flag = 1
	}
	if _, err := db.Exec("INSERT INTO notes (id,title,body_md,is_deleted,created_at,updated_at) VALUES (?,?,?,?,1,1)", id, title, body, flag); err != nil {
		t.Fatal(err)
	}
}

func TestProjectLifecycleAndMembership(t *testing.T) {
	db := openProjects(t)
	ctx := context.Background()
	if err := Create(ctx, db, "p1", "  项目甲  ", "说明", 100); err != nil {
		t.Fatal(err)
	}
	var name string
	if err := db.QueryRow("SELECT name FROM projects WHERE id='p1'").Scan(&name); err != nil || name != "项目甲" {
		t.Fatalf("name: %q, %v", name, err)
	}
	if err := Create(ctx, db, "p2", " ", "", 101); err == nil || !strings.Contains(err.Error(), "项目名不能为空") {
		t.Fatalf("empty name: %v", err)
	}
	if err := Create(ctx, db, "p2", "项目甲", "", 101); err == nil || !strings.Contains(err.Error(), "已有名为") {
		t.Fatalf("duplicate name: %v", err)
	}
	addNoteRow(t, db, "n1", "笔记一", "第一行\n第二行 很长很长的正文内容继续写下去直到超过八十个字用来验证摘录截断是否按字符数而不是字节数来算的规则细节再补一些字", false)
	addNoteRow(t, db, "n2", "笔记二", "正文二", false)
	addNoteRow(t, db, "n3", "已删笔记", "正文三", true)

	if err := AddNote(ctx, db, "missing", "n1", 200); err == nil || !strings.Contains(err.Error(), "项目不存在") {
		t.Fatalf("missing project: %v", err)
	}
	if err := AddNote(ctx, db, "p1", "missing", 200); err == nil || !strings.Contains(err.Error(), "笔记不存在") {
		t.Fatalf("missing note: %v", err)
	}
	if err := AddNote(ctx, db, "p1", "n1", 200); err != nil {
		t.Fatal(err)
	}
	if err := AddNote(ctx, db, "p1", "n1", 999); err != nil {
		t.Fatal(err)
	}
	if err := AddNote(ctx, db, "p1", "n3", 300); err != nil {
		t.Fatal(err)
	}
	var addedAt int64
	if err := db.QueryRow("SELECT added_at FROM project_members WHERE project_id='p1' AND note_id='n1'").Scan(&addedAt); err != nil || addedAt != 200 {
		t.Fatalf("added_at after re-add: %d, %v", addedAt, err)
	}
	members, err := MemberList(ctx, db, "p1")
	if err != nil || len(members) != 2 {
		t.Fatalf("members: %+v, %v", members, err)
	}
	if members[0].NoteID != "n1" || !strings.HasPrefix(members[0].Excerpt, "第一行 第二行") || len([]rune(members[0].Excerpt)) > 80 {
		t.Fatalf("excerpt: %q", members[0].Excerpt)
	}
	if !members[1].IsDeleted {
		t.Fatal("deleted member flag missing")
	}
	if err := RemoveNote(ctx, db, "p1", "n1"); err != nil {
		t.Fatal(err)
	}
	if err := RemoveNote(ctx, db, "p1", "n1"); err != nil {
		t.Fatal(err)
	}
	if err := AddNote(ctx, db, "p1", "n1", 400); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow("SELECT added_at FROM project_members WHERE project_id='p1' AND note_id='n1'").Scan(&addedAt); err != nil || addedAt != 400 {
		t.Fatalf("added_at after rejoin: %d, %v", addedAt, err)
	}
}

func TestArchiveIndexAndExport(t *testing.T) {
	db := openProjects(t)
	ctx := context.Background()
	if err := Create(ctx, db, "p1", "项目甲", "项目说明", 100); err != nil {
		t.Fatal(err)
	}
	if err := Create(ctx, db, "p2", "项目乙", "", 101); err != nil {
		t.Fatal(err)
	}
	addNoteRow(t, db, "n1", "笔记一", "正文一", false)
	addNoteRow(t, db, "n2", "笔记二", "正文二", false)
	addNoteRow(t, db, "n3", "已删笔记", "正文三", true)
	if err := AddNote(ctx, db, "p1", "n1", 200); err != nil {
		t.Fatal(err)
	}
	if err := AddNote(ctx, db, "p1", "n3", 201); err != nil {
		t.Fatal(err)
	}
	if err := AddNote(ctx, db, "p2", "n2", 202); err != nil {
		t.Fatal(err)
	}
	// 索引不剔除已删除的成员笔记，只剔除封存项目的成员（与 Rust project_member_index 一致）。
	index, err := MemberIndex(ctx, db)
	if err != nil || len(index) != 3 || index[0] != [2]string{"n1", "p1"} || index[1] != [2]string{"n2", "p2"} || index[2] != [2]string{"n3", "p1"} {
		t.Fatalf("index: %+v, %v", index, err)
	}
	changed, err := Archive(ctx, db, "p2", 500)
	if err != nil || !changed {
		t.Fatalf("archive: %v, %v", changed, err)
	}
	if changed, err = Archive(ctx, db, "p2", 600); err != nil || changed {
		t.Fatalf("re-archive: %v, %v", changed, err)
	}
	active, err := List(ctx, db, false)
	if err != nil || len(active) != 1 || active[0].ID != "p1" {
		t.Fatalf("active list: %+v, %v", active, err)
	}
	all, err := List(ctx, db, true)
	if err != nil || len(all) != 2 {
		t.Fatalf("all list: %+v, %v", all, err)
	}
	index, err = MemberIndex(ctx, db)
	if err != nil || len(index) != 2 || index[0] != [2]string{"n1", "p1"} || index[1] != [2]string{"n3", "p1"} {
		t.Fatalf("index after archive: %+v, %v", index, err)
	}
	markdown, err := ExportMarkdown(ctx, db, "p1", "2026-11-21")
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"# 项目：项目甲", "项目说明", "导出时间：2026-11-21 ｜ 成员笔记 1 篇", "## 笔记 1：笔记一", "正文一"} {
		if !strings.Contains(markdown, want) {
			t.Fatalf("markdown missing %q:\n%s", want, markdown)
		}
	}
	if strings.Contains(markdown, "已删笔记") || strings.Contains(markdown, "来源素材") {
		t.Fatalf("deleted note or missing source leaked:\n%s", markdown)
	}
	if _, err := ExportMarkdown(ctx, db, "p2", "2026-11-21"); err == nil || !strings.Contains(err.Error(), "已封存") {
		t.Fatalf("archived export: %v", err)
	}
	if _, err := ExportMarkdown(ctx, db, "missing", "2026-11-21"); err == nil || !strings.Contains(err.Error(), "项目不存在") {
		t.Fatalf("missing export: %v", err)
	}
}
