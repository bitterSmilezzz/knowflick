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
	"knowflick.local/workbench-go/internal/mailsync"
)

// MailService 把邮箱能力挂到预览后端：列账号、手动同步、自动同步启停。
//
// 只在资料库可写时工作：同步要往 materials、mail_imports 等表写数据，
// 只读打开时拒绝——不是「大概不行」，是明确拒绝并说明原因。
type MailService struct {
	preview    *PreviewService
	onAutoSync func(generation int)

	mu          sync.Mutex
	db          *sql.DB
	path        string
	cancel      context.CancelFunc
	loopContext context.Context
	lastErr     string
	rounds      int
}

// MailStatus 是给界面看的自动同步状态。
type MailStatus struct {
	Running   bool   `json:"running"`
	Rounds    int    `json:"rounds"`
	LastError string `json:"lastError"`
	Interval  string `json:"interval"`
}

// ListMailAccounts 列出账号（密码只说有没有）。
func (m *MailService) ListMailAccounts(ctx context.Context) ([]mail.Account, error) {
	path, err := m.requireWritable()
	if err != nil {
		return nil, err
	}
	db, err := m.connection(ctx, path)
	if err != nil {
		return nil, err
	}
	return mail.ListAccountsIn(db, filepath.Dir(path))
}

// SyncMailDueNow 手动跑一轮到期同步，与后台轮询共用同步锁。
func (m *MailService) SyncMailDueNow(ctx context.Context) ([]mailschedule.Outcome, error) {
	path, err := m.requireWritable()
	if err != nil {
		return nil, err
	}
	return m.syncDue(ctx, path)
}

func (m *MailService) syncDue(ctx context.Context, path string) ([]mailschedule.Outcome, error) {
	db, err := m.connection(ctx, path)
	if err != nil {
		return nil, err
	}
	return mailrunner.SyncDue(ctx, db, filepath.Dir(path), nil, nil)
}

// StartMailAutoSync 启动自动同步。应用启动与旧入口共用同一个轮询。
func (m *MailService) StartMailAutoSync(intervalMinutes int) (MailStatus, error) {
	if intervalMinutes <= 0 {
		return MailStatus{}, errors.New("自动同步间隔必须大于 0 分钟")
	}
	if _, err := m.requireWritable(); err != nil {
		return MailStatus{}, err
	}
	return m.startMailLoop(time.Duration(intervalMinutes) * time.Minute), nil
}

// StartBackgroundSync 应用启动时开始按分钟检查；每个账号仍按自己的间隔决定是否联网。
func (m *MailService) StartBackgroundSync() {
	m.startMailLoop(time.Minute)
}

