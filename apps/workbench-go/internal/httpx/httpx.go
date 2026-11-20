// Package httpx 迁自 Rust 的 http.rs：剪藏抓取、聊天补全、向量、WebDAV。
//
// 三条安全口径原样保留：
// - 只接受 https；http 仅限本机回环（本地模型服务）。
// - URL 里不能带账号密码。
// - 回环请求绕过代理（本地服务走代理只会失败），外部地址跟随系统代理。
package httpx

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"golang.org/x/text/encoding/htmlindex"
	"golang.org/x/text/transform"
)

const (
	// MaxClipBytes 是剪藏响应的大小上限，与 Rust 的 4 MiB 一致。
	MaxClipBytes = 4 * 1024 * 1024
	userAgent    = "KnowFlick/0.1"
)

// ClipPage 是一次剪藏抓取的结果。
type ClipPage struct {
	Text     string `json:"text"`
	FinalURL string `json:"finalUrl"`
}

// ValidateURL 只放行 https 与本机回环的 http，且拒绝带凭据的地址。
func ValidateURL(raw string) (*url.URL, error) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Host == "" {
		return nil, errors.New("链接无效")
	}
	if parsed.User != nil {
		return nil, errors.New("链接里不能带账号密码")
	}
	switch parsed.Scheme {
	case "https":
		return parsed, nil
	case "http":
		if isLoopbackHost(parsed.Hostname()) {
			return parsed, nil
		}
		return nil, errors.New("只有本机地址可以用 HTTP")
	default:
		return nil, errors.New("只接受 http 或 https 链接")
	}
}

// IsLoopbackHost 判断主机是否为本机回环（含 localhost、127.0.0.1、::1 与展开写法）。
func IsLoopbackHost(host string) bool { return isLoopbackHost(host) }

func isLoopbackHost(host string) bool {
	host = strings.TrimSuffix(strings.TrimPrefix(host, "["), "]")
	if host == "localhost" || host == "127.0.0.1" {
		return true
	}
	if ip := net.ParseIP(host); ip != nil {
		return ip.IsLoopback()
	}
	return false
}

// NewClient 按目标地址选客户端：回环直连，其余跟随系统代理。
func NewClient(target *url.URL, timeout time.Duration) *http.Client {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	if isLoopbackHost(target.Hostname()) {
		transport.Proxy = nil
	}
	return &http.Client{Timeout: timeout, Transport: transport}
}

// FetchClip 抓取一个网页并返回正文与最终地址；跟随最多 5 次跳转并重新校验最终地址。
func FetchClip(ctx context.Context, raw string) (ClipPage, error) {
	target, err := ValidateURL(raw)
	if err != nil {
		return ClipPage{}, err
	}
	client := NewClient(target, 15*time.Second)
	client.CheckRedirect = func(req *http.Request, via []*http.Request) error {
		if len(via) >= 5 {
			return errors.New("跳转次数过多")
		}
		if _, err := ValidateURL(req.URL.String()); err != nil {
			return err
		}
		return nil
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target.String(), nil)
	if err != nil {
		return ClipPage{}, err
	}
	req.Header.Set("User-Agent", userAgent)
	resp, err := client.Do(req)
	if err != nil {
		return ClipPage{}, fmt.Errorf("抓取失败: %w", err)
	}
	defer resp.Body.Close()
	final, err := ValidateURL(resp.Request.URL.String())
	if err != nil {
		return ClipPage{}, err
	}
	body, err := readCapped(resp.Body, MaxClipBytes)
	if err != nil {
		return ClipPage{}, err
	}
	return ClipPage{Text: decodeBody(body, resp.Header.Get("Content-Type")), FinalURL: final.String()}, nil
}

func readCapped(r io.Reader, max int) ([]byte, error) {
	limited := io.LimitReader(r, int64(max)+1)
	body, err := io.ReadAll(limited)
	if err != nil {
		return nil, err
	}
	if len(body) > max {
		return nil, errors.New("响应超过大小上限")
	}
	return body, nil
}

// ChatComplete 调用 OpenAI 兼容的 chat 接口，返回助手文本。
func ChatComplete(ctx context.Context, endpoint, apiKey, body string) (string, error) {
	target, err := ValidateURL(endpoint)
	if err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, target.String(), strings.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "KnowFlick/0.1")
	for name, value := range chatAuthHeaders(endpoint, apiKey) {
		req.Header.Set(name, value)
	}
	resp, err := NewClient(target, 120*time.Second).Do(req)
	if err != nil {
		return "", fmt.Errorf("请求失败: %w", err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, MaxClipBytes))
	if err != nil {
		return "", err
	}
	if resp.StatusCode >= 400 {
		text := RedactSecrets(string(raw))
		if len(text) > 200 {
			text = text[:200]
		}
		return "", fmt.Errorf("API 返回 %d：%s", resp.StatusCode, text)
	}
	var payload struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
		Content []struct {
			Text string `json:"text"`
		} `json:"content"`
	}
	if json.Unmarshal(raw, &payload) == nil {
		if len(payload.Choices) > 0 && payload.Choices[0].Message.Content != "" {
			return payload.Choices[0].Message.Content, nil
		}
		if len(payload.Content) > 0 && payload.Content[0].Text != "" {
			return payload.Content[0].Text, nil
		}
	}
	return string(raw), nil
}
// chatAuthHeaders 按服务商给鉴权头：Anthropic 用 x-api-key，其余 OpenAI 兼容服务用 Bearer。
func chatAuthHeaders(endpoint, apiKey string) map[string]string {
	if strings.Contains(endpoint, "anthropic.com") {
		return map[string]string{"x-api-key": apiKey, "anthropic-version": "2023-06-01"}
	}
	if apiKey == "" {
		return nil
	}
	return map[string]string{"Authorization": "Bearer " + apiKey}
}

