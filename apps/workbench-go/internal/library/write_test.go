package library

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	_ "modernc.org/sqlite"
)

func newWritable(t *testing.T) (*Library, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "write.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	execute(t, db, schema)
	db.Close()
	lib, err := OpenForWrite(context.Background(), path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { lib.Close() })
	return lib, path
}

func draftNote(id, title, body string) Note {
	return Note{ID: id, Title: title, Body: body, TagsJSON: "[]"}
}

func TestUpsertCreateThenEditAppendsRevision(t *testing.T) {
	lib, path := newWritable(t)
	ctx := context.Background()
	created, err := lib.Upsert(ctx, draftNote("n1", "标题一", "正文：记忆与知识"), 0, 1000)
	if err != nil || !created.Created || created.Revision != 1 {
		t.Fatalf("create: %+v %v", created, err)
	}
	note, err := lib.get(ctx, "n1")
	if err != nil || note == nil {
		t.Fatal(err)
	}
	if note.CreatedAt != 1000 || note.UpdatedAt != 1000 || note.Revision != 1 {
		t.Fatalf("timestamps: %+v", note)
	}
	edited := draftNote("n1", "标题二", "正文：记忆、知识与检索")
	edited.Favorite = true
	out, err := lib.Upsert(ctx, edited, 1, 2000)
	if err != nil || out.Revision != 2 {
		t.Fatalf("edit: %+v %v", out, err)
	}
	saved, err := lib.get(ctx, "n1")
	if err != nil {
		t.Fatal(err)
	}
	if saved.Title != edited.Title || saved.Body != edited.Body || !saved.Favorite {
		t.Fatalf("content: %+v", saved)
	}
	if saved.CreatedAt != 1000 || saved.UpdatedAt != 2000 {
		t.Fatalf("created_at must not change: %+v", saved)
	}
	revisions := countRows(t, path, "SELECT COUNT(*) FROM note_revisions WHERE note_id='n1'")
	if revisions != 2 {
		t.Fatalf("revisions: %d", revisions)
	}
}

func TestMetadataOnlyChangeKeepsRevision(t *testing.T) {
	lib, path := newWritable(t)
	ctx := context.Background()
	if _, err := lib.Upsert(ctx, draftNote("n1", "标题", "正文"), 0, 1000); err != nil {
		t.Fatal(err)
	}
	pinned := draftNote("n1", "标题", "正文")
	pinned.Pinned = true
	out, err := lib.Upsert(ctx, pinned, 1, 2000)
	if err != nil || out.Revision != 1 {
		t.Fatalf("pin: %+v %v", out, err)
	}
	if n := countRows(t, path, "SELECT COUNT(*) FROM note_revisions WHERE note_id='n1'"); n != 1 {
		t.Fatalf("metadata change must not append a revision: %d", n)
	}
}

func TestStaleBaseRevisionIsRejected(t *testing.T) {
	lib, path := newWritable(t)
	ctx := context.Background()
	if _, err := lib.Upsert(ctx, draftNote("n1", "标题", "正文甲"), 0, 1000); err != nil {
		t.Fatal(err)
	}
	if _, err := lib.Upsert(ctx, draftNote("n1", "标题", "正文乙"), 1, 2000); err != nil {
		t.Fatal(err)
	}
	_, err := lib.Upsert(ctx, draftNote("n1", "标题", "旧草稿"), 1, 3000)
	var conflict *ConflictError
	if !errors.As(err, &conflict) || conflict.CurrentRevision != 2 {
		t.Fatalf("expected conflict at 2, got %v", err)
	}
	if body := readBody(t, path, "n1"); body != "正文乙" {
		t.Fatalf("stale draft overwrote current content: %q", body)
	}
}

func TestCreateWithBaseRevisionIsRejected(t *testing.T) {
	lib, _ := newWritable(t)
	_, err := lib.Upsert(context.Background(), draftNote("n2", "标题", "正文"), 3, 1000)
	var conflict *ConflictError
	if !errors.As(err, &conflict) || conflict.CurrentRevision != 0 {
		t.Fatalf("expected conflict at 0, got %v", err)
	}
}

func TestReadOnlyLibraryRefusesWrites(t *testing.T) {
	lib, _ := newWritable(t)
	ctx := context.Background()
	if _, err := lib.Upsert(ctx, draftNote("n1", "标题", "正文"), 0, 1000); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "ro.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	execute(t, db, schema)
	execute(t, db, "INSERT INTO notes (id,title,body_md,created_at,updated_at) VALUES ('n1','标题','正文',1000,1000)")
	db.Close()
	ro, err := Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer ro.Close()
	if _, err := ro.Upsert(ctx, draftNote("n1", "改", "改"), 1, 2000); err != ErrReadOnly {
		t.Fatalf("expected ErrReadOnly, got %v", err)
	}
	if _, err := ro.Delete(ctx, "n1", 2000); err != ErrReadOnly {
		t.Fatalf("expected ErrReadOnly on delete, got %v", err)
	}
}

