// Package mailschedule 迁自 Rust 的 sync_due_accounts：决定「哪些账号现在该同步」。
//
// 口径与 Rust 一致：
//   - sync_interval_minutes == 0 表示关闭自动同步，永不自动跑。
//   - 距上次**尝试**不足 interval 分钟就跳过。用「尝试时间」而不是「成功时间」：
//     一直失败的账号不该每次轮询都重试，否则会不断撞服务器。
//   - 遍历顺序按 created_at, id，保证行为可复现。
package mailschedule

import (
	"context"
	"database/sql"
	"encoding/json"
	"sync"
)

// Account 是调度需要的账号字段。
type Account struct {
	ID              string
	IntervalMinutes int
	LastAttemptAt   *int64
}

// Due 返回现在该同步的账号 id，顺序与库里一致。
// now 是毫秒时间戳。
func Due(accounts []Account, now int64) []string {
	due := make([]string, 0, len(accounts))
	for _, account := range accounts {
		if account.IntervalMinutes == 0 {
			continue
		}
		if account.LastAttemptAt != nil {
			elapsed := now - *account.LastAttemptAt
			if elapsed < int64(account.IntervalMinutes)*60_000 {
				continue
			}
		}
		due = append(due, account.ID)
	}
	return due
}

// LoadAccounts 读全部账号的调度字段，按 created_at, id 排序。
func LoadAccounts(ctx context.Context, db *sql.DB) ([]Account, error) {
	rows, err := db.QueryContext(ctx, `SELECT a.id, a.config_json, s.last_attempt_at
		FROM mail_accounts a LEFT JOIN mail_sync_state s ON s.account_id = a.id
		ORDER BY a.created_at, a.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	accounts := make([]Account, 0)
	for rows.Next() {
		var account Account
		var configJSON string
		var attempt sql.NullInt64
		if err := rows.Scan(&account.ID, &configJSON, &attempt); err != nil {
			return nil, err
		}
		account.IntervalMinutes = intervalFromConfig(configJSON)
		if attempt.Valid {
			value := attempt.Int64
			account.LastAttemptAt = &value
		}
		accounts = append(accounts, account)
	}
	return accounts, rows.Err()
}

// intervalFromConfig 从 config_json 里取 syncIntervalMinutes。
// 解析失败按 0 处理（关闭自动同步）：配置坏了就不该自己跑起来。
func intervalFromConfig(configJSON string) int {
	var config struct {
		SyncIntervalMinutes int `json:"syncIntervalMinutes"`
	}
	if err := json.Unmarshal([]byte(configJSON), &config); err != nil {
		return 0
	}
	if config.SyncIntervalMinutes < 0 {
		return 0
	}
	return config.SyncIntervalMinutes
}

// guard 串行化所有邮箱操作，等价于 Rust 的 ACCOUNT_LOCK。
//
// 为什么需要：一个进程可能持有同一个库目录，两轮同步并发会抢同一行游标——
// 后写的一方会把先写的进度覆盖掉，表现为「同步了但游标没动」。
var guard sync.Mutex

// Lock 获取邮箱操作锁，返回解锁函数。
func Lock() func() {
	guard.Lock()
	return guard.Unlock
}

// TryLock 是非阻塞版本：拿不到锁时返回 false 与 nil 解锁函数。
// 界面上的「立即同步」用它，避免用户连点排队。
func TryLock() (func(), bool) {
	if guard.TryLock() {
		return guard.Unlock, true
	}
	return nil, false
}

// Syncer 是「同步一个账号」的能力。调度循环不关心怎么同步，只关心成功与否。
type Syncer interface {
	Sync(ctx context.Context, accountID string) (imported, rejected int, err error)
}

// Outcome 是一轮调度里某个账号的结果。
type Outcome struct {
	AccountID string `json:"accountId"`
	Imported  int    `json:"imported"`
	Rejected  int    `json:"rejected"`
	Error     string `json:"error,omitempty"`
}

// RunDue 跑一轮到期账号：先判定谁该跑，再逐个同步。
//
// 串行而不是并发：每个账号都要动游标，并发会互相覆盖进度（见 Lock 的说明）。
// 单个账号失败不阻断其余账号——密码错了不该让别的账号也停。
func RunDue(ctx context.Context, db *sql.DB, syncer Syncer, now int64) ([]Outcome, error) {
	accounts, err := LoadAccounts(ctx, db)
	if err != nil {
		return nil, err
	}
	outcomes := make([]Outcome, 0)
	for _, id := range Due(accounts, now) {
		if ctx.Err() != nil {
			return outcomes, ctx.Err()
		}
		imported, rejected, syncErr := syncer.Sync(ctx, id)
		outcome := Outcome{AccountID: id, Imported: imported, Rejected: rejected}
		if syncErr != nil {
			outcome.Error = syncErr.Error()
		}
		outcomes = append(outcomes, outcome)
	}
	return outcomes, nil
}
