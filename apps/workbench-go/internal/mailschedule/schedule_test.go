package mailschedule

import (
	"context"
	"database/sql"
	"errors"
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

// fakeSyncer 记录被调用的账号与结果。
type fakeSyncer struct {
	results map[string]struct {
		imported, rejected int
		err                error
	}
	calls []string
}

func (f *fakeSyncer) Sync(_ context.Context, accountID string) (int, int, error) {
	f.calls = append(f.calls, accountID)
	result := f.results[accountID]
	return result.imported, result.rejected, result.err
}

func TestRunDueSyncsOnlyDueAccounts(t *testing.T) {
	db := openScheduleDB(t)
	ctx := context.Background()
	// a 关闭；b 从未尝试；c 刚尝试过。
	insertAccount(t, db, "a", 0, 1, nil)
	insertAccount(t, db, "b", 15, 2, nil)
	recent := int64(1_000_000)
	insertAccount(t, db, "c", 15, 3, &recent)

	syncer := &fakeSyncer{results: map[string]struct {
		imported, rejected int
		err                error
	}{
		"b": {imported: 3, rejected: 1},
	}}
	outcomes, err := RunDue(ctx, db, syncer, recent+60_000)
	if err != nil {
		t.Fatal(err)
	}
	if len(outcomes) != 1 || outcomes[0].AccountID != "b" || outcomes[0].Imported != 3 || outcomes[0].Rejected != 1 {
		t.Fatalf("outcomes: %+v", outcomes)
	}
	if len(syncer.calls) != 1 || syncer.calls[0] != "b" {
		t.Fatalf("calls: %v", syncer.calls)
	}
}

func TestRunDueContinuesAfterOneFailure(t *testing.T) {
	db := openScheduleDB(t)
	insertAccount(t, db, "a", 15, 1, nil)
	insertAccount(t, db, "b", 15, 2, nil)
	syncer := &fakeSyncer{results: map[string]struct {
		imported, rejected int
		err                error
	}{
		"a": {err: errors.New("密码错了")},
		"b": {imported: 2},
	}}
	outcomes, err := RunDue(context.Background(), db, syncer, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(outcomes) != 2 {
		t.Fatalf("one failure should not stop the rest: %+v", outcomes)
	}
	if outcomes[0].Error != "密码错了" || outcomes[1].Imported != 2 {
		t.Fatalf("outcomes: %+v", outcomes)
	}
}

func TestRunDueStopsOnCancelledContext(t *testing.T) {
	db := openScheduleDB(t)
	insertAccount(t, db, "a", 15, 1, nil)
	insertAccount(t, db, "b", 15, 2, nil)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	outcomes, err := RunDue(ctx, db, &fakeSyncer{results: map[string]struct {
		imported, rejected int
		err                error
	}{}}, 0)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected cancellation: %v", err)
	}
	if len(outcomes) != 0 {
		t.Fatalf("nothing should run after cancellation: %+v", outcomes)
	}
}

func openScheduleDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "s.db"))
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(schema); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

func insertAccount(t *testing.T, db *sql.DB, id string, interval int, created int, attempt *int64) {
	t.Helper()
	config := "{\"syncIntervalMinutes\":" + itoa(interval) + "}"
	if _, err := db.Exec("INSERT INTO mail_accounts(id,config_json,created_at) VALUES(?1,?2,?3)", id, config, created); err != nil {
		t.Fatal(err)
	}
	if attempt != nil {
		if _, err := db.Exec("INSERT INTO mail_sync_state(account_id,last_attempt_at) VALUES(?1,?2)", id, *attempt); err != nil {
			t.Fatal(err)
		}
	}
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	out := ""
	for n > 0 {
		out = string(rune('0'+n%10)) + out
		n /= 10
	}
	return out
}

// TestExportLoopFixture 导出一轮调度的结果，供 Rust 对拍同一批账号。
func TestExportLoopFixture(t *testing.T) {
	target := os.Getenv("KF_GO_LOOP_FIXTURE")
	if target == "" {
		t.Skip("set KF_GO_LOOP_FIXTURE to export the loop fixture")
	}
	db := openScheduleDB(t)
	insertAccount(t, db, "off", 0, 1, nil)
	insertAccount(t, db, "due", 15, 2, nil)
	recent := int64(1_000_000)
	insertAccount(t, db, "recent", 15, 3, &recent)
	syncer := &fakeSyncer{results: map[string]struct {
		imported, rejected int
		err                error
	}{
		"due": {imported: 4, rejected: 1},
	}}
	outcomes, err := RunDue(context.Background(), db, syncer, recent+60_000)
	if err != nil {
		t.Fatal(err)
	}
	lines := make([]string, 0, len(outcomes))
	for _, outcome := range outcomes {
		lines = append(lines, outcome.AccountID+" imported="+itoa(outcome.Imported)+" rejected="+itoa(outcome.Rejected))
	}
	if err := os.WriteFile(target, []byte(strings.Join(lines, "\n")+"\n"), 0644); err != nil {
		t.Fatal(err)
	}
}

func TestLoopRunsImmediatelyThenOnEachTick(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	var count int32
	done := make(chan struct{})
	go func() {
		defer close(done)
		_ = Loop(ctx, 10*time.Millisecond, func(context.Context) error {
			atomic.AddInt32(&count, 1)
			return nil
		}, nil)
	}()
	// 第一次必须立刻跑：还没到任何 tick 就应该有计数。
	time.Sleep(5 * time.Millisecond)
	if atomic.LoadInt32(&count) == 0 {
		close(done)
		t.Fatal("first run should happen immediately")
	}
	time.Sleep(40 * time.Millisecond)
	cancel()
	<-done
	if atomic.LoadInt32(&count) < 2 {
		t.Fatalf("loop should tick repeatedly: %d", count)
	}
}

func TestLoopKeepsGoingAfterStepError(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	var calls, errorsSeen int32
	done := make(chan struct{})
	go func() {
		defer close(done)
		_ = Loop(ctx, 5*time.Millisecond, func(context.Context) error {
			atomic.AddInt32(&calls, 1)
			return errors.New("网络断了")
		}, func(error) { atomic.AddInt32(&errorsSeen, 1) })
	}()
	time.Sleep(40 * time.Millisecond)
	cancel()
	<-done
	if atomic.LoadInt32(&calls) < 2 {
		t.Fatalf("a failing step must not stop the loop: %d calls", calls)
	}
	if atomic.LoadInt32(&errorsSeen) < 2 {
		t.Fatalf("errors should be reported: %d", errorsSeen)
	}
}

func TestLoopRejectsNonPositiveInterval(t *testing.T) {
	if err := Loop(context.Background(), 0, func(context.Context) error { return nil }, nil); err == nil {
		t.Fatal("zero interval accepted")
	}
}

func TestLoopStopsOnCancelWithoutAnotherStep(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	var calls int32
	cancel()
	if err := Loop(ctx, time.Hour, func(context.Context) error {
		atomic.AddInt32(&calls, 1)
		return nil
	}, nil); !errors.Is(err, context.Canceled) {
		t.Fatalf("expected cancellation: %v", err)
	}
	if atomic.LoadInt32(&calls) != 0 {
		t.Fatalf("cancelled loop ran a step: %d", calls)
	}
}
