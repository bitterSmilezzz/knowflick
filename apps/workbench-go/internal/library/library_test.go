package library

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"
)

func TestReadOnlyNotes(t *testing.T) {
	path := filepath.Join(t.TempDir(), "中文 #备份?.db")
	if runtime.GOOS == "windows" {
		path = filepath.Join(t.TempDir(), "中文 #备份.db")
	}
	uri, err := databaseURI(path)
	if err != nil {
		t.Fatal(err)
	}
	db, err := sql.Open("sqlite", uri.String())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	execute(t, db, schema)
	seed(t, db)
	verifyNotes(t, path)

	// Equal sort timestamps must not repeat or disappear between pages.
	for i := 0; i < PageSize; i++ {
		execute(t, db, "INSERT INTO notes (id,created_at,updated_at) VALUES (?,1,1)", fmt.Sprintf("extra-%02d", i))
	}
	repo, err := Open(t.Context(), path)
	if err != nil {
		t.Fatal(err)
	}
	defer repo.Close()
	first, err := repo.List(t.Context(), 0)
	if err != nil || len(first.Notes) != PageSize || !first.HasMore {
		t.Fatalf("first page: %d, more=%v, err=%v", len(first.Notes), first.HasMore, err)
	}
	second, err := repo.List(t.Context(), PageSize)
	if err != nil || second.HasMore {
		t.Fatalf("last page: %d, more=%v, err=%v", len(second.Notes), second.HasMore, err)
	}
	seen := map[string]bool{}
	for _, note := range append(first.Notes, second.Notes...) {
		if seen[note.ID] {
			t.Fatalf("duplicate note: %s", note.ID)
		}
		seen[note.ID] = true
	}
	if len(seen) != PageSize+3 {
		t.Fatalf("total notes: %d", len(seen))
	}
}

func TestRejectsMissingAndUnrelatedLibraries(t *testing.T) {
	path := filepath.Join(t.TempDir(), "missing.db")
	if repo, err := Open(t.Context(), path); err == nil {
		repo.Close()
		t.Fatal("opened a missing library")
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("missing database was created: %v", err)
	}
	if err := os.WriteFile(path, []byte("not SQLite"), 0600); err != nil {
		t.Fatal(err)
	}
	if repo, err := Open(t.Context(), path); err == nil {
		repo.Close()
		t.Fatal("opened a corrupt library")
	}
}

// KF_GO_SOURCE_SNAPSHOT and KF_GO_FIXTURE let the Rust probe and the desktop smoke
// reuse a newly created fixture. VACUUM INTO refuses to overwrite a populated file.
func TestExistingSnapshotRoundTrip(t *testing.T) {
	source, target := os.Getenv("KF_GO_SOURCE_SNAPSHOT"), os.Getenv("KF_GO_FIXTURE")
	if source == "" || target == "" {
		t.Skip("set KF_GO_SOURCE_SNAPSHOT and KF_GO_FIXTURE for the compatibility probe")
	}
	if _, err := os.Lstat(target); !os.IsNotExist(err) {
		t.Fatalf("fixture must be a new file: %v", err)
	}
	repo, err := Open(t.Context(), source)
	if err != nil {
		t.Fatal(err)
	}
	defer repo.Close()
	before, err := repo.List(t.Context(), 0)
	if err != nil {
		t.Fatal(err)
	}
	// query_only is a second guard. Clone using a separate mode=ro connection.
	db, err := sql.Open("sqlite", readonlyURI(t, source))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	execute(t, db, "VACUUM INTO ?", target)
	targetURI, err := databaseURI(target)
	if err != nil {
		t.Fatal(err)
	}
	fixture, err := sql.Open("sqlite", targetURI.String())
	if err != nil {
		t.Fatal(err)
	}
	defer fixture.Close()
	seed(t, fixture)
	var integrity string
	if err := fixture.QueryRow("PRAGMA integrity_check").Scan(&integrity); err != nil || integrity != "ok" {
		t.Fatalf("fixture integrity: %q, %v", integrity, err)
	}
	var revisions int
	if err := fixture.QueryRow("SELECT COUNT(*) FROM note_revisions WHERE note_id='go-phase1-pinned'").Scan(&revisions); err != nil || revisions != 2 {
		t.Fatalf("fixture revisions: %d, %v", revisions, err)
	}
	verifyNotes(t, target)
	after, err := repo.List(t.Context(), 0)
	if err != nil || !reflect.DeepEqual(after, before) {
		t.Fatalf("source notes changed during clone: %v", err)
	}
}

