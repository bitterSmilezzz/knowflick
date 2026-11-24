package reviewhistory

import (
	"strings"
	"testing"
)

func TestValidateEventRules(t *testing.T) {
	valid := "3f2a5b1c-9d8e-4a3b-8c7d-0e1f2a3b4c5d"
	cases := []struct {
		name   string
		mutate func(*Event)
		want   string
	}{
		{"ok", func(*Event) {}, ""},
		{"non-canonical id", func(e *Event) { e.ID = strings.ToUpper(valid) }, "UUID v4"},
		{"not v4", func(e *Event) { e.ID = "3f2a5b1c-9d8e-1a3b-8c7d-0e1f2a3b4c5d" }, "UUID v4"},
		{"empty card", func(e *Event) { e.CardID = "" }, "卡片标识"},
		{"control in card", func(e *Event) { e.CardID = "a\nb" }, "卡片标识"},
		{"negative time", func(e *Event) { e.ReviewedAt = -1 }, "时间无效"},
		{"bad project", func(e *Event) { e.ProjectIDs = []string{"nope"} }, "项目标识"},
		{"duplicate project", func(e *Event) { e.ProjectIDs = []string{valid, valid} }, "重复或格式"},
		{"unsorted project", func(e *Event) {
			e.ProjectIDs = []string{"f0000000-0000-4000-8000-000000000000", "a0000000-0000-4000-8000-000000000000"}
		}, "顺序无效"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			candidate := event(valid, "card", 10)
			tc.mutate(&candidate)
			err := ValidateEvent(candidate)
			if tc.want == "" && err != nil {
				t.Fatalf("unexpected: %v", err)
			}
			if tc.want != "" && (err == nil || !strings.Contains(err.Error(), tc.want)) {
				t.Fatalf("want %q, got %v", tc.want, err)
			}
		})
	}
}

func TestValidateSnapshotRejectsBadInput(t *testing.T) {
	id := "3f2a5b1c-9d8e-4a3b-8c7d-0e1f2a3b4c5d"
	base := Snapshot{Version: 1, CoverageStartedAt: 5, Events: []Event{event(id, "c", 10)}}
	if err := Validate(base); err != nil {
		t.Fatalf("valid snapshot: %v", err)
	}
	mutations := []func(*Snapshot){
		func(s *Snapshot) { s.Version = 2 },
		func(s *Snapshot) { s.CoverageStartedAt = -1 },
		func(s *Snapshot) { s.Events = append(s.Events, event(id, "c", 11)) },
	}
	for index, mutate := range mutations {
		snapshot := base
		snapshot.Events = append([]Event(nil), base.Events...)
		mutate(&snapshot)
		if err := Validate(snapshot); err == nil {
			t.Fatalf("mutation %d accepted: %+v", index, snapshot)
		}
	}
}

func TestSortProjectIDs(t *testing.T) {
	got := SortProjectIDs([]string{"b", "a", "c"})
	want := []string{"a", "b", "c"}
	for index := range want {
		if got[index] != want[index] {
			t.Fatalf("sort: %v", got)
		}
	}
}
