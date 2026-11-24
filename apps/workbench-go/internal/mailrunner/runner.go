// Package mailrunner 把 imap / mimex / mailimport / mailsync / mailstore 组装成一条可执行的同步。
//
// 这一层只做接线，不重复实现规则：取 UID 的规则在 mailsync，解析在 mimex，
// 映射在 mailimport，账本在 mailstore。接线层自己只负责「按什么顺序调用它们」。
package mailrunner

import (
	"context"
	"crypto/x509"
	"database/sql"
	"errors"
	"time"

	"knowflick.local/workbench-go/internal/imap"
	"knowflick.local/workbench-go/internal/mailimport"
	"knowflick.local/workbench-go/internal/mailstore"
	"knowflick.local/workbench-go/internal/mailsync"
	"knowflick.local/workbench-go/internal/mimex"
)

// Config 是一次同步所需的全部输入。
type Config struct {
	AccountID string
	Folder    string
	Limit     int
	Mode      mailsync.Mode

	// 账号身份与凭据由调用方给：runner 不读凭据文件，也不碰密码。
	Host     string
	Port     uint16
	Username string
	Password string
	Email    string

	// DB 是已打开的库连接（表结构由 mail 包保证）。
	DB *sql.DB
	// Now 返回毫秒时间戳；为 nil 时用系统时间。
	Now func() int64
	// Roots 仅供测试注入自签名根证书；生产不传，走系统根。
	Roots *x509.CertPool
}

// Run 登录、只读打开文件夹，然后跑一轮同步。
//
// 连接在函数返回时关闭：同步是一次性会话，不长期占用服务器连接。
func Run(ctx context.Context, config Config) (mailsync.Result, error) {
	if config.DB == nil {
		return mailsync.Result{}, errors.New("同步需要已打开的库连接")
	}
	if config.Password == "" {
		return mailsync.Result{}, errors.New("同步需要邮箱密码")
	}
	now := config.Now
	if now == nil {
		now = func() int64 { return timeNowMillis() }
	}
	transport, err := imap.ConnectWithRoots(config.Host, config.Port, config.Roots)
	if err != nil {
		return mailsync.Result{}, err
	}
	if closer, ok := transport.(interface{ Close() error }); ok {
		defer func() { _ = closer.Close() }()
	}
	session, err := imap.New(transport, clockFrom(now))
	if err != nil {
		return mailsync.Result{}, err
	}
	if _, _, err := session.LoginAndExamine(config.Username, config.Password, config.Folder, clockFrom(now)); err != nil {
		return mailsync.Result{}, err
	}
	store := mailstore.New(config.DB)
	options := mailsync.Options{
		AccountID: config.AccountID,
		Folder:    config.Folder,
		Limit:     config.Limit,
		Mode:      config.Mode,
		Fetch:     sessionFetcher{session: session, now: clockFrom(now)},
		Store:     store,
		Import:    importer{account: accountOf(config), store: store, db: config.DB, now: now},
		Now:       now,
	}
	return mailsync.Run(ctx, options)
}

// sessionFetcher 把 imap.Session 适配成 mailsync.Fetcher。
// 时间来源单独传：imap 的方法签名要它，但编排层不该关心时钟。
type sessionFetcher struct {
	session *imap.Session
	now     func() time.Time
}

func (f sessionFetcher) UIDValidity() uint32 { return f.session.UIDValidity() }

func (f sessionFetcher) SearchRange(after uint32, through *uint32, limit int, newestFirst bool) ([]uint32, error) {
	return f.session.SearchRange(after, through, limit, newestFirst, f.now)
}

func (f sessionFetcher) Fetch(uid uint32) ([]byte, bool, error) {
	return f.session.Fetch(uid, f.now)
}

// importer 把原始邮件变成素材并写库。
type importer struct {
	account mailimport.Account
	store   *mailstore.Store
	db      *sql.DB
	now     func() int64
}

func (i importer) Import(ctx context.Context, _ string, validity, uid uint32, raw []byte) (string, string, error) {
	message, err := mimex.Parse(raw)
	if err != nil {
		return "", "", err
	}
	material, err := mailimport.FromMail(i.account, validity, uid, mailimport.Mail{
		Subject:      message.Subject,
		MessageID:    message.MessageID,
		From:         message.From,
		To:           message.To,
		Date:         message.Date,
		Text:         message.Text,
		Attachments:  message.Attachments,
		OriginalSize: len(raw),
	}, i.now())
	if err != nil {
		return "", "", err
	}
	// 同一 Message-ID 已有素材时复用它的 id：UIDVALIDITY 翻滚后不该变成两条。
	if existing, ok, lookupErr := i.store.ExistingMaterial(ctx, i.account.ID, i.account.Folder, message.MessageID); lookupErr == nil && ok {
		return existing, message.MessageID, nil
	}
	if err := mailimport.SaveMaterial(ctx, i.db, material, i.now()); err != nil {
		return "", "", err
	}
	return material.ID, message.MessageID, nil
}

func accountOf(config Config) mailimport.Account {
	return mailimport.Account{
		ID:       config.AccountID,
		Host:     config.Host,
		Port:     config.Port,
		Username: config.Username,
		Email:    config.Email,
		Folder:   config.Folder,
	}
}

// clockFrom 把毫秒时间戳函数适配成 time.Time 时钟。
// imap 的会话预算按真实时长算，所以这里必须给出 time.Time 而不是毫秒。
func clockFrom(now func() int64) func() time.Time {
	return func() time.Time { return time.UnixMilli(now()) }
}

// timeNowMillis 是默认时钟。
func timeNowMillis() int64 { return time.Now().UnixMilli() }
