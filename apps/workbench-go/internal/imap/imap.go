// Package imap 迁自 Rust 的 Imap 会话层：**只读**的 IMAP 协议客户端。
//
// 契约（与 mail.rs 一致，改这里先改契约）：
//   - 只发 LOGIN、EXAMINE、UID SEARCH、UID FETCH BODY.PEEK[]。
//     没有 STORE / DELETE / EXPUNGE / COPY / APPEND——导入邮件绝不标记已读、绝不改动服务器邮箱。
//   - TLS 始终校验（系统根 + 主机名），生产代码没有明文开关。
//   - 三层上限：单行 8 MiB、单次响应 16 MiB、行数 100000；单封 2 MiB。
//   - 服务端原文**不回传调用方**：认证失败的原文里可能带着刚提交的密码。
package imap

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"strconv"
	"strings"
	"time"
)

const (
	// MaxMessage 是单封邮件正文上限（与 Rust 的 MAX_MESSAGE 一致）。
	MaxMessage = 2 * 1024 * 1024
	// MaxLine 是单行上限；UID SEARCH 回复可能很长，但仍需硬上限。
	MaxLine = 8 * 1024 * 1024
	// MaxResponse 是单次命令的响应总字节上限。
	MaxResponse = 16 * 1024 * 1024
	// MaxLines 是单次命令的行数上限。
	MaxLines = 100_000
	// IOTimeout 是 socket 读写超时。
	IOTimeout = 15 * time.Second
	// SessionTimeout 是整次会话的预算。
	SessionTimeout = 120 * time.Second
)

// ErrUnsupportedCommand 是「有人试图发写命令」时的拒绝。
var ErrUnsupportedCommand = errors.New("只读邮箱导入不接受写命令")

// Transport 抽象连接，测试可用内存管道替代真实 TLS。
type Transport interface {
	io.Reader
	io.Writer
}

// Response 是一次命令的响应：未标记行与字面量。
type Response struct {
	Lines    []string
	Literals [][2]any // [行, []byte]
}

// Session 是一次 IMAP 会话。
type Session struct {
	io       *bufio.Reader
	raw      Transport
	tag      int
	deadline time.Time
}

// writeOnly 是只允许的四类命令前缀。
var writeOnlyPrefixes = []string{"STORE ", "DELETE ", "EXPUNGE", "COPY ", "APPEND", "MOVE ", "CREATE ", "RENAME ", "SUBSCRIBE", "UNSUBSCRIBE"}

// EnsureReadOnly 拒绝任何写命令；命令名比较忽略大小写。
func EnsureReadOnly(command string) error {
	upper := strings.ToUpper(strings.TrimSpace(command))
	for _, prefix := range writeOnlyPrefixes {
		if strings.HasPrefix(upper, prefix) {
			return ErrUnsupportedCommand
		}
	}
	return nil
}

// Quote 给 IMAP 字符串加引号（转义反斜杠与双引号）。
func Quote(value string) string {
	replacer := strings.NewReplacer("\\", "\\\\", "\"", "\\\"")
	return "\"" + replacer.Replace(value) + "\""
}

// MailboxName 把文件夹名编码成 IMAP modified UTF-7（RFC 3501 5.1.3）。
// 中文文件夹名必须走这条，否则服务器认不出。
func MailboxName(name string) string {
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+,"
	var out strings.Builder
	var pending []byte
	flush := func() {
		if len(pending) == 0 {
			return
		}
		out.WriteByte('&')
		acc, bits := uint32(0), uint32(0)
		for _, b := range pending {
			acc = (acc << 8) | uint32(b)
			bits += 8
			for bits >= 6 {
				bits -= 6
				out.WriteByte(alphabet[(acc>>bits)&63])
				acc &= (1 << bits) - 1
			}
		}
		if bits > 0 {
			out.WriteByte(alphabet[(acc<<(6-bits))&63])
		}
		out.WriteByte('-')
		pending = pending[:0]
	}
	for _, r := range name {
		if r >= ' ' && r <= '~' {
			flush()
			if r == '&' {
				out.WriteString("&-")
			} else {
				out.WriteRune(r)
			}
			continue
		}
		// UTF-16BE 字节流：astral 平面字符要拆成代理对。
		if r > 0xFFFF {
			r -= 0x10000
			hi, lo := uint16(0xD800+(r>>10)), uint16(0xDC00+(r&0x3FF))
			pending = append(pending, byte(hi>>8), byte(hi), byte(lo>>8), byte(lo))
			continue
		}
		pending = append(pending, byte(uint16(r)>>8), byte(uint16(r)))
	}
	flush()
	return out.String()
}

// New 用已有连接建会话，并校验服务器问候是 `* OK`。
func New(transport Transport, now func() time.Time) (*Session, error) {
	session := &Session{io: bufio.NewReader(transport), raw: transport, deadline: now().Add(SessionTimeout)}
	greeting, err := session.line(now)
	if err != nil {
		return nil, err
	}
	if !strings.HasPrefix(strings.ToUpper(greeting), "* OK") {
		return nil, errors.New("邮件服务器拒绝了连接：请检查服务器地址、端口与网络")
	}
	return session, nil
}

