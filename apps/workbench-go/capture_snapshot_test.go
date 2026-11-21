package main

import (
	"strings"
	"testing"
)

func TestCaptureDatabaseSnapshotOnRustLibrary(t *testing.T) {
	service, _ := openFixtureCopy(t)
	ctx := t.Context()
	opened, err := service.OpenInitialLibrary(ctx)
	if err != nil {
		t.Fatal(err)
	}
	snapshot, err := service.CaptureDatabaseSnapshot(ctx, opened.Generation)
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Materials) == 0 || len(snapshot.Cards) == 0 || len(snapshot.Notes) == 0 {
		t.Fatalf("snapshot entities: %d materials, %d cards, %d notes", len(snapshot.Materials), len(snapshot.Cards), len(snapshot.Notes))
	}
	if snapshot.R4 == nil || !strings.Contains(string(snapshot.R4), "projects") {
		t.Fatalf("r4 snapshot missing: %d bytes", len(snapshot.R4))
	}
	if snapshot.Subscriptions == nil || snapshot.Mail == nil || snapshot.ReviewHistory == nil || snapshot.DeletedRecords == nil {
		t.Fatal("snapshot sections missing")
	}
	if _, err := service.CaptureDatabaseSnapshot(ctx, 99); err == nil {
		t.Fatal("stale generation accepted")
	}
}
