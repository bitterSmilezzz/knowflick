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
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"io"
	"net"
	"sort"
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
	// storedValidity 是 LoginAndExamine 拿到的 UIDVALIDITY。
	// 同步编排要用它判断「库里的游标还能不能用」——这是唯一依据。
	storedValidity uint32
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
	validity, exists, parseErr := parseExamine(response.Lines)
	if parseErr != nil {
		return 0, 0, parseErr
	}
	s.storedValidity = validity
	return validity, exists, nil
}

// UIDValidity 实现 mailsync 读取 UIDVALIDITY 所需的接口。
func (s *Session) UIDValidity() uint32 { return s.storedValidity }

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

// Connect 建立 TCP + 校验过的 TLS 连接（TLS 1.2 起、系统根、主机名校验）。
//
// DNS 解析放进带超时的 goroutine：系统解析器可能卡很久，而调用方有会话预算。
// 多个地址逐个尝试，每个都用剩余预算——第一个地址黑洞时不至于整轮耗尽。
func Connect(host string, port uint16) (Transport, error) {
	return ConnectWithRoots(host, port, nil)
}

// ConnectWithRoots 与 Connect 相同，但可以额外信任一组根证书。
//
// 只为测试而存在：生产代码不传 roots，走的仍是系统根 + 主机名校验。
// 这样测试可以起一个自签名的本地服务器，而生产代码没有任何「跳过校验」的开关。
func ConnectWithRoots(host string, port uint16, roots *x509.CertPool) (Transport, error) {
	dnsResult := make(chan []string, 1)
	go func() {
		addresses, err := net.LookupHost(host)
		if err != nil {
			dnsResult <- nil
			return
		}
		if len(addresses) > 8 {
			addresses = addresses[:8]
		}
		dnsResult <- addresses
	}()
	var addresses []string
	select {
	case addresses = <-dnsResult:
	case <-time.After(IOTimeout):
		return nil, errors.New("邮件服务器地址解析超时")
	}
	if len(addresses) == 0 {
		return nil, errors.New("无法解析邮件服务器地址")
	}
	started := time.Now()
	var conn net.Conn
	for _, address := range addresses {
		remaining := IOTimeout - time.Since(started)
		if remaining <= 0 {
			break
		}
		dialer := net.Dialer{Timeout: remaining}
		candidate, err := dialer.Dial("tcp", net.JoinHostPort(address, strconv.Itoa(int(port))))
		if err == nil {
			conn = candidate
			break
		}
	}
	if conn == nil {
		return nil, errors.New("无法连接邮件服务器")
	}
	if err := conn.SetDeadline(time.Now().Add(IOTimeout)); err != nil {
		conn.Close()
		return nil, errors.New("无法设置邮件连接超时")
	}
	config := &tls.Config{
		ServerName: host,
		MinVersion: tls.VersionTLS12,
	}
	if roots != nil {
		config.RootCAs = roots
	}
	tlsConn := tls.Client(conn, config)
	if err := tlsConn.Handshake(); err != nil {
		conn.Close()
		return nil, errors.New("邮件 TLS 握手或证书校验失败")
	}
	return tlsConn, nil
}

// SearchRange 返回 after 之后最多 limit 个 UID，**始终升序**。
//
// newestFirst 保留最新的 N 封（首同步用「最近 N 封」）。即使如此列表仍升序：
// 调用方按行推进游标，降序会让游标倒退，失败时较新的 UID 会漏重试。
func (s *Session) SearchRange(after uint32, through *uint32, limit int, newestFirst bool, now func() time.Time) ([]uint32, error) {
	if after == ^uint32(0) {
		return []uint32{}, nil
	}
	if through != nil && *through <= after {
		return []uint32{}, nil
	}
	end := "*"
	if through != nil {
		end = strconv.FormatUint(uint64(*through), 10)
	}
	response, err := s.Command(fmt.Sprintf("UID SEARCH UID %d:%s", after+1, end), false, now)
	if err != nil {
		return nil, err
	}
	found := false
	seen := map[uint32]struct{}{}
	for _, line := range response.Lines {
		if !strings.HasPrefix(strings.ToUpper(line), "* SEARCH") {
			continue
		}
		found = true
		fields := strings.Fields(line)
		if len(fields) <= 2 {
			continue
		}
		for _, token := range fields[2:] {
			value, convErr := strconv.ParseUint(token, 10, 32)
			if convErr != nil {
				return nil, errors.New("邮件编号无效")
			}
			uid := uint32(value)
			// 形如 100:* 的区间在 100 超过邮箱末号时也会返回末号；那个 UID 并不更新。
			if uid <= after || (through != nil && uid > *through) {
				continue
			}
			seen[uid] = struct{}{}
		}
	}
	if !found {
		return nil, errors.New("邮件服务器的搜索响应里没有结果字段")
	}
	uids := make([]uint32, 0, len(seen))
	for uid := range seen {
		uids = append(uids, uid)
	}
	sort.Slice(uids, func(i, j int) bool { return uids[i] < uids[j] })
	if len(uids) > limit {
		if newestFirst {
			uids = uids[len(uids)-limit:]
		} else {
			uids = uids[:limit]
		}
	}
	return uids, nil
}

// Fetch 用 BODY.PEEK[] 取一封邮件，服务器端保持未读。
// 先查大小：超过上限返回 nil（这封不能导入），而不是让整轮同步失败。
func (s *Session) Fetch(uid uint32, now func() time.Time) ([]byte, bool, error) {
	response, err := s.Command(fmt.Sprintf("UID FETCH %d (UID RFC822.SIZE)", uid), false, now)
	if err != nil {
		return nil, false, err
	}
	var size uint64
	var haveSize bool
	for _, line := range response.Lines {
		upper := strings.NewReplacer("(", " ", ")", " ").Replace(strings.ToUpper(line))
		tokens := strings.Fields(upper)
		if tokenNumber(tokens, "UID") == uint64(uid) {
			if value, ok := tokenNumberOK(tokens, "RFC822.SIZE"); ok {
				size, haveSize = value, true
			}
		}
	}
	if !haveSize {
		return nil, false, errors.New("邮件服务器没有返回邮件大小或编号")
	}
	if size > MaxMessage {
		return nil, false, nil
	}
	// 请求 BODY.PEEK[] 让服务器保持未读，但响应里要接受 BODY[]：
	// RFC 3501 回显的是**被请求的段**，PEEK 只是请求修饰符，服务器不回显它。
	// 早期要求响应里必须有 BODY.PEEK[]，结果真实导入全部失败。
	response, err = s.Command(fmt.Sprintf("UID FETCH %d (UID BODY.PEEK[])", uid), true, now)
	if err != nil {
		return nil, false, err
	}
	if len(response.Literals) == 0 {
		return nil, false, errors.New("邮件服务器没有返回邮件正文")
	}
	header, _ := response.Literals[0][0].(string)
	body, _ := response.Literals[0][1].([]byte)
	if !strings.Contains(strings.ToUpper(header), "BODY[") {
		return nil, false, errors.New("邮件服务器返回了预期之外的内容段")
	}
	joined := strings.NewReplacer("(", " ", ")", " ").Replace(strings.ToUpper(strings.Join(response.Lines, " ")))
	if tokenNumber(strings.Fields(joined), "UID") != uint64(uid) {
		return nil, false, errors.New("邮件服务器返回了预期之外的邮件编号")
	}
	return body, true, nil
}

// tokenNumber 在形如 `1 FETCH (UID 42 RFC822.SIZE 100)` 的 token 流里取某个键的数字。
func tokenNumber(tokens []string, key string) uint64 {
	value, _ := tokenNumberOK(tokens, key)
	return value
}

func tokenNumberOK(tokens []string, key string) (uint64, bool) {
	for i := 0; i+1 < len(tokens); i++ {
		if tokens[i] == key {
			if value, err := strconv.ParseUint(tokens[i+1], 10, 64); err == nil {
				return value, true
			}
		}
	}
	return 0, false
}
