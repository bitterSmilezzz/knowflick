// Package mimex 迁自 Rust mail.rs 的 MIME 处理：把一封原始邮件抽成可读文本。
//
// 口径与 Rust 一致：
// - multipart/alternative 优先 text/plain；纯文本为空才退到其它部分。
// - 附件永不下载或解码，只把文件名当元数据留下（最多 128 个）。
// - HTML 本地转纯文本，绝不抓取或执行远程资源。
// - 嵌套超过 32 层直接报错，不递归到栈溢出。
// - 正文上限 512 KiB，按 UTF-8 边界截断并去掉 NUL。
package mimex

import (
	"bytes"
	"errors"
	"io"
	"mime"
	"mime/multipart"
	"net/mail"
	"net/textproto"
	"strings"
	"unicode/utf8"

	"golang.org/x/text/encoding/htmlindex"
	"golang.org/x/text/transform"
)

const (
	// MaxText 是保留的正文上限（与 Rust 的 MAX_TEXT 一致）。
	MaxText = 512 * 1024
	// MaxAttachmentNames 是保留的附件名个数上限。
	MaxAttachmentNames = 128
	// MaxDepth 是 MIME 嵌套层数上限。
	MaxDepth = 32
	// MaxHeaderValue 是单个头值上限。
	MaxHeaderValue = 4096
)

// Message 是一封解析后的邮件：正文文本、附件名与常用头。
type Message struct {
	Subject     string   `json:"subject"`
	From        string   `json:"from"`
	To          string   `json:"to"`
	Date        string   `json:"date"`
	MessageID   string   `json:"messageId"`
	Text        string   `json:"text"`
	Truncated   bool     `json:"truncated"`
	Attachments []string `json:"attachments"`
}

// capped 按 UTF-8 边界截断到 max 字节，并去掉 NUL。
func capped(text string, max int) string {
	if len(text) <= max {
		return strings.ReplaceAll(text, "\x00", "")
	}
	end := max
	for end > 0 && !utf8.RuneStart(text[end]) {
		end--
	}
	return strings.ReplaceAll(text[:end], "\x00", "")
}

// Parse 解析原始邮件字节。
func Parse(raw []byte) (Message, error) {
	parsed, err := mail.ReadMessage(bytes.NewReader(raw))
	if err != nil {
		return Message{}, errors.New("无法解析这封邮件（头部格式异常）")
	}
	message := Message{
		Subject:   decodeHeader(parsed.Header.Get("Subject")),
		From:      decodeHeader(parsed.Header.Get("From")),
		To:        decodeHeader(parsed.Header.Get("To")),
		Date:      capped(parsed.Header.Get("Date"), MaxHeaderValue),
		MessageID: capped(parsed.Header.Get("Message-Id"), MaxHeaderValue),
	}
	body, err := io.ReadAll(io.LimitReader(parsed.Body, MaxText*4))
	if err != nil {
		return Message{}, errors.New("无法读取邮件正文")
	}
	attachments := make([]string, 0)
	text, err := bodyText(parsed.Header, body, 0, &attachments)
	if err != nil {
		return Message{}, err
	}
	message.Text = text
	message.Truncated = len(text) >= MaxText
	message.Attachments = attachments
	return message, nil
}

// bodyText 抽取可读正文。multipart/alternative 优先 text/plain；附件只留文件名。
func bodyText(header mail.Header, body []byte, depth int, attachments *[]string) (string, error) {
	if depth > MaxDepth {
		return "", errors.New("这封邮件的 MIME 嵌套层数过多，已跳过")
	}
	contentType := header.Get("Content-Type")
	mediaType, params, err := mime.ParseMediaType(contentType)
	if err != nil || mediaType == "" {
		mediaType = "text/plain"
	}
	mediaType = strings.ToLower(mediaType)

	disposition, dispParams, dispErr := mime.ParseMediaType(header.Get("Content-Disposition"))
	filename := ""
	if dispErr == nil {
		filename = dispParams["filename"]
	}
	if filename == "" {
		filename = params["name"]
	}
	if filename != "" && len(*attachments) < MaxAttachmentNames {
		*attachments = append(*attachments, capped(filename, 512))
	}
	if strings.EqualFold(disposition, "attachment") || filename != "" {
		return "", nil
	}

	if strings.HasPrefix(mediaType, "multipart/") {
		boundary := params["boundary"]
		if boundary == "" {
			return "", nil
		}
		reader := multipart.NewReader(bytes.NewReader(body), boundary)
		type part struct {
			mimeType string
			text     string
		}
		parts := make([]part, 0, 2)
		for {
			next, nextErr := reader.NextPart()
			if errors.Is(nextErr, io.EOF) {
				break
			}
			if nextErr != nil {
				return "", errors.New("无法解析这封邮件的分节结构")
			}
			// mail.Header 是 map 别名，没有 Add；用 textproto.MIMEHeader 承接后再转。
			raw := textproto.MIMEHeader{}
			for key, values := range next.Header {
				for _, value := range values {
					raw.Add(key, value)
				}
			}
			partHeader := mail.Header(raw)
			partBody, readErr := io.ReadAll(io.LimitReader(next, MaxText*4))
			if readErr != nil {
				return "", errors.New("无法读取邮件的分节内容")
			}
			text, partErr := bodyText(partHeader, partBody, depth+1, attachments)
			if partErr != nil {
				return "", partErr
			}
			partType, _, _ := mime.ParseMediaType(next.Header.Get("Content-Type"))
			parts = append(parts, part{mimeType: strings.ToLower(partType), text: text})
		}
		if mediaType == "multipart/alternative" {
			for _, candidate := range parts {
				if candidate.mimeType == "text/plain" && strings.TrimSpace(candidate.text) != "" {
					return candidate.text, nil
				}
			}
			for _, candidate := range parts {
				if strings.TrimSpace(candidate.text) != "" {
					return candidate.text, nil
				}
			}
			return "", nil
		}
		joined := make([]string, 0, len(parts))
		for _, candidate := range parts {
			if strings.TrimSpace(candidate.text) != "" {
				joined = append(joined, candidate.text)
			}
		}
		return capped(strings.Join(joined, "\n\n"), MaxText), nil
	}

	if mediaType != "text/plain" && mediaType != "text/html" {
		return "", nil
	}
	decoded := decodeCharset(body, params["charset"])
	decoded = capped(decoded, MaxText)
	if mediaType == "text/html" {
		return capped(stripMarkdownEmphasis(htmlToText(decoded)), MaxText), nil
	}
	return decoded, nil
}