func TestDeleteRemovesFromSearchAndIsIdempotent(t *testing.T) {
	lib, _ := newWritable(t)
	ctx := context.Background()
	if _, err := lib.Upsert(ctx, draftNote("n1", "北极项目", "正文里有北极"), 0, 1000); err != nil {
		t.Fatal(err)
	}
	if page, err := lib.Search(ctx, "北极"); err != nil || len(page.Notes) != 1 {
		t.Fatalf("search before delete: %v %v", page, err)
	}
	changed, err := lib.Delete(ctx, "n1", 2000)
	if err != nil || !changed {
		t.Fatalf("delete: %v %v", changed, err)
	}
	page, err := lib.Search(ctx, "北极")
	if err != nil || len(page.Notes) != 0 {
		t.Fatalf("deleted note still searchable: %v %v", page, err)
	}
	if again, err := lib.Delete(ctx, "n1", 3000); err != nil || again {
		t.Fatalf("second delete: %v %v", again, err)
	}
}

func TestChunksMatchChunkerAndRevision(t *testing.T) {
	lib, path := newWritable(t)
	ctx := context.Background()
	body := "# 第一节\n\n第一段正文，讲记忆。\n\n第二段正文，讲检索。\n\n## 第二节\n\n第三段正文。"
	if _, err := lib.Upsert(ctx, draftNote("n1", "分块", body), 0, 1000); err != nil {
		t.Fatal(err)
	}

	want := ChunkMarkdown(body)
	db, err := sql.Open("sqlite", mustURI(t, path))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	rows, err := db.Query("SELECT chunk_index, content, char_start, char_end, content_revision FROM note_chunks WHERE note_id='n1' ORDER BY chunk_index")
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()

	got := make([]Chunk, 0, len(want))
	for rows.Next() {
		var c Chunk
		var rev int64
		if err := rows.Scan(&c.Index, &c.Content, &c.CharStart, &c.CharEnd, &rev); err != nil {
			t.Fatal(err)
		}
		if rev != 1 {
			t.Fatalf("chunk revision: %d", rev)
		}
		got = append(got, c)
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("chunks differ from chunker\n got %+v\nwant %+v", got, want)
	}
	if n := countRows(t, path, "SELECT COUNT(*) FROM fts_note_chunks WHERE note_id='n1'"); n != len(want) {
		t.Fatalf("chunk fts rows: %d, want %d", n, len(want))
	}
}

func TestChunkRebuildFollowsNewRevision(t *testing.T) {
	lib, path := newWritable(t)
	ctx := context.Background()
	if _, err := lib.Upsert(ctx, draftNote("n1", "分块", "旧正文"), 0, 1000); err != nil {
		t.Fatal(err)
	}
	if _, err := lib.Upsert(ctx, draftNote("n1", "分块", "新正文，更长一些"), 1, 2000); err != nil {
		t.Fatal(err)
	}
	if n := countRows(t, path, "SELECT COUNT(DISTINCT content_revision) FROM note_chunks WHERE note_id='n1'"); n != 1 {
		t.Fatalf("expected chunks rebuilt at one revision, got %d distinct", n)
	}
	if n := countRows(t, path, "SELECT COUNT(*) FROM note_chunks WHERE note_id='n1' AND content_revision=2"); n == 0 {
		t.Fatal("chunks were not rebuilt under the new revision")
	}
}

