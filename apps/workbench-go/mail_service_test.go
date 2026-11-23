package main

import (
	"context"
	"knowflick.local/workbench-go/internal/mail"
	"path/filepath"
	"testing"
	"time"
)

// newMailService 造一个已打开且可写的资料库，返回可用的 MailService。
func newMailService(t *testing.T) *MailService {
	t.Helper()
	path := filepath.Join(t.TempDir(), "knowflick.db")
	if _, err := mail.Open(filepath.Dir(path)); err != nil {
		t.Fatal(err)
	}
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

// TestSyncMailAccountNowIgnoresInterval 守住本轮实测抓到的 bug：
// 「立即同步」曾被接到到期判定上，间隔为 0（关闭自动同步）的账号因此永远同步不了，
// 点完只得到「导入 0 封」，界面上看不出任何问题。手动同步必须绕过间隔判定。
func TestSyncMailAccountNowIgnoresInterval(t *testing.T) {
	service := newMailService(t)
	id := "6f1a5b3e-2c4d-4a8f-9e1b-7c5d2a9f0e33"
	// 资料库目录 = 数据库文件的父目录（mail.Open 会把不存在的目录当库目录）。
	dir := filepath.Dir(service.preview.path)
	if _, err := mail.SaveAccount(dir, mail.Config{
		ID: id, Name: "手动同步", Email: "ui@example.com", Host: "127.0.0.1",
		Port: 1, Username: "ui@example.com", Folder: "INBOX", SyncLimit: 50,
		// 0 = 关闭自动同步。手动同步必须照样跑。
		SyncIntervalMinutes: 0,
	}, "p"); err != nil {
		t.Fatal(err)
	}
	if _, err := service.SyncMailAccountNow(context.Background(), id); err == nil {
		t.Fatal("a manual sync of an unreachable host must return an error")
	}
	account, err := mail.GetAccount(dir, id)
	if err != nil || account == nil || account.LastAttemptAt == nil {
		t.Fatalf("sync did not reach the saved account: %+v, %v", account, err)
	}
}

func TestSyncMailHistoryNowReachesAccount(t *testing.T) {
	service := newMailService(t)
	id := "7f2a6c4e-3d5e-4b9f-8f2c-8d6e3b0f1e44"
	dir := filepath.Dir(service.preview.path)
	if _, err := mail.SaveAccount(dir, mail.Config{
		ID: id, Name: "历史同步", Email: "history@example.com", Host: "127.0.0.1",
		Port: 1, Username: "history@example.com", Folder: "INBOX", SyncLimit: 50,
		SyncIntervalMinutes: 0,
	}, "p"); err != nil {
		t.Fatal(err)
	}
	if _, err := service.SyncMailHistoryNow(context.Background(), id); err == nil {
		t.Fatal("a history sync of an unreachable host must return an error")
	}
	account, err := mail.GetAccount(dir, id)
	if err != nil || account == nil || account.LastAttemptAt == nil {
		t.Fatalf("sync did not reach the saved account: %+v, %v", account, err)
	}
}

func TestStartAutomaticMailSyncUsesSmallestInterval(t *testing.T) {
	service := newMailService(t)
	dir := filepath.Dir(service.preview.path)
	for _, config := range []mail.Config{
		{ID: "11111111-1111-4111-8111-111111111111", Name: "手动", Email: "a@example.org", Host: "127.0.0.1", Port: 1, Username: "a", Folder: "INBOX", SyncLimit: 10},
		{ID: "22222222-2222-4222-8222-222222222222", Name: "自动", Email: "b@example.org", Host: "127.0.0.1", Port: 1, Username: "b", Folder: "INBOX", SyncLimit: 10, SyncIntervalMinutes: 30},
		{ID: "33333333-3333-4333-8333-333333333333", Name: "更勤", Email: "c@example.org", Host: "127.0.0.1", Port: 1, Username: "c", Folder: "INBOX", SyncLimit: 10, SyncIntervalMinutes: 15},
	} {
		if _, err := mail.SaveAccount(dir, config, "p"); err != nil {
			t.Fatal(err)
		}
	}
	service.StartAutomaticMailSync()
	if !service.MailAutoSyncStatus().Running {
		t.Fatal("automatic sync did not start")
	}
	// 最小间隔是 15 分钟；立即跑的第一轮不应连上未开放的端口，但必须记下轮次与错误。
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if status := service.MailAutoSyncStatus(); status.Rounds >= 1 {
			if status.LastError == "" {
				t.Fatal("unreachable account should record an error")
			}
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("first automatic round did not run")
}

func TestServiceShutdownCancelsBackgroundMailContext(t *testing.T) {
	service := &PreviewService{}
	service.resetMailContext(true)
	ctx := service.mailContext
	if ctx == nil {
		t.Fatal("writable open should create a mail context")
	}
	if err := service.ServiceShutdown(); err != nil {
		t.Fatal(err)
	}
	if ctx.Err() == nil {
		t.Fatal("shutdown should cancel in-flight mail work")
	}
	service.mu.RLock()
	defer service.mu.RUnlock()
	if service.writable || service.mailContext != nil {
		t.Fatal("shutdown should leave the preview closed")
	}
}
