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
	outcome, err := service.SyncMailAccountNow(context.Background(), id)
	if err != nil {
		t.Fatalf("manual sync should reach the account, got %v", err)
	}
	if outcome.AccountID != id {
		t.Fatalf("outcome: %+v", outcome)
	}
	// 连不上 imap.example.com 是预期内的失败，但**必须尝试、必须报错**，
	// 而不是因为间隔为 0 被静默跳过。
	if outcome.Error == "" {
		t.Fatal("a manual sync of an unreachable host must report an error, not silently skip")
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
	outcome, err := service.SyncMailHistoryNow(context.Background(), id)
	if err != nil {
		t.Fatalf("history sync should reach the account, got %v", err)
	}
	if outcome.AccountID != id {
		t.Fatalf("outcome: %+v", outcome)
	}
	if outcome.Error == "" {
		t.Fatal("a history sync of an unreachable host must report an error, not silently skip")
	}
}