func verifyNotes(t *testing.T, path string) {
	t.Helper()
	repo, err := Open(t.Context(), path)
	if err != nil {
		t.Fatal(err)
	}
	defer repo.Close()
	page, err := repo.List(t.Context(), 0)
	if err != nil {
		t.Fatal(err)
	}
	var found []string
	for _, note := range page.Notes {
		if strings.HasPrefix(note.ID, "go-phase1-") {
			found = append(found, note.ID)
		}
	}
	if want := []string{"go-phase1-pinned", "go-phase1-newer", "go-phase1-fallback"}; !reflect.DeepEqual(found, want) {
		t.Fatalf("visible fixture notes: %v", found)
	}
	for _, tc := range []struct{ query, id string }{{"bridgephase migrat", "go-phase1-pinned"}, {"中文迁移样", "go-phase1-pinned"}, {"quoted\"%_", ""}, {"中文字串", "go-phase1-fallback"}, {"hiddenphase", ""}} {
		page, err := repo.Search(t.Context(), tc.query)
		if err != nil {
			t.Fatalf("%q: %v", tc.query, err)
		}
		if tc.id == "" {
			if len(page.Notes) != 0 {
				t.Fatalf("%q: got %d matches", tc.query, len(page.Notes))
			}
			continue
		}
		if len(page.Notes) != 1 || page.Notes[0].ID != tc.id {
			t.Fatalf("%q: expected %s, got %d matches", tc.query, tc.id, len(page.Notes))
		}
		if tc.id == "go-phase1-pinned" && (page.Notes[0].Revision != 2 || page.Notes[0].Body != "**中文迁移样本** bridgephase migration") {
			t.Fatal("current revision or Markdown did not round-trip")
		}
	}
	if _, err := repo.db.ExecContext(t.Context(), "UPDATE notes SET title='invalid' WHERE id='go-phase1-pinned'"); err == nil {
		t.Fatal("read-only connection accepted a write")
	}
}

func readonlyURI(t *testing.T, path string) string {
	t.Helper()
	uri, err := databaseURI(path)
	if err != nil {
		t.Fatal(err)
	}
	uri.RawQuery = "mode=ro&_pragma=busy_timeout(5000)"
	return uri.String()
}

func seed(t *testing.T, db *sql.DB) {
	t.Helper()
	db.SetMaxOpenConns(1)
	execute(t, db, "PRAGMA foreign_keys=ON")
	tx, err := db.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	execute(t, tx, `INSERT INTO notes (id,title,body_md,is_pinned,current_revision,created_at,updated_at,is_deleted,archived_at) VALUES
  ('go-phase1-pinned','迁移验收置顶','**中文迁移样本** bridgephase migration',1,2,101,102,0,NULL),
  ('go-phase1-newer','迁移验收归档','第二篇笔记',0,1,103,103,0,104),
  ('go-phase1-fallback','迁移验收子串','前缀中文字串尾部',0,1,100,100,0,NULL),
  ('go-phase1-deleted','迁移验收回收站','hiddenphase bridgephase migration',0,1,105,105,1,NULL)`)
	execute(t, tx, `INSERT INTO note_revisions (note_id,revision,title,body_md,saved_at)
  VALUES ('go-phase1-pinned',1,'迁移验收置顶','初稿',101)`)
	execute(t, tx, `INSERT INTO note_revisions (note_id,revision,title,body_md,saved_at)
  SELECT id,current_revision,title,body_md,updated_at FROM notes WHERE id IN ('go-phase1-pinned','go-phase1-newer','go-phase1-fallback','go-phase1-deleted')`)
	// A stale entry exercises the soft-delete guard. Leave the fallback entry unindexed.
	execute(t, tx, `INSERT INTO fts_notes (note_id,title,body)
  SELECT id,title,body_md FROM notes WHERE id IN ('go-phase1-pinned','go-phase1-newer','go-phase1-deleted')`)
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
}

func execute(t *testing.T, db interface {
	Exec(string, ...any) (sql.Result, error)
}, statement string, args ...any) {
	t.Helper()
	if _, err := db.Exec(statement, args...); err != nil {
		t.Fatal(err)
	}
}

const schema = `
CREATE TABLE notes (id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', body_md TEXT NOT NULL DEFAULT '',
 notebook TEXT, is_pinned INTEGER NOT NULL DEFAULT 0, archived_at INTEGER,
 current_revision INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 is_deleted INTEGER NOT NULL DEFAULT 0);
CREATE TABLE note_revisions (note_id TEXT NOT NULL REFERENCES notes(id), revision INTEGER NOT NULL,
 title TEXT NOT NULL, body_md TEXT NOT NULL, saved_at INTEGER NOT NULL, PRIMARY KEY (note_id, revision));
CREATE VIRTUAL TABLE fts_notes USING fts5(note_id UNINDEXED,title,body,tokenize='unicode61 remove_diacritics 2');
`
