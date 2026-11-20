// Package mailimport 把一封已解析的邮件映射成素材记录，并维护去重账本。
//
// 与 Rust mail.rs 的口径一致：
//   - 身份优先用 Message-ID，没有才退到 UID 三元组——IMAP UID 只在同一代邮箱里唯一。
//   - 素材 id 是 `mail-<hash(身份)>`，同一封邮件重复导入落到同一行。
//   - 去重账本按 (account, folder, uid_validity, uid) 记；同一 Message-ID 换了 UID
//     也复用已有素材，避免 UIDVALIDITY 翻滚后重复下载。
//   - 无主题给「（无主题）」、无正文给中文占位——空标题在收件箱里一眼就看出没做好。
package mailimport

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

// Material 是一条待写入的素材记录，字段与 materials 表对齐。
type Material struct {
	ID           string `json:"id"`
	SourceType   string `json:"sourceType"`
	Title        string `json:"title"`
	RawText      string `json:"rawText"`
	MetadataJSON string `json:"metadataJson"`
	InboxStatus  string `json:"inboxStatus"`
	CreatedAt    int64  `json:"createdAt"`
	UpdatedAt    int64  `json:"updatedAt"`
}

// Mail 是一封已解析邮件里构造素材所需的字段。
type Mail struct {
	Subject      string
	MessageID    string
	From         string
	To           string
	Cc           string
	Date         string
	Text         string
	Attachments  []string
	OriginalSize int
}

// Account 是构造身份所需的账号信息。
type Account struct {
	ID       string
	Host     string
	Port     uint16
	Username string
	Email    string
	Folder   string
}

// Metadata 是落进 materials.metadata_json 的结构。
type Metadata struct {
	MailAccountID       string   `json:"mailAccountId"`
	AccountEmail        string   `json:"accountEmail"`
	Folder              string   `json:"folder"`
	UIDValidity         uint32   `json:"uidValidity"`
	UID                 uint32   `json:"uid"`
	MessageID           string   `json:"messageId"`
	From                string   `json:"from"`
	To                  string   `json:"to"`
	Cc                  string   `json:"cc"`
	Date                string   `json:"date"`
	ImportAt            int64    `json:"importAt"`
	AttachmentFilenames []string `json:"attachmentFilenames"`
	OriginalSizeBytes   int      `json:"originalSizeBytes"`
	TextTruncated       bool     `json:"textTruncated"`
}

// Identity 构造素材身份：优先 Message-ID，没有才退到 UID 三元组。
// 命名空间含账号、主机、端口、用户名与文件夹——不同邮箱的同一 UID 不是同一封邮件。
func Identity(account Account, validity, uid uint32, messageID string) string {
	namespace := fmt.Sprintf("%s\n%s\n%d\n%s\n%s", account.ID, account.Host, account.Port, account.Username, account.Folder)
	if strings.TrimSpace(messageID) == "" {
		return fmt.Sprintf("%s\nuid:%d:%d", namespace, validity, uid)
	}
	return namespace + "\n" + strings.TrimSpace(messageID)
}

// MaterialID 是 `mail-<hash>`，与 Rust 的 calculate_hash 同构（十六进制 SHA-256 前 32 位）。
func MaterialID(identity string) string {
	sum := sha256.Sum256([]byte(identity))
	return "mail-" + hex.EncodeToString(sum[:])[:32]
}

// FromMail 把一封邮件映射成素材；附件只记文件名，正文为空时给中文占位。
func FromMail(account Account, validity, uid uint32, mail Mail, now int64) (Material, error) {
	identity := Identity(account, validity, uid, mail.MessageID)
	metadata := Metadata{
		MailAccountID:       account.ID,
		AccountEmail:        account.Email,
		Folder:              account.Folder,
		UIDValidity:         validity,
		UID:                 uid,
		MessageID:           mail.MessageID,
		From:                mail.From,
		To:                  mail.To,
		Cc:                  mail.Cc,
		Date:                mail.Date,
		ImportAt:            now,
		AttachmentFilenames: mail.Attachments,
		OriginalSizeBytes:   mail.OriginalSize,
	}
	if metadata.AttachmentFilenames == nil {
		metadata.AttachmentFilenames = []string{}
	}
	raw, err := json.Marshal(metadata)
	if err != nil {
		return Material{}, errors.New("无法编码邮件元数据")
	}
	title := strings.TrimSpace(mail.Subject)
	if title == "" {
		title = "（无主题）"
	}
	text := strings.TrimSpace(mail.Text)
	if text == "" {
		text = "（这封邮件没有可读的正文，可能只有附件）"
	}
	return Material{
		ID:           MaterialID(identity),
		SourceType:   "email",
		Title:        title,
		RawText:      text,
		MetadataJSON: string(raw),
		InboxStatus:  "inbox",
		CreatedAt:    now,
		UpdatedAt:    now,
	}, nil
}

// MessageIDOf 从素材元数据里取 messageId；解析失败返回空串（不阻断导入）。
func MessageIDOf(metadataJSON string) string {
	var metadata Metadata
	if err := json.Unmarshal([]byte(metadataJSON), &metadata); err != nil {
		return ""
	}
	return strings.TrimSpace(metadata.MessageID)
}
