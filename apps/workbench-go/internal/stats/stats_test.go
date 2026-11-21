package stats

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"

	_ "modernc.org/sqlite"
)

func TestGetCountsMatchDesktopSemantics(t *testing.T) {
	db, err := sql.Open("sqlite", "file:"+filepath.Join(t.TempDir(), "lib.db")+"?mode=rwc")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	for _, statement := range []string{
		"CREATE TABLE cards (id TEXT PRIMARY KEY, is_deleted INTEGER NOT NULL DEFAULT 0, is_favorite INTEGER NOT NULL DEFAULT 0, seen_at INTEGER, last_reviewed_at INTEGER, interval_days INTEGER NOT NULL DEFAULT 0)",
		"CREATE TABLE materials (id TEXT PRIMARY KEY, is_deleted INTEGER NOT NULL DEFAULT 0, inbox_status TEXT NOT NULL DEFAULT 'inbox')",
	} {
		if _, err := db.Exec(statement); err != nil {
			t.Fatal(err)
		}
	}
	rows := []string{
		"INSERT INTO cards (id,is_favorite,seen_at,last_reviewed_at,interval_days) VALUES ('c1',1,100,100,1)",
		"INSERT INTO cards (id,seen_at,last_reviewed_at,interval_days) VALUES ('c2',100,900000,1)",
		"INSERT INTO cards (id,is_favorite,seen_at,last_reviewed_at,interval_days) VALUES ('c3',1,100,NULL,1)",
		"INSERT INTO cards (id,is_deleted,seen_at) VALUES ('c4',1,100)",
		"INSERT INTO materials (id) VALUES ('m1')",
		"INSERT INTO materials (id,inbox_status) VALUES ('m2','processed')",
		"INSERT INTO materials (id,is_deleted) VALUES ('m3',1)",
	}
	for _, statement := range rows {
		if _, err := db.Exec(statement); err != nil {
			t.Fatal(err)
		}
	}
	got, err := Get(context.Background(), db, 1000000)
	if err != nil {
		t.Fatal(err)
	}
	want := Stats{TotalCards: 3, TotalMaterials: 2, InboxMaterials: 1, FavoriteCards: 2, SeenCards: 3, DueCards: 1}
	if got != want {
		t.Fatalf("stats: got %+v, want %+v", got, want)
	}
}
