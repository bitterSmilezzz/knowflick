package main

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"sync"
	"time"

	"knowflick.local/workbench-go/internal/mail"
	"knowflick.local/workbench-go/internal/mailrunner"
	"knowflick.local/workbench-go/internal/mailschedule"
)

// MailService 把邮箱能力挂到预览后端：列账号、手动同步、自动同步启停。
//
// 只在资料库可写时工作：同步要往 materials、mail_imports 等表写数据，
// 只读打开时拒绝——不是「大概不行」，是明确拒绝并说明原因。
type MailService struct {
	preview *PreviewService

	mu      sync.Mutex
	db      *sql.DB
	dir     string
	cancel  context.CancelFunc
	lastErr string
	rounds  int
}

// MailStatus 是给界面看的自动同步状态。
type MailStatus struct {
	Running   bool   `json:"running"`
	Rounds    int    `json:"rounds"`
	LastError string `json:"lastError"`
}

// ListMailAccounts 列出账号（密码只说有没有）。
func (m *MailService) ListMailAccounts(ctx context.Context) ([]mail.Account, error) {
	dir, err := m.requireWritable()
	if err != nil {
		return nil, err
	}
	return mail.ListAccounts(dir)
}

// SyncMailDueNow 手动跑一轮到期同步。
//
// 与自动同步共用同一把锁：两者不会同时推进同一行游标。
func (m *MailService) SyncMailDueNow(ctx context.Context) ([]mailschedule.Outcome, error) {
	dir, err := m.requireWritable()
	if err != nil {
		return nil, err
	}
	db, err := m.connection(dir)
	if err != nil {
		return nil, err
	}
	return mailrunner.SyncDue(ctx, db, dir, nil, nil)
}

// StartMailAutoSync 启动自动同步：立即跑一轮，之后每 interval 分钟一轮。
func (m *MailService) StartMailAutoSync(intervalMinutes int) (MailStatus, error) {
	if intervalMinutes <= 0 {
		return MailStatus{}, errors.New("自动同步间隔必须大于 0 分钟")
	}
	dir, err := m.requireWritable()
	if err != nil {
		return MailStatus{}, err
	}
	db, err := m.connection(dir)
	if err != nil {
		return MailStatus{}, err
	}
	m.mu.Lock()
	if m.cancel != nil {
		m.mu.Unlock()
		return m.status(), nil
	}
	ctx, cancel := context.WithCancel(context.Background())
	m.cancel = cancel
	m.rounds = 0
	m.lastErr = ""
	m.mu.Unlock()

	go func() {
		_ = mailrunner.SyncDueLoop(ctx, time.Duration(intervalMinutes)*time.Minute, db, dir, nil, nil,
			func(outcomes []mailschedule.Outcome, err error) {
				m.mu.Lock()
				defer m.mu.Unlock()
				m.rounds++
				if err != nil {
					m.lastErr = err.Error()
					return
				}
				for _, outcome := range outcomes {
					if outcome.Error != "" {
						m.lastErr = outcome.AccountID + ": " + outcome.Error
					}
				}
			})
	}()
	return m.status(), nil
}

// StopMailAutoSync 停掉自动同步；没在跑时不算错误。
func (m *MailService) StopMailAutoSync() MailStatus {
	m.mu.Lock()
	if m.cancel != nil {
		m.cancel()
		m.cancel = nil
	}
	m.mu.Unlock()
	return m.status()
}

// MailAutoSyncStatus 读当前状态。
func (m *MailService) MailAutoSyncStatus() MailStatus { return m.status() }

func (m *MailService) status() MailStatus {
	m.mu.Lock()
	defer m.mu.Unlock()
	return MailStatus{Running: m.cancel != nil, Rounds: m.rounds, LastError: m.lastErr}
}

// requireWritable 要求资料库已打开且可写，返回它的目录。
func (m *MailService) requireWritable() (string, error) {
	m.preview.mu.RLock()
	path, writable := m.preview.path, m.preview.writable
	m.preview.mu.RUnlock()
	if path == "" {
		return "", errors.New("请先打开资料库")
	}
	if !writable {
		return "", errors.New("邮箱同步会写入资料库，请先启用编辑")
	}
	return filepath.Dir(path), nil
}

// connection 复用同一个库连接：同步是串行的，一个连接足够。
func (m *MailService) connection(dir string) (*sql.DB, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.db != nil && m.dir == dir {
		return m.db, nil
	}
	if m.db != nil {
		_ = m.db.Close()
		m.db = nil
	}
	db, err := mail.Open(dir)
	if err != nil {
		return nil, err
	}
	m.db = db
	m.dir = dir
	return db, nil
}

// SyncMailAccountNow 手动同步一个账号，**不受自动同步间隔限制**。
//
// 与「到期同步」分开是有原因的：间隔为 0 表示关闭自动同步，不是禁止手动同步。
// 早期版本把「立即同步」接到到期判定上，结果是关闭自动同步的账号永远同步不了——
// 真实窗口里点「立即同步」只得到「导入 0 封」，这是本轮实测抓到的。
func (m *MailService) SyncMailAccountNow(ctx context.Context, accountID string) (mailschedule.Outcome, error) {
	dir, err := m.requireWritable()
	if err != nil {
		return mailschedule.Outcome{}, err
	}
	db, err := m.connection(dir)
	if err != nil {
		return mailschedule.Outcome{}, err
	}
	unlock := mailschedule.Lock()
	defer unlock()
	syncer := mailrunner.NewAccountSyncer(db, dir, nil, nil)
	imported, rejected, syncErr := syncer.Sync(ctx, accountID)
	outcome := mailschedule.Outcome{AccountID: accountID, Imported: imported, Rejected: rejected}
	if syncErr != nil {
		outcome.Error = syncErr.Error()
	}
	return outcome, nil
}

// SaveMailAccount 新增或编辑邮箱账号。密码写入 0600 凭据文件，不进 SQLite。
func (m *MailService) SaveMailAccount(ctx context.Context, config mail.Config, secret string) (mail.Account, error) {
	dir, err := m.requireWritable()
	if err != nil {
		return mail.Account{}, err
	}
	if err := ctx.Err(); err != nil {
		return mail.Account{}, err
	}
	account, err := mail.SaveAccount(dir, config, secret)
	if err != nil {
		return mail.Account{}, err
	}
	return *account, nil
}

// RemoveMailAccount 删除账号，保留导入台账与去重记录以免重复导入。
func (m *MailService) RemoveMailAccount(ctx context.Context, id string) error {
	dir, err := m.requireWritable()
	if err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	return mail.RemoveAccount(dir, id)
}
