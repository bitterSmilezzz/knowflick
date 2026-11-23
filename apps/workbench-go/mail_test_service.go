package main

import (
	"context"
	"crypto/x509"
	"errors"
	"fmt"
	"path/filepath"
	"time"

	"knowflick.local/workbench-go/internal/imap"
	"knowflick.local/workbench-go/internal/mail"
	"knowflick.local/workbench-go/internal/mailschedule"
)

// MailTestSummary 是连接测试的回执：登录成功后只读打开文件夹，报它和邮件数。
type MailTestSummary struct {
	Folder       string `json:"folder"`
	MessageCount uint32 `json:"messageCount"`
}

// TestMailAccount 只登录并只读打开文件夹，不写凭据、不拉邮件。
func (m *MailService) TestMailAccount(ctx context.Context, config mail.Config, secret string) (MailTestSummary, error) {
	return m.testMailAccount(ctx, config, secret, nil)
}

func (m *MailService) testMailAccount(ctx context.Context, config mail.Config, secret string, roots *x509.CertPool) (MailTestSummary, error) {
	var summary MailTestSummary
	config, err := mail.Validate(config)
	if err != nil {
		return summary, err
	}
	if err := ctx.Err(); err != nil {
		return summary, err
	}
	if secret == "" {
		secret, err = m.savedTestPassword(ctx, config)
	} else {
		err = mail.ValidatePassword(secret)
	}
	if err != nil {
		return summary, err
	}
	transport, err := imap.ConnectWithRoots(config.Host, config.Port, roots)
	if err != nil {
		return summary, fmt.Errorf("连接邮件服务器失败：%w", err)
	}
	if closer, ok := transport.(interface{ Close() error }); ok {
		defer func() { _ = closer.Close() }()
	}
	session, err := imap.New(transport, func() time.Time { return time.Now() })
	if err != nil {
		return summary, err
	}
	_, count, err := session.LoginAndExamine(config.Username, secret, config.Folder, func() time.Time { return time.Now() })
	if err != nil {
		return summary, err
	}
	return MailTestSummary{Folder: config.Folder, MessageCount: count}, nil
}

// savedTestPassword 只为与已保存登录身份一致的连接读取凭据。
func (m *MailService) savedTestPassword(ctx context.Context, config mail.Config) (string, error) {
	path, err := m.requireWritable()
	if err != nil {
		return "", err
	}
	unlock := mailschedule.Lock()
	defer unlock()
	if err := ctx.Err(); err != nil {
		return "", err
	}
	db, err := m.connection(ctx, path)
	if err != nil {
		return "", err
	}
	dir := filepath.Dir(path)
	account, err := mail.GetAccountIn(db, dir, config.ID)
	if err != nil {
		return "", err
	}
	if account == nil {
		return "", errors.New("请填写应用密码后再测试连接")
	}
	if account.Config.Host != config.Host || account.Config.Port != config.Port || account.Config.Username != config.Username {
		return "", errors.New("更换服务器或用户名时需要重新输入密码")
	}
	return mail.ReadPassword(dir, config.ID)
}
