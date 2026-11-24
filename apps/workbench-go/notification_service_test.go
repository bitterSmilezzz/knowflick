package main

import (
	"context"
	"testing"
)

func TestSendSystemNotificationRejectsEmptyTitle(t *testing.T) {
	if err := (&PreviewService{}).SendSystemNotification(context.Background(), "  ", "正文"); err == nil {
		t.Fatal("empty title should be rejected before running osascript")
	}
}
