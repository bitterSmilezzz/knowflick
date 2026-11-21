package reviewhistory

import (
	"database/sql"
	"encoding/json"
	"os"
	"testing"
)

// TestExportSnapshot 导出 Go 写的复习历史库与快照，供 Rust 读回对拍。
func TestExportSnapshot(t *testing.T) {
	target := os.Getenv("KF_GO_REVIEW_DB")
	if target == "" {
		t.Skip("set KF_GO_REVIEW_DB to export the review fixture")
	}
	if _, err := os.Lstat(target); !os.IsNotExist(err) {
		t.Fatalf("fixture must be new: %v", err)
	}
	db, err := sql.Open("sqlite", target)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	seed(t, db)
	first := event("3f2a5b1c-9d8e-4a3b-8c7d-0e1f2a3b4c5d", "card-a", 100,
		"a0000000-0000-4000-8000-000000000000", "b0000000-0000-4000-8000-000000000000")
	first.ProjectAttributionComplete = true
	insertEvent(t, db, first)
	insertEvent(t, db, event("3f2a5b1c-9d8e-4a3b-8c7d-0e1f2a3b4c5e", "card-b", 50))
	snapshot, err := Capture(db)
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(target+".snapshot.json", encoded, 0644); err != nil {
		t.Fatal(err)
	}
}
