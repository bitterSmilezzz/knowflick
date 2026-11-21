package main

import (
	"context"
	"crypto/x509"
	"errors"
	"fmt"
	"time"

	"knowflick.local/workbench-go/internal/imap"
	"knowflick.local/workbench-go/internal/mail"
)

// MailTestSummary 是连接测试的回执：登录成功后只读打开文件夹，报它和邮件数。
type MailTestSummary struct {
	Folder       string `json:"folder"`
	MessageCount uint32 `json:"messageCount"`
}

// TestMailAccount 只登录并只读打开文件夹，不写库、不拉邮件。
// 凭据与配置由调用方提供，不落盘——「测试」和「保存」是两件事。
func (m *MailService) TestMailAccount(ctx context.Context, config mail.Config, secret string) (MailTestSummary, error) {
	return testMailConnection(ctx, config, secret, nil)
}

// testMailConnection 是可注入根证书的实现：测试用自签名本地服务器，生产不传 roots。
func testMailConnection(ctx context.Context, config mail.Config, secret string, roots *x509.CertPool) (MailTestSummary, error) {
	var summary MailTestSummary
	if _, err := mail.Validate(config); err != nil {
		return summary, err
	}
	if secret == "" {
		return summary, errors.New("请填写应用密码后再测试连接")
	}
	if err := ctx.Err(); err != nil {
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
