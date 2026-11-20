package mailrunner

import (
	"context"
	"crypto/x509"
	"database/sql"
	"encoding/json"
	"errors"

	"knowflick.local/workbench-go/internal/mail"
	"knowflick.local/workbench-go/internal/mailschedule"
	"knowflick.local/workbench-go/internal/mailsync"
)

// SyncDue 跑一轮到期账号：读库里的账号与磁盘上的密码，串行交给 Run。
//
// 整轮持有 mailschedule.Lock，避免和另一轮同步抢同一行游标。
// 单个账号失败记进 Outcome.Error，不让其余账号停下来。
func SyncDue(ctx context.Context, db *sql.DB, libraryDir string, now func() int64, roots *x509.CertPool) ([]mailschedule.Outcome, error) {
	if db == nil {
		return nil, errors.New("同步需要已打开的库连接")
	}
	clock := now
	if clock == nil {
		clock = timeNowMillis
	}
	unlock := mailschedule.Lock()
	defer unlock()
	return mailschedule.RunDue(ctx, db, dueSyncer{
		db: db, dir: libraryDir, now: clock, roots: roots, mode: mailsync.ModeNew,
	}, clock())
}

// dueSyncer 把一个账号 id 变成一次 mailrunner.Run。
type dueSyncer struct {
	db    *sql.DB
	dir   string
	now   func() int64
	roots *x509.CertPool
	mode  mailsync.Mode
}

func (s dueSyncer) Sync(ctx context.Context, accountID string) (int, int, error) {
	// 先记下尝试时间，再读密码、再连服务器。
	// 用「尝试」而不是「成功」：密码缺失或连接失败也要等一个间隔，
	// 否则下一轮轮询会立刻再撞一次。与 Rust 的 sync_attempt 同序。
	if _, err := s.db.ExecContext(ctx, "UPDATE mail_sync_state SET last_attempt_at=?1 WHERE account_id=?2", s.now(), accountID); err != nil {
		return 0, 0, err
	}
	var raw string
	err := s.db.QueryRowContext(ctx, "SELECT config_json FROM mail_accounts WHERE id=?1", accountID).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, 0, errors.New("邮箱账号不存在")
	}
	if err != nil {
		return 0, 0, err
	}
	var stored mail.Config
	if err := json.Unmarshal([]byte(raw), &stored); err != nil {
		return 0, 0, errors.New("无法解析已保存的邮箱账号")
	}
	if stored.ID == "" {
		stored.ID = accountID
	}
	if stored.Folder == "" {
		stored.Folder = "INBOX"
	}
	if stored.SyncLimit <= 0 {
		stored.SyncLimit = 50
	}
	password, err := mail.ReadPassword(s.dir, stored.ID)
	if err != nil {
		return 0, 0, err
	}
	result, err := Run(ctx, Config{
		AccountID: stored.ID,
		Folder:    stored.Folder,
		Limit:     stored.SyncLimit,
		Mode:      s.mode,
		Host:      stored.Host,
		Port:      stored.Port,
		Username:  stored.Username,
		Password:  password,
		Email:     stored.Email,
		DB:        s.db,
		Now:       s.now,
		Roots:     s.roots,
	})
	if err != nil {
		return 0, 0, err
	}
	return result.Imported, result.Rejected, nil
}
