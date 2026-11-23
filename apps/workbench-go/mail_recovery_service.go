package main

import (
	"context"

	"knowflick.local/workbench-go/internal/mail"
	"knowflick.local/workbench-go/internal/mailsync"
)

// ListRejectedMail 列出被隔离的邮件；旧 UIDVALIDITY 下的记录不可重试，也不展示。
func (m *MailService) ListRejectedMail(ctx context.Context, id string) ([]mail.RejectedMail, error) {
	dir, err := m.requireWritable()
	if err != nil {
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return mail.ListRejected(dir, id)
}

// ListImportedMail 列出某个账号导入的素材，按元数据绑定查找而不是按标题猜测。
func (m *MailService) ListImportedMail(ctx context.Context, id string) ([]mail.ImportedMail, error) {
	dir, err := m.requireWritable()
	if err != nil {
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return mail.ListImported(dir, id)
}

// RetryRejectedMail 重试被隔离的邮件。和手动同步共用锁，避免双写同一游标。
func (m *MailService) RetryRejectedMail(ctx context.Context, id string) (mailsync.Result, error) {
	return m.syncAccount(ctx, id, mailsync.ModeRetry)
}
