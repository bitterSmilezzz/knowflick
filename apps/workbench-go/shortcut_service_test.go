package main

import "testing"

func TestGetShortcutStatusBeforeAppStart(t *testing.T) {
	service := &PreviewService{}
	status, err := service.GetShortcutStatus(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if status.Shortcut != "Alt+Space" || status.Registered || status.Error == nil {
		t.Fatalf("status: %+v", status)
	}
	if err := service.HideCapsule(t.Context()); err == nil {
		t.Fatal("missing capsule window accepted")
	}
	if err := service.ToggleCapsule(t.Context()); err == nil {
		t.Fatal("missing capsule window accepted")
	}
}
