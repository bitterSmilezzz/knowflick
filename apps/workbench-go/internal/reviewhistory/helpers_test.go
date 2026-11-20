package reviewhistory

import (
	"database/sql"
	"encoding/json"
	"path/filepath"
	"testing"

	_ "modernc.org/sqlite"
)

func openDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "lib.db"))
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = db.Close() })
	return db
}

const schema = `
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE review_events (
  event_id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL,
  reviewed_at INTEGER NOT NULL,
  rating TEXT NOT NULL,
  algorithm TEXT NOT NULL,
  project_ids_json TEXT NOT NULL,
  project_attribution_complete INTEGER NOT NULL
);
`

func seed(t *testing.T, db *sql.DB) {
	t.Helper()
	if _, err := db.Exec(schema); err != nil {
		t.Fatal(err)
	}
	statement := "INSERT INTO meta(key,value) VALUES('review_history_started_at','1000')"
	if _, err := db.Exec(statement); err != nil {
		t.Fatal(err)
	}
}

const eventID = "3f2a5b1c-9d8e-4a3b-8c7d-0e1f2a3b4c5d"

func event(id, card string, at int64, projects ...string) Event {
	if projects == nil {
		projects = []string{}
	}
	return Event{
		ID: id, CardID: card, ReviewedAt: at, Rating: RatingGood, Algorithm: AlgorithmSm2,
		ProjectIDs: projects, ProjectAttributionComplete: false,
	}
}

func insertEvent(t *testing.T, db *sql.DB, e Event) {
	t.Helper()
	projects, err := json.Marshal(e.ProjectIDs)
	if err != nil {
		t.Fatal(err)
	}
	complete := 0
	if e.ProjectAttributionComplete {
		complete = 1
	}
	statement := "INSERT INTO review_events VALUES(?1,?2,?3,?4,?5,?6,?7)"
	if _, err := db.Exec(statement, e.ID, e.CardID, e.ReviewedAt, string(e.Rating),
		string(e.Algorithm), string(projects), complete); err != nil {
		t.Fatal(err)
	}
}
