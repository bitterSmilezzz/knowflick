package library

import (
	"errors"
	"reflect"
	"testing"
)

func TestKnowledgeBaseMembershipAndScopedSearch(t *testing.T) {
	lib, path := newWritable(t)
	ctx := t.Context()
	// 库结构现在由 SchemaSQL 统一建；这里只补测试需要的表，必须 IF NOT EXISTS。
	execute(t, lib.db, `CREATE TABLE IF NOT EXISTS knowledge_bases (
		id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
		created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
	);
	CREATE TABLE IF NOT EXISTS kb_membership (
		kb_id TEXT NOT NULL REFERENCES knowledge_bases(id), note_id TEXT NOT NULL REFERENCES notes(id),
		added_at INTEGER NOT NULL, PRIMARY KEY (kb_id, note_id)
	);`)
	for _, id := range []string{"n1", "n2", "deleted"} {
		if _, err := lib.Upsert(ctx, draftNote(id, "共享标题", "tokenvalue 前缀连续中文尾部"), 0, 1); err != nil {
			t.Fatal(err)
		}
	}
	for _, base := range []struct{ id, name string }{{"quoted'base", "  项目甲  "}, {"other", "项目乙"}} {
		if err := lib.CreateKnowledgeBase(ctx, base.id, base.name, "主题描述", 100); err != nil {
			t.Fatal(err)
		}
	}
	if err := lib.CreateKnowledgeBase(ctx, "duplicate", "项目甲", "", 101); err == nil {
		t.Fatal("accepted duplicate name")
	}
	if err := lib.CreateKnowledgeBase(ctx, "blank", " ", "", 101); err == nil {
		t.Fatal("accepted blank name")
	}
	for _, pair := range [][2]string{{"quoted'base", "n1"}, {"quoted'base", "deleted"}, {"other", "n1"}, {"other", "n2"}} {
		if err := lib.SetKnowledgeBaseMembership(ctx, pair[0], pair[1], true, 200); err != nil {
			t.Fatal(err)
		}
	}
	if err := lib.SetKnowledgeBaseMembership(ctx, "quoted'base", "n1", true, 999); err != nil {
		t.Fatal(err)
	}
	if err := lib.SetKnowledgeBaseMembership(ctx, "quoted'base", "missing", true, 201); err == nil {
		t.Fatal("accepted missing note")
	}
	if err := lib.SetKnowledgeBaseMembership(ctx, "missing", "n1", true, 201); err == nil {
		t.Fatal("accepted missing base")
	}
	if _, err := lib.Delete(ctx, "deleted", 300); err != nil {
		t.Fatal(err)
	}

	reader, err := Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	snapshot, err := reader.KnowledgeBases(ctx)
	if err != nil || len(snapshot.Items) != 2 || snapshot.Items[1].Name != "项目甲" || snapshot.Items[1].Description != "主题描述" || len(snapshot.Membership) != 4 || snapshot.Membership["quoted'base\nn1"] != 200 {
		t.Fatalf("snapshot: %+v, %v", snapshot, err)
	}
	if err := reader.CreateKnowledgeBase(ctx, "readonly", "只读", "", 100); !errors.Is(err, ErrReadOnly) {
		t.Fatalf("read-only create: %v", err)
	}
	if err := reader.SetKnowledgeBaseMembership(ctx, "quoted'base", "n1", false, 303); !errors.Is(err, ErrReadOnly) {
		t.Fatalf("read-only membership: %v", err)
	}
	for _, query := range []string{"", "tokenvalue", "连续中文"} {
		page, err := reader.SearchKnowledgeBaseNotes(ctx, "quoted'base", query)
		if err != nil || len(page.Notes) != 1 || page.Notes[0].ID != "n1" {
			t.Fatalf("scoped notes for %q: %+v, %v", query, page, err)
		}
	}
	for _, query := range []string{"tokenvalue", "连续中文"} {
		hits, err := reader.SearchKnowledgeBaseChunks(ctx, "quoted'base", query, 20)
		if err != nil || len(hits) != 1 || hits[0].NoteID != "n1" {
			t.Fatalf("scoped chunks for %q: %+v, %v", query, hits, err)
		}
	}
	for range 2 {
		if err := lib.SetKnowledgeBaseMembership(ctx, "quoted'base", "n1", false, 400); err != nil {
			t.Fatal(err)
		}
	}
	page, err := reader.SearchKnowledgeBaseNotes(ctx, "quoted'base", "")
	if err != nil || len(page.Notes) != 0 {
		t.Fatalf("scoped notes after removal: %+v, %v", page, err)
	}
	after, err := reader.KnowledgeBases(ctx)
	delete(snapshot.Membership, "quoted'base\nn1")
	if err != nil || !reflect.DeepEqual(after, snapshot) {
		t.Fatalf("unrelated membership changed: %+v, %v", after, err)
	}
}
