package mailschedule

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	_ "modernc.org/sqlite"
)

func TestDueSkipsDisabledAccounts(t *testing.T) {
	accounts := []Account{
		{ID: "off", IntervalMinutes: 0},
		{ID: "on", IntervalMinutes: 15},
	}
	if due := Due(accounts, 1000); len(due) != 1 || due[0] != "on" {
		t.Fatalf("interval 0 must be off: %v", due)
	}
}

func TestDueUsesAttemptTimeNotSuccessTime(t *testing.T) {
	attempt := int64(1_000_000)
	accounts := []Account{{ID: "a", IntervalMinutes: 15, LastAttemptAt: &attempt}}
	// 刚尝试过：还没到间隔，跳过。
	if due := Due(accounts, attempt+60_000); len(due) != 0 {
		t.Fatalf("should wait for the interval: %v", due)
	}
	// 到了间隔：该跑。
	if due := Due(accounts, attempt+15*60_000); len(due) != 1 {
		t.Fatalf("should be due after the interval: %v", due)
	}
	// 从未尝试过：立刻该跑。
	accounts[0].LastAttemptAt = nil
	if due := Due(accounts, attempt); len(due) != 1 {
		t.Fatalf("never attempted should be due: %v", due)
	}
}

func TestDueKeepsLibraryOrder(t *testing.T) {
	accounts := []Account{
		{ID: "c", IntervalMinutes: 5},
		{ID: "a", IntervalMinutes: 5},
		{ID: "b", IntervalMinutes: 5},
	}
	due := Due(accounts, 0)
	want := []string{"c", "a", "b"}
	for i := range want {
		if due[i] != want[i] {
			t.Fatalf("order not preserved: %v", due)
		}
	}
}

func TestIntervalFromConfig(t *testing.T) {
	cases := map[string]int{
		`{"syncIntervalMinutes":15}`: 15,
		`{"syncIntervalMinutes":0}`:  0,
		`{"syncIntervalMinutes":-5}`: 0,
		`not json`:                   0,
		`{}`:                         0,
	}
	for config, want := range cases {
		if got := intervalFromConfig(config); got != want {
			t.Fatalf("config %s: got %d want %d", config, got, want)
		}
	}
}

const schema = `
CREATE TABLE mail_accounts (
  id TEXT PRIMARY KEY, config_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL DEFAULT 0, last_sync_at INTEGER, last_error TEXT,
  uid_validity INTEGER, last_uid INTEGER NOT NULL DEFAULT 0);
CREATE TABLE mail_sync_state (
  account_id TEXT PRIMARY KEY, history_before INTEGER, history_complete INTEGER NOT NULL DEFAULT 0,
  last_attempt_at INTEGER);
`

func TestLoadAccountsReadsIntervalAndAttempt(t *testing.T) {
	db, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "m.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(schema); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO mail_accounts(id,config_json,created_at) VALUES('b','{"syncIntervalMinutes":15}',2)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO mail_accounts(id,config_json,created_at) VALUES('a','{"syncIntervalMinutes":0}',1)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("INSERT INTO mail_sync_state(account_id,last_attempt_at) VALUES('b',777)"); err != nil {
		t.Fatal(err)
	}
	accounts, err := LoadAccounts(context.Background(), db)
	if err != nil {
		t.Fatal(err)
	}
	if len(accounts) != 2 {
		t.Fatalf("accounts: %+v", accounts)
	}
	// 按 created_at 排序：a 在前。
	if accounts[0].ID != "a" || accounts[0].IntervalMinutes != 0 {
		t.Fatalf("first: %+v", accounts[0])
	}
	if accounts[1].ID != "b" || accounts[1].IntervalMinutes != 15 || accounts[1].LastAttemptAt == nil || *accounts[1].LastAttemptAt != 777 {
		t.Fatalf("second: %+v", accounts[1])
	}
}

func TestLockSerializes(t *testing.T) {
	unlock := Lock()
	if _, ok := TryLock(); ok {
		t.Fatal("TryLock must fail while the lock is held")
	}
	unlock()
	unlock2, ok := TryLock()
	if !ok {
		t.Fatal("TryLock should succeed after unlock")
	}
	unlock2()
}

// TestLockActuallySerializes 用并发计数验证互斥：
// 若锁失效，两个 goroutine 会同时进入临界区，最大值会变成 2。
func TestLockActuallySerializes(t *testing.T) {
	var inside int32
	var max int32
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			unlock := Lock()
			defer unlock()
			current := atomic.AddInt32(&inside, 1)
			for {
				old := atomic.LoadInt32(&max)
				if current <= old || atomic.CompareAndSwapInt32(&max, old, current) {
					break
				}
			}
			time.Sleep(time.Millisecond)
			atomic.AddInt32(&inside, -1)
		}()
	}
	wg.Wait()
	if max != 1 {
		t.Fatalf("critical section not exclusive: max=%d", max)
	}
}

// TestExportScheduleFixture 导出 Go 的到期判定结论，供 Rust 对拍同一批账号。
func TestExportScheduleFixture(t *testing.T) {
	target := os.Getenv("KF_GO_SCHEDULE_FIXTURE")
	if target == "" {
		t.Skip("set KF_GO_SCHEDULE_FIXTURE to export the schedule fixture")
	}
	attempt := int64(1_000_000)
	accounts := []Account{
		{ID: "never", IntervalMinutes: 15},
		{ID: "fresh", IntervalMinutes: 15, LastAttemptAt: &attempt},
		{ID: "old", IntervalMinutes: 15, LastAttemptAt: &attempt},
		{ID: "off", IntervalMinutes: 0, LastAttemptAt: &attempt},
	}
	// fresh 的 now 在间隔内，old 的 now 在间隔外。
	lines := []string{
		"at_interval_due=" + strings.Join(Due(accounts[:2], attempt+15*60_000), ","),
		"within_interval_due=" + strings.Join(Due(accounts[:2], attempt+60_000), ","),
		"off_due=" + strings.Join(Due(accounts[3:], attempt+999_999), ","),
	}
	if err := os.WriteFile(target, []byte(strings.Join(lines, "\n")+"\n"), 0644); err != nil {
		t.Fatal(err)
	}
}
