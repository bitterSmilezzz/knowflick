package main

import (
	"context"
	"strings"
	"testing"

	"knowflick.local/workbench-go/internal/mail"
)

func TestMailAccountMethodsRequireWritableLibrary(t *testing.T) {
	service := &MailService{preview: &PreviewService{}}
	if _, err := service.SaveMailAccount(context.Background(), mail.Config{}, "secret"); err == nil || !strings.Contains(err.Error(), "请先打开资料库") {
		t.Fatalf("readonly library accepted account save: %v", err)
	}
	if err := service.RemoveMailAccount(context.Background(), "acct"); err == nil || !strings.Contains(err.Error(), "请先打开资料库") {
		t.Fatalf("readonly library accepted account removal: %v", err)
	}
}
