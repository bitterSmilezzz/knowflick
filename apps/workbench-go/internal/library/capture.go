package library

import (
	"context"
	"errors"
	"net/url"
	"strings"
	"unicode/utf16"

	"github.com/google/uuid"
)

// CaptureInput 是一条闪念素材的输入；URL 可为空。
type CaptureInput struct {
	Title string
	Text  string
	URL   string
}

// Capture 新建一条收件箱素材：正文必填，标题缺省取首行，
// 有链接时 sourceType 记为 web（与桌面端 makeMaterial 同规则）。
// content_hash 由写入层按 SHA-256 重算，与 Rust save_material 一致。
func (l *Library) Capture(ctx context.Context, input CaptureInput, now int64) (string, error) {
	if !l.writable {
		return "", ErrReadOnly
	}
	text := strings.TrimSpace(input.Text)
	if text == "" {
		return "", errors.New("正文不能为空，记一句话也可以")
	}
	if hasControlCharacters(text) {
		return "", errors.New("素材正文不能包含控制字符")
	}
	sourceURL := strings.TrimSpace(input.URL)
	if sourceURL != "" {
		parsed, err := url.Parse(sourceURL)
		if err != nil || parsed.Host == "" {
			return "", errors.New("来源链接无效")
		}
		if parsed.Scheme != "http" && parsed.Scheme != "https" {
			return "", errors.New("来源链接只接受 http 或 https")
		}
		if parsed.User != nil {
			return "", errors.New("来源链接里不能带账号密码")
		}
	}
	title := strings.TrimSpace(input.Title)
	if title == "" {
		title = captureTitleFrom(text)
	}
	sourceType := "manual"
	if sourceURL != "" {
		sourceType = "web"
	}
	material := ImportedMaterial{
		ID: uuid.NewString(), SourceType: sourceType, Title: title, RawText: text,
		MetadataJSON: "{}", InboxStatus: "inbox", CreatedAt: now, UpdatedAt: now,
	}
	if sourceURL != "" {
		material.SourceURL = sourceURL
	}
	inserted, err := SaveImportedMaterial(ctx, l.db, material)
	if err != nil {
		return "", err
	}
	if !inserted {
		return "", errors.New("素材标识冲突，请重试")
	}
	return material.ID, nil
}

// captureTitleFrom 取正文首行的前 80 个 UTF-16 码元（与 makeMaterial 同语义）。
func captureTitleFrom(text string) string {
	first := strings.SplitN(text, "\n", 2)[0]
	units := utf16.Encode([]rune(first))
	if len(units) <= 80 {
		return strings.TrimSpace(first)
	}
	return strings.TrimSpace(string(utf16.Decode(units[:80])))
}

func hasControlCharacters(value string) bool {
	for _, r := range value {
		if r < 0x20 || (r >= 0x7f && r <= 0x9f) {
			return true
		}
	}
	return false
}