// StartAutomaticMailSync 读账号里最小的自动同步间隔并启动轮询；全部关闭时不开线程。
func (m *MailService) StartAutomaticMailSync() MailStatus {
	m.stopMailLoop()
	path, err := m.requireWritable()
	if err != nil {
		return MailStatus{}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	db, err := m.connection(ctx, path)
	cancel()
	if err != nil {
		m.mu.Lock()
		m.lastErr = err.Error()
		m.mu.Unlock()
		return m.status()
	}
	interval, err := mail.MinAutoSyncIntervalIn(db)
	if err != nil {
		m.mu.Lock()
		m.lastErr = err.Error()
		m.mu.Unlock()
		return m.status()
	}
	return m.startMailLoop(interval)
}

func (m *MailService) startMailLoop(interval time.Duration) MailStatus {
	if interval <= 0 {
		return m.status()
	}
	m.mu.Lock()
	if m.cancel != nil {
		m.mu.Unlock()
		return m.status()
	}
	ctx, cancel := context.WithCancel(context.Background())
	m.cancel, m.loopContext = cancel, ctx
	m.rounds, m.lastErr = 0, ""
	m.mu.Unlock()
	go func() { _ = mailschedule.Loop(ctx, interval, m.pollMail, nil) }()
	return m.status()
}

func (m *MailService) stopMailLoop() {
	m.mu.Lock()
	cancel := m.cancel
	m.cancel, m.loopContext = nil, nil
	m.mu.Unlock()
	if cancel != nil {
		cancel()
	}
}

func (m *MailService) pollMail(loop context.Context) error {
	m.preview.mu.RLock()
	path, writable, generation, current := m.preview.path, m.preview.writable, m.preview.generation, m.preview.mailContext
	m.preview.mu.RUnlock()
	if current != nil && current.Err() != nil {
		return nil
	}
	if path == "" || !writable {
		return nil
	}

	ctx, cancel := context.WithCancel(loop)
	defer cancel()
	if current != nil {
		stop := context.AfterFunc(current, cancel)
		defer stop()
		if current.Err() != nil {
			return nil
		}
	}
	outcomes, err := m.syncDue(ctx, path)
	if ctx.Err() != nil || (current != nil && current.Err() != nil) {
		return nil
	}

	m.mu.Lock()
	if m.loopContext != loop {
		m.mu.Unlock()
		return nil
	}
	m.rounds++
	m.lastErr = ""
	if err != nil {
		m.lastErr = err.Error()
	}
	for _, outcome := range outcomes {
		if outcome.Error != "" {
			m.lastErr = outcome.AccountID + ": " + outcome.Error
		}
	}
	m.mu.Unlock()
	if len(outcomes) > 0 {
		m.preview.mu.RLock()
		notify := m.preview.onMailChanged
		m.preview.mu.RUnlock()
		if notify != nil {
			notify(generation)
		}
	}
	return err
}

// StopMailAutoSync 停掉自动同步；没在跑时不算错误。
func (m *MailService) StopMailAutoSync() MailStatus {
	m.mu.Lock()
	if m.cancel != nil {
		m.cancel()
		m.cancel, m.loopContext = nil, nil
	}
	m.mu.Unlock()
	return m.status()
}

// MailAutoSyncStatus 读当前状态。
func (m *MailService) MailAutoSyncStatus() MailStatus { return m.status() }

func (m *MailService) status() MailStatus {
	m.mu.Lock()
	defer m.mu.Unlock()
	status := MailStatus{Running: m.cancel != nil, Rounds: m.rounds, LastError: m.lastErr}
	if m.cancel != nil {
		status.Interval = "运行中"
	}
	return status
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
	return path, nil
}

// connection 复用同一个库连接：同步是串行的，一个连接足够。
func (m *MailService) connection(ctx context.Context, path string) (*sql.DB, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.db != nil && m.path == path {
		return m.db, nil
	}
	if m.db != nil {
		_ = m.db.Close()
		m.db = nil
	}
	db, err := mail.OpenExisting(ctx, path)
	if err != nil {
		return nil, err
	}
	m.db = db
	m.path = path
	return db, nil
}

// SyncMailAccountNow 手动同步一个账号，**不受自动同步间隔限制**。
//
// 与「到期同步」分开是有原因的：间隔为 0 表示关闭自动同步，不是禁止手动同步。
// 早期版本把「立即同步」接到到期判定上，结果是关闭自动同步的账号永远同步不了——
// 真实窗口里点「立即同步」只得到「导入 0 封」，这是本轮实测抓到的。
func (m *MailService) SyncMailAccountNow(ctx context.Context, accountID string) (mailsync.Result, error) {
	return m.syncAccount(ctx, accountID, mailsync.ModeNew)
}

func (m *MailService) syncAccount(ctx context.Context, accountID string, mode mailsync.Mode) (mailsync.Result, error) {
	path, err := m.requireWritable()
	if err != nil {
		return mailsync.Result{}, err
	}
	db, err := m.connection(ctx, path)
	if err != nil {
		return mailsync.Result{}, err
	}
	return mailrunner.SyncAccount(ctx, db, filepath.Dir(path), accountID, mode, nil, nil)
}

// SaveMailAccount 新增或编辑邮箱账号。密码写入 0600 凭据文件，不进 SQLite。
func (m *MailService) SaveMailAccount(ctx context.Context, config mail.Config, secret string) (mail.Account, error) {
	path, err := m.requireWritable()
	if err != nil {
		return mail.Account{}, err
	}
	unlock := mailschedule.Lock()
	defer unlock()
	if err := ctx.Err(); err != nil {
		return mail.Account{}, err
	}
	db, err := m.connection(ctx, path)
	if err != nil {
		return mail.Account{}, err
	}
	account, err := mail.SaveAccountIn(db, filepath.Dir(path), config, secret)
	if err != nil {
		return mail.Account{}, err
	}
	return *account, nil
}

// RemoveMailAccount 删除账号，保留导入台账与去重记录以免重复导入。
func (m *MailService) RemoveMailAccount(ctx context.Context, id string) error {
	path, err := m.requireWritable()
	if err != nil {
		return err
	}
	unlock := mailschedule.Lock()
	defer unlock()
	if err := ctx.Err(); err != nil {
		return err
	}
	db, err := m.connection(ctx, path)
	if err != nil {
		return err
	}
	return mail.RemoveAccountIn(db, filepath.Dir(path), id)
}

// SyncMailHistoryNow 导入某个账号下一批更早的邮件（mail_sync_history）。
// 与「立即同步」同锁：两个入口不能同时写同一个游标。
func (m *MailService) SyncMailHistoryNow(ctx context.Context, accountID string) (mailsync.Result, error) {
	return m.syncAccount(ctx, accountID, mailsync.ModeHistory)
}
