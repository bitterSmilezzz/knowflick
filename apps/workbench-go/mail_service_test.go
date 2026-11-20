package main

import (
	"context"
	"path/filepath"
	"testing"
	"time"
)

// newMailService 造一个已打开且可写的资料库，返回可用的 MailService。
func newMailService(t *testing.T) *MailService {
	t.Helper()
	path := filepath.Join(t.TempDir(), "knowflick.db")
	preview := &PreviewService{path: path, writable: true}
	service := &MailService{preview: preview}
	t.Cleanup(func() {
		service.StopMailAutoSync()
		service.mu.Lock()
		if service.db != nil {
			_ = service.db.Close()
		}
		service.mu.Unlock()
	})
	return service
}

func TestMailServiceRequiresWritableLibrary(t *testing.T) {
	readOnly := &MailService{preview: &PreviewService{path: "/tmp/x.db", writable: false}}
	if _, err := readOnly.ListMailAccounts(context.Background()); err == nil {
		t.Fatal("mail sync must refuse a read-only library")
	}
	closed := &MailService{preview: &PreviewService{}}
	if _, err := closed.SyncMailDueNow(context.Background()); err == nil {
		t.Fatal("mail sync must refuse before a library is opened")
	}
}

func TestMailServiceAutoSyncStartStop(t *testing.T) {
	service := newMailService(t)
	status, err := service.StartMailAutoSync(1)
	if err != nil {
		t.Fatal(err)
	}
	if !status.Running {
		t.Fatalf("should be running: %+v", status)
	}
	// 重复启动不算错误，也不该起第二个循环。
	again, err := service.StartMailAutoSync(1)
	if err != nil || !again.Running {
		t.Fatalf("second start: %+v %v", again, err)
	}
	stopped := service.StopMailAutoSync()
	if stopped.Running {
		t.Fatalf("should be stopped: %+v", stopped)
	}
	// 没在跑时停止也不算错误。
	if service.StopMailAutoSync().Running {
		t.Fatal("stop is not idempotent")
	}
}

func TestMailServiceRejectsZeroInterval(t *testing.T) {
	service := newMailService(t)
	if _, err := service.StartMailAutoSync(0); err == nil {
		t.Fatal("zero interval accepted")
	}
}

func TestMailServiceRunsFirstRoundImmediately(t *testing.T) {
	service := newMailService(t)
	if _, err := service.StartMailAutoSync(60); err != nil {
		t.Fatal(err)
	}
	// 第一轮是立即跑的（哪怕间隔是 60 分钟）；库里没有账号也应当记下一个轮次。
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if status := service.MailAutoSyncStatus(); status.Rounds >= 1 {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("first round did not run: %+v", service.MailAutoSyncStatus())
}