func (s *Session) checkDeadline(now func() time.Time) error {
	if !now().Before(s.deadline) {
		return errors.New("这次连接用的时间太长了，已断开；可以调大同步间隔再试")
	}
	return nil
}

// line 读一行 CRLF，受 MaxLine 与截止时间约束。
func (s *Session) line(now func() time.Time) (string, error) {
	var out []byte
	for {
		if err := s.checkDeadline(now); err != nil {
			return "", err
		}
		chunk, err := s.io.ReadBytes('\n')
		if len(out)+len(chunk) > MaxLine {
			return "", errors.New("邮件服务器返回的单行太长，已放弃（内容异常）")
		}
		out = append(out, chunk...)
		if err != nil {
			if errors.Is(err, io.EOF) && len(out) > 0 {
				break
			}
			return "", errors.New("邮件服务器中途断开了连接，请重试")
		}
		if len(chunk) > 0 && chunk[len(chunk)-1] == '\n' {
			break
		}
	}
	return string(out), nil
}

// Command 发一条命令并收集未标记响应与标记完成。
// 服务端原文不回传：认证失败原文可能含刚提交的密码。
func (s *Session) Command(command string, allowLiteral bool, now func() time.Time) (Response, error) {
	if err := EnsureReadOnly(command); err != nil {
		return Response{}, err
	}
	if err := s.checkDeadline(now); err != nil {
		return Response{}, err
	}
	s.tag++
	tag := fmt.Sprintf("K%04d", s.tag)
	if _, err := io.WriteString(s.raw, tag+" "+command+"\r\n"); err != nil {
		return Response{}, errors.New("无法发送邮件命令")
	}
	response := Response{Lines: make([]string, 0, 8)}
	total := 0
	for i := 0; i < MaxLines; i++ {
		line, err := s.line(now)
		if err != nil {
			return Response{}, err
		}
		total += len(line)
		if total > MaxResponse {
			return Response{}, errors.New("邮件服务器返回的内容太长，已放弃（内容异常）")
		}
		if strings.HasPrefix(line, tag+" ") {
			status := strings.TrimSpace(line[len(tag)+1:])
			if word, _, _ := strings.Cut(status, " "); strings.EqualFold(word, "OK") {
				return response, nil
			}
			return Response{}, errors.New("邮件服务器拒绝了这次请求：请检查账号密码与文件夹名（如 INBOX）")
		}
		if strings.HasPrefix(strings.ToUpper(line), "* BYE") {
			return Response{}, errors.New("邮件服务器关闭了会话，请重试")
		}
		trimmed := strings.TrimRight(line, "\r\n")
		if strings.HasSuffix(trimmed, "}") {
			if start := strings.LastIndex(trimmed, "{"); start >= 0 {
				length, convErr := strconv.Atoi(trimmed[start+1 : len(trimmed)-1])
				if convErr != nil {
					return Response{}, errors.New("邮件字面量长度无效")
				}
				if !allowLiteral || length > MaxMessage || total+length > MaxResponse || len(response.Literals) > 0 {
					return Response{}, errors.New("这封邮件（或它的附件）太大，已跳过")
				}
				body := make([]byte, length)
				for offset := 0; offset < length; offset += 8192 {
					if err := s.checkDeadline(now); err != nil {
						return Response{}, err
					}
					end := offset + 8192
					if end > length {
						end = length
					}
					if _, err := io.ReadFull(s.io, body[offset:end]); err != nil {
						return Response{}, errors.New("邮件服务器中途断开了连接，请重试")
					}
				}
				total += length
				response.Literals = append(response.Literals, [2]any{line, body})
			}
		}
		response.Lines = append(response.Lines, line)
	}
	return Response{}, errors.New("邮件服务器返回的行数过多，已放弃（内容异常）")
}

// LoginAndExamine 登录并**只读**打开文件夹，返回 (UIDVALIDITY, 邮件数)。
func (s *Session) LoginAndExamine(username, password, folder string, now func() time.Time) (uint32, uint32, error) {
	if _, err := s.Command("LOGIN "+Quote(username)+" "+Quote(password), false, now); err != nil {
		return 0, 0, err
	}
	response, err := s.Command("EXAMINE "+Quote(MailboxName(folder)), false, now)
	if err != nil {
		return 0, 0, err
	}
	return parseExamine(response.Lines)
}

// parseExamine 从 EXAMINE 响应里取 UIDVALIDITY 与 EXISTS。
func parseExamine(lines []string) (uint32, uint32, error) {
	var validity, exists uint32
	for _, line := range lines {
		upper := strings.ToUpper(line)
		if strings.Contains(upper, "UIDVALIDITY") {
			if value, ok := lastNumber(line); ok {
				validity = uint32(value)
			}
		}
		if strings.Contains(upper, "EXISTS") {
			if value, ok := lastNumber(line); ok {
				exists = uint32(value)
			}
		}
	}
	if validity == 0 {
		return 0, 0, errors.New("邮件服务器没有返回 UIDVALIDITY，无法安全同步")
	}
	return validity, exists, nil
}

func lastNumber(line string) (int, bool) {
	fields := strings.Fields(line)
	for i := len(fields) - 1; i >= 0; i-- {
		if n, err := strconv.Atoi(strings.Trim(fields[i], "()[]")); err == nil {
			return n, true
		}
	}
	return 0, false
}