// decodeCharset 按 charset 参数解码；未知或缺失时按 UTF-8 处理。
// 中文邮件常用 GBK/GB2312，只按 UTF-8 读会得到乱码正文。
func decodeCharset(body []byte, charset string) string {
	if charset == "" || strings.EqualFold(charset, "utf-8") || strings.EqualFold(charset, "utf8") {
		return string(body)
	}
	encoding, err := htmlindex.Get(charset)
	if err != nil {
		return string(body)
	}
	decoded, _, decodeErr := transform.String(encoding.NewDecoder(), string(body))
	if decodeErr != nil {
		return string(body)
	}
	return decoded
}

// htmlToText 把 HTML 转成纯文本：去标签、解实体、保留段落换行。
func htmlToText(html string) string {
	var out strings.Builder
	depth := 0
	skipUntil := ""
	for i := 0; i < len(html); {
		if html[i] == '<' {
			end := strings.IndexByte(html[i:], '>')
			if end < 0 {
				break
			}
			tag := strings.ToLower(strings.TrimSpace(html[i+1 : i+end]))
			i += end + 1
			switch {
			case strings.HasPrefix(tag, "script"), strings.HasPrefix(tag, "style"):
				skipUntil = "/" + strings.Fields(tag)[0]
			case strings.HasPrefix(tag, "/"):
				if skipUntil != "" && strings.HasPrefix(tag, skipUntil) {
					skipUntil = ""
				}
				depth--
			case strings.HasSuffix(tag, "/"):
			case strings.HasPrefix(tag, "br"), strings.HasPrefix(tag, "p"), strings.HasPrefix(tag, "div"), strings.HasPrefix(tag, "li"), strings.HasPrefix(tag, "tr"):
				out.WriteString("\n")
				depth++
			default:
				depth++
			}
			continue
		}
		if skipUntil == "" {
			out.WriteByte(html[i])
		}
		i++
	}
	text := unescapeEntities(out.String())
	lines := strings.Split(text, "\n")
	cleaned := make([]string, 0, len(lines))
	for _, line := range lines {
		cleaned = append(cleaned, strings.TrimSpace(line))
	}
	return strings.TrimSpace(strings.Join(cleaned, "\n"))
}

// unescapeEntities 只处理最常见的五个实体与数字实体。
func unescapeEntities(text string) string {
	replacer := strings.NewReplacer("&nbsp;", " ", "&amp;", "&", "&lt;", "<", "&gt;", ">", "&quot;", "\"", "&#39;", "'")
	return replacer.Replace(text)
}

// stripMarkdownEmphasis 去掉 html2text 那类转换会留下的 ** 强调标记，保留文字。
func stripMarkdownEmphasis(text string) string {
	if !strings.Contains(text, "**") {
		return text
	}
	return strings.ReplaceAll(text, "**", "")
}

// decodeHeader 解码 RFC 2047 编码字（=?utf-8?B?...?=），再按上限截断。
// 不解码的话中文主题会原样显示成编码串——mailparse 默认会解，这里必须对齐。
func decodeHeader(value string) string {
	decoder := &mime.WordDecoder{}
	if decoded, err := decoder.DecodeHeader(value); err == nil {
		return capped(decoded, MaxHeaderValue)
	}
	return capped(value, MaxHeaderValue)
}
