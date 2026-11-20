package reviewhistory

import (
	"strings"
	"testing"
)

func TestCaptureOrdersAndPeriodFilters(t *testing.T) {
	db := openDB(t)
	seed(t, db)
	insertEvent(t, db, event("3f2a5b1c-9d8e-4a3b-8c7d-0e1f2a3b4c5d", "b", 200))
	insertEvent(t, db, event("3f2a5b1c-9d8e-4a3b-8c7d-0e1f2a3b4c5e", "a", 100))
	snapshot, err := Capture(db)
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.Version != 1 || snapshot.CoverageStartedAt != 1000 || len(snapshot.Events) != 2 {
		t.Fatalf("capture: %+v", snapshot)
	}
	if snapshot.Events[0].CardID != "a" || snapshot.Events[1].CardID != "b" {
		t.Fatalf("capture must be ordered by reviewed_at: %+v", snapshot.Events)
	}
	period, err := Period(db, 150, 250)
	if err != nil {
		t.Fatal(err)
	}
	if len(period.Events) != 1 || period.Events[0].CardID != "b" {
		t.Fatalf("period: %+v", period.Events)
	}
	if _, err := Period(db, 50, 10); err == nil {
		t.Fatal("invalid period accepted")
	}
}

func TestRestoreSkipsIdenticalAndMergesCoverage(t *testing.T) {
	db := openDB(t)
	seed(t, db)
	local := event("3f2a5b1c-9d8e-4a3b-8c7d-0e1f2a3b4c5d", "card", 100, "a0000000-0000-4000-8000-000000000000")
	insertEvent(t, db, local)
	snapshot := Snapshot{Version: 1, CoverageStartedAt: 900, Events: []Event{
		local,
		event("3f2a5b1c-9d8e-4a3b-8c7d-0e1f2a3b4c5f", "new", 300),
	}}
	counts, err := Restore(db, snapshot)
	if err != nil {
		t.Fatal(err)
	}
	if counts.Inserted != 1 || counts.Skipped != 1 {
		t.Fatalf("counts: %+v", counts)
	}
	var value string
	if err := db.QueryRow("SELECT value FROM meta WHERE key='review_history_started_at'").Scan(&value); err != nil {
		t.Fatal(err)
	}
	if value != "1000" {
		t.Fatalf("coverage merged backwards: %s", value)
	}
	if _, err := Restore(db, snapshot); err != nil {
		t.Fatalf("restoring again should be idempotent: %v", err)
	}
}

func TestRestoreRefusesConflictingSameID(t *testing.T) {
	db := openDB(t)
	seed(t, db)
	id := "3f2a5b1c-9d8e-4a3b-8c7d-0e1f2a3b4c5d"
	insertEvent(t, db, event(id, "local-card", 100))
	snapshot := Snapshot{Version: 1, CoverageStartedAt: 100, Events: []Event{event(id, "other-card", 100)}}
	if _, err := Restore(db, snapshot); err == nil || !strings.Contains(err.Error(), "内容不同") {
		t.Fatalf("conflicting restore accepted: %v", err)
	}
	var card string
	if err := db.QueryRow("SELECT card_id FROM review_events WHERE event_id=?", id).Scan(&card); err != nil {
		t.Fatal(err)
	}
	if card != "local-card" {
		t.Fatalf("local record was overwritten: %s", card)
	}
}

func TestValidateSchemaRejectsDriftedTable(t *testing.T) {
	db := openDB(t)
	statement := "CREATE TABLE review_events (event_id TEXT PRIMARY KEY, card_id TEXT NOT NULL)"
	if _, err := db.Exec(statement); err != nil {
		t.Fatal(err)
	}
	if _, err := Capture(db); err == nil || !strings.Contains(err.Error(), "表结构") {
		t.Fatalf("drifted schema accepted: %v", err)
	}
}

func TestCaptureRequiresCoverageStart(t *testing.T) {
	db := openDB(t)
	if _, err := db.Exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)"); err != nil {
		t.Fatal(err)
	}
	statement := "CREATE TABLE review_events (event_id TEXT PRIMARY KEY, card_id TEXT NOT NULL, reviewed_at INTEGER NOT NULL, rating TEXT NOT NULL, algorithm TEXT NOT NULL, project_ids_json TEXT NOT NULL, project_attribution_complete INTEGER NOT NULL)"
	if _, err := db.Exec(statement); err != nil {
		t.Fatal(err)
	}
	if _, err := Capture(db); err == nil || !strings.Contains(err.Error(), "覆盖起点缺失") {
		t.Fatalf("missing coverage accepted: %v", err)
	}
}