func countRows(t *testing.T, path, statement string) int {
	t.Helper()
	db, err := sql.Open("sqlite", mustURI(t, path))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var n int
	if err := db.QueryRow(statement).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func readBody(t *testing.T, path, id string) string {
	t.Helper()
	db, err := sql.Open("sqlite", mustURI(t, path))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var body string
	if err := db.QueryRow("SELECT body_md FROM notes WHERE id=?1", id).Scan(&body); err != nil {
		t.Fatal(err)
	}
	return body
}

func mustURI(t *testing.T, path string) string {
	t.Helper()
	u, err := databaseURI(path)
	if err != nil {
		t.Fatal(err)
	}
	return u.String()
}

// TestExportWriteFixture 生成一份「由 Go 写入」的夹具，供 Rust 侧对拍读回。
// 只有设了 KF_GO_WRITE_FIXTURE（且目标文件不存在）时才跑，避免污染常规测试。
func TestExportWriteFixture(t *testing.T) {
	target := os.Getenv("KF_GO_WRITE_FIXTURE")
	if target == "" {
		t.Skip("set KF_GO_WRITE_FIXTURE to export the cross-runtime write fixture")
	}
	if _, err := os.Lstat(target); !os.IsNotExist(err) {
		t.Fatalf("fixture must be a new file: %v", err)
	}
	db, err := sql.Open("sqlite", mustURI(t, target))
	if err != nil {
		t.Fatal(err)
	}
	execute(t, db, schema)
	db.Close()

	lib, err := OpenForWrite(context.Background(), target)
	if err != nil {
		t.Fatal(err)
	}
	defer lib.Close()
	ctx := context.Background()
	if _, err := lib.Upsert(ctx, draftNote("go-write-1", "夹具标题", fixtureOldBody), 0, 1000); err != nil {
		t.Fatal(err)
	}
	updated := draftNote("go-write-1", "夹具标题", fixtureNewBody)
	updated.Favorite = true
	if out, err := lib.Upsert(ctx, updated, 1, 2000); err != nil || out.Revision != 2 {
		t.Fatalf("update: %+v %v", out, err)
	}
	if _, err := lib.Upsert(ctx, draftNote("go-write-2", "第二篇", "普通正文"), 0, 3000); err != nil {
		t.Fatal(err)
	}
	if changed, err := lib.Delete(ctx, "go-write-2", 4000); err != nil || !changed {
		t.Fatalf("delete: %v %v", changed, err)
	}
}

const (
	fixtureOldBody = "旧正文：只有一段。"
	fixtureNewBody = "# 第一节\n\n第一段正文，讲记忆与检索。\n\n第二段正文，讲知识库范围。\n\n## 第二节\n\n第三段正文，比较长的一段用来确认段落合并的边界。"
)

func TestRestoreBringsBackNoteAndIndex(t *testing.T) {
	lib, path := newWritable(t)
	ctx := context.Background()
	body := "# 恢复用\n\n第一段正文。\n\n第二段正文。"
	if _, err := lib.Upsert(ctx, draftNote("r1", "恢复测试", body), 0, 1000); err != nil {
		t.Fatal(err)
	}
	if ok, err := lib.Delete(ctx, "r1", 2000); err != nil || !ok {
		t.Fatalf("delete: %v %v", ok, err)
	}
	if page, err := lib.ListDeleted(ctx, 0); err != nil || len(page.Notes) != 1 || page.Notes[0].ID != "r1" {
		t.Fatalf("trash page: %v %v", page, err)
	}
	if ok, err := lib.Restore(ctx, "r1"); err != nil || !ok {
		t.Fatalf("restore: %v %v", ok, err)
	}
	note, err := lib.get(ctx, "r1")
	if err != nil || note == nil || note.Deleted || note.DeletedAt != nil {
		t.Fatalf("restored note: %+v %v", note, err)
	}
	if page, err := lib.Search(ctx, "恢复用"); err != nil || len(page.Notes) != 1 {
		t.Fatalf("search after restore: %v %v", page, err)
	}
	if n := countRows(t, path, "SELECT COUNT(*) FROM note_chunks WHERE note_id='r1' AND content_revision=1"); n != len(ChunkMarkdown(body)) {
		t.Fatalf("chunks after restore: %d, want %d", n, len(ChunkMarkdown(body)))
	}
	if ok, err := lib.Restore(ctx, "r1"); err != nil || ok {
		t.Fatalf("second restore must be a no-op: %v %v", ok, err)
	}
}

func TestListScopeSeparatesActiveDeletedAndAll(t *testing.T) {
	lib, _ := newWritable(t)
	ctx := context.Background()
	if _, err := lib.Upsert(ctx, draftNote("active1", "在库", "正文"), 0, 1000); err != nil {
		t.Fatal(err)
	}
	if _, err := lib.Upsert(ctx, draftNote("trash1", "待删", "正文"), 0, 1000); err != nil {
		t.Fatal(err)
	}
	if ok, err := lib.Delete(ctx, "trash1", 2000); err != nil || !ok {
		t.Fatalf("delete: %v %v", ok, err)
	}
	for scope, want := range map[string]int{"active": 1, "deleted": 1, "all": 2} {
		page, err := lib.ListScope(ctx, scope, 500, 0)
		if err != nil || len(page.Notes) != want {
			t.Fatalf("%s scope: %d notes, %v", scope, len(page.Notes), err)
		}
	}
	page, err := lib.ListScope(ctx, "all", 1, 0)
	if err != nil || len(page.Notes) != 1 || !page.HasMore {
		t.Fatalf("limit page: %+v %v", page, err)
	}
}