// RedactSecrets 抹掉错误文本里可能出现的凭据（与前端 redactSecrets 同一套口径）：
// 界面上的密钥一旦被截图或分享就泄露了。
func RedactSecrets(text string) string {
	words := strings.Fields(text)
	for i, word := range words {
		if looksSecret(word) {
			words[i] = "[已隐藏]"
		}
	}
	return strings.Join(words, " ")
}

// looksSecret 用长度与字符集判断：长串且以常见密钥前缀开头，或长度 >= 32 的高熵串。
func looksSecret(word string) bool {
	trimmed := strings.Trim(word, "\"',.;()[]{}")
	if trimmed == "" {
		return false
	}
	for _, prefix := range []string{"sk-", "sk_", "Bearer", "ghp_", "gho_", "xoxb-", "AKIA"} {
		if strings.HasPrefix(trimmed, prefix) && len(trimmed) > len(prefix)+8 {
			return true
		}
	}
	if len(trimmed) < 32 {
		return false
	}
	digits, upper, lower := 0, 0, 0
	for _, r := range trimmed {
		switch {
		case r >= '0' && r <= '9':
			digits++
		case r >= 'A' && r <= 'Z':
			upper++
		case r >= 'a' && r <= 'z':
			lower++
		}
	}
	return digits > 0 && (upper > 0 || lower > 0)
}

// WebDAVPut 把字节写到目标 URL，返回 (状态码, 响应体)。
// 鉴权走 Basic；地址校验与客户端选择与其它请求同一判据。
func WebDAVPut(ctx context.Context, raw, username, password string, body []byte, contentType string) (int, []byte, error) {
	target, err := ValidateURL(raw)
	if err != nil {
		return 0, nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, target.String(), strings.NewReader(string(body)))
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("Content-Type", contentType)
	if username != "" {
		req.SetBasicAuth(username, password)
	}
	client := NewClient(target, 120*time.Second)
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	resp, err := client.Do(req)
	if err != nil {
		return 0, nil, fmt.Errorf("WebDAV 上传失败: %w", err)
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, MaxClipBytes))
	return resp.StatusCode, respBody, nil
}

// decodeBody 按 Content-Type 的 charset 解码；缺省按 UTF-8。
// 与 Rust 用 encoding_rs 覆盖 GBK/GB18030 等中文站点编码对齐——
// 中文站点大量仍用 GBK，只按 UTF-8 读会得到乱码正文。
func decodeBody(body []byte, contentType string) string {
	charset := charsetFromHeader(contentType)
	if charset == "" {
		charset = charsetFromMeta(body)
	}
	if charset == "" || strings.EqualFold(charset, "utf-8") || strings.EqualFold(charset, "utf8") {
		return string(body)
	}
	enc, err := htmlindex.Get(charset)
	if err != nil {
		return string(body)
	}
	decoded, _, decodeErr := transform.String(enc.NewDecoder(), string(body))
	if decodeErr != nil {
		return string(body)
	}
	return decoded
}

// charsetFromHeader 从 Content-Type 里取 charset=…。
func charsetFromHeader(contentType string) string {
	for _, part := range strings.Split(contentType, ";") {
		part = strings.TrimSpace(part)
		if strings.HasPrefix(strings.ToLower(part), "charset=") {
			return strings.Trim(strings.TrimSpace(part[len("charset="):]), "\"'")
		}
	}
	return ""
}

// charsetFromMeta 从 HTML 前 2 KiB 里的 meta 标签取 charset。
func charsetFromMeta(body []byte) string {
	head := body
	if len(head) > 2048 {
		head = head[:2048]
	}
	lower := strings.ToLower(string(head))
	for _, marker := range []string{"charset=\"", "charset='", "charset="} {
		if i := strings.Index(lower, marker); i >= 0 {
			rest := lower[i+len(marker):]
			end := strings.IndexAny(rest, "\"'> \t\r\n;")
			if end < 0 {
				end = len(rest)
			}
			return rest[:end]
		}
	}
	return ""
}

// RequestEmbeddings 调用 OpenAI 兼容的 embeddings 接口，返回按序排列的向量。
// 错误文本与 ChatComplete 同一口径：先抹掉可能混进来的凭据，再截断。
func RequestEmbeddings(ctx context.Context, endpoint, apiKey, model string, input []string) ([][]float32, error) {
	target, err := ValidateURL(endpoint)
	if err != nil {
		return nil, err
	}
	body, err := json.Marshal(map[string]any{"model": model, "input": input})
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, target.String(), strings.NewReader(string(body)))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "KnowFlick/0.1")
	if apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+apiKey)
	}
	resp, err := NewClient(target, 60*time.Second).Do(req)
	if err != nil {
		return nil, fmt.Errorf("Embedding 请求失败: %w", err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 10*1024*1024))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		snippet := []rune(RedactSecrets(string(raw)))
		if len(snippet) > 200 {
			snippet = snippet[:200]
		}
		return nil, fmt.Errorf("Embedding API 返回 %d: %s", resp.StatusCode, string(snippet))
	}
	var parsed struct {
		Data []struct {
			Embedding []float32 `json:"embedding"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return nil, fmt.Errorf("解析 Embedding 响应 JSON 失败: %w", err)
	}
	if parsed.Data == nil {
		return nil, errors.New("Embedding 响应缺少 data 数组")
	}
	vectors := make([][]float32, 0, len(parsed.Data))
	for _, item := range parsed.Data {
		vectors = append(vectors, item.Embedding)
	}
	return vectors, nil
}