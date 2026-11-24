package mimex

import (
	"net/mail"
	"os"
	"strings"
	"testing"
)

func TestPlainTextMessage(t *testing.T) {
	raw := "From: a@example.com\r\nTo: b@example.com\r\nSubject: 测试主题\r\nMessage-Id: <m1@x>\r\n" +
		"Content-Type: text/plain; charset=utf-8\r\n\r\n正文第一段\r\n\r\n正文第二段\r\n"
	message, err := Parse([]byte(raw))
	if err != nil {
		t.Fatal(err)
	}
	if message.Subject != "测试主题" || message.MessageID != "<m1@x>" {
		t.Fatalf("headers: %+v", message)
	}
	if !strings.Contains(message.Text, "正文第一段") || !strings.Contains(message.Text, "正文第二段") {
		t.Fatalf("body: %q", message.Text)
	}
	if message.Truncated || len(message.Attachments) != 0 {
		t.Fatalf("flags: %+v", message)
	}
}

func TestMultipartAlternativePrefersPlainText(t *testing.T) {
	raw := "Subject: alt\r\nContent-Type: multipart/alternative; boundary=BOUND\r\n\r\n" +
		"--BOUND\r\nContent-Type: text/plain\r\n\r\n纯文本版本\r\n" +
		"--BOUND\r\nContent-Type: text/html\r\n\r\n<p>HTML 版本</p>\r\n" +
		"--BOUND--\r\n"
	message, err := Parse([]byte(raw))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(message.Text, "纯文本版本") || strings.Contains(message.Text, "HTML 版本") {
		t.Fatalf("alternative should prefer plain text: %q", message.Text)
	}
}

func TestMultipartAlternativeFallsBackWhenPlainEmpty(t *testing.T) {
	raw := "Subject: alt\r\nContent-Type: multipart/alternative; boundary=BOUND\r\n\r\n" +
		"--BOUND\r\nContent-Type: text/plain\r\n\r\n   \r\n" +
		"--BOUND\r\nContent-Type: text/html\r\n\r\n<p>只有 HTML</p>\r\n" +
		"--BOUND--\r\n"
	message, err := Parse([]byte(raw))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(message.Text, "只有 HTML") {
		t.Fatalf("should fall back to html: %q", message.Text)
	}
}

func TestAttachmentsAreNamedButNeverDecoded(t *testing.T) {
	raw := "Subject: att\r\nContent-Type: multipart/mixed; boundary=BOUND\r\n\r\n" +
		"--BOUND\r\nContent-Type: text/plain\r\n\r\n正文\r\n" +
		"--BOUND\r\nContent-Type: application/pdf\r\nContent-Disposition: attachment; filename=\"报告.pdf\"\r\n\r\nPDFBYTES\r\n" +
		"--BOUND--\r\n"
	message, err := Parse([]byte(raw))
	if err != nil {
		t.Fatal(err)
	}
	if len(message.Attachments) != 1 || message.Attachments[0] != "报告.pdf" {
		t.Fatalf("attachments: %v", message.Attachments)
	}
	if strings.Contains(message.Text, "PDFBYTES") {
		t.Fatalf("attachment bytes leaked into body: %q", message.Text)
	}
}

func TestHtmlIsConvertedAndScriptsDropped(t *testing.T) {
	raw := "Subject: html\r\nContent-Type: text/html; charset=utf-8\r\n\r\n" +
		"<html><head><style>p{color:red}</style></head><body><p>第一段 &amp; 实体</p>" +
		"<script>alert('x')</script><p><strong>粗体</strong>文字</p></body></html>"
	message, err := Parse([]byte(raw))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(message.Text, "alert") || strings.Contains(message.Text, "color:red") {
		t.Fatalf("script/style leaked: %q", message.Text)
	}
	if !strings.Contains(message.Text, "第一段 & 实体") {
		t.Fatalf("entities not decoded: %q", message.Text)
	}
	if !strings.Contains(message.Text, "粗体") {
		t.Fatalf("text lost: %q", message.Text)
	}
}

func TestNestedTooDeepIsRejected(t *testing.T) {
	// 直接测层数守卫本身：传入的 depth 已超过上限时必须立刻报错，
	// 而不是先被分节读取的错误拦下——那样测到的就不是层数上限。
	header := mail.Header{"Content-Type": []string{"multipart/mixed; boundary=B0"}}
	if _, err := bodyText(header, []byte("--B0--"), MaxDepth+1, &[]string{}); err == nil || !strings.Contains(err.Error(), "嵌套层数过多") {
		t.Fatalf("depth guard not enforced: %v", err)
	}
	// 未超过上限时不应触发层数错误。
	if _, err := bodyText(header, []byte("--B0--"), MaxDepth, &[]string{}); err != nil && strings.Contains(err.Error(), "嵌套层数过多") {
		t.Fatalf("depth guard fired too early: %v", err)
	}
}

func TestCappedRespectsUtf8Boundary(t *testing.T) {
	text := strings.Repeat("中", 10)
	got := capped(text, 7)
	if len(got) > 7 || !strings.HasPrefix(text, got) {
		t.Fatalf("capped broke a rune: %q (%d bytes)", got, len(got))
	}
	if capped("a\x00b", 100) != "ab" {
		t.Fatal("NUL not removed")
	}
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	digits := ""
	for n > 0 {
		digits = string(rune('0'+n%10)) + digits
		n /= 10
	}
	return digits
}

// TestExportMIMEFixture 导出 Go 的解析结论，供 Rust 对拍同一封邮件。
func TestExportMIMEFixture(t *testing.T) {
	source := os.Getenv("KF_MIME_SOURCE")
	target := os.Getenv("KF_GO_MIME_FIXTURE")
	if source == "" || target == "" {
		t.Skip("set KF_MIME_SOURCE and KF_GO_MIME_FIXTURE")
	}
	raw, err := os.ReadFile(source)
	if err != nil {
		t.Fatal(err)
	}
	message, err := Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	lines := []string{
		"subject=" + message.Subject,
		"message_id=" + message.MessageID,
		"text=" + message.Text,
	}
	if err := os.WriteFile(target, []byte(strings.Join(lines, "\n")), 0644); err != nil {
		t.Fatal(err)
	}
}

func TestGbkBodyIsDecoded(t *testing.T) {
	// 「中文」的 GBK 编码是 D6 D0 CE C4。只按 UTF-8 读会得到乱码。
	body := []byte{0xD6, 0xD0, 0xCE, 0xC4}
	raw := append([]byte("Subject: gbk\r\nContent-Type: text/plain; charset=gbk\r\n\r\n"), body...)
	message, err := Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	if message.Text != "中文" {
		t.Fatalf("gbk body not decoded: %q", message.Text)
	}
}

func TestUnknownCharsetFallsBackToUtf8(t *testing.T) {
	raw := []byte("Subject: x\r\nContent-Type: text/plain; charset=x-unknown\r\n\r\n原样文本")
	message, err := Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	if message.Text != "原样文本" {
		t.Fatalf("unknown charset should pass through: %q", message.Text)
	}
}
