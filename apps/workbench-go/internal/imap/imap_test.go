package imap

import (
	"errors"
	"io"
	"net"
	"os"
	"strings"
	"testing"
	"time"
)

// pipeTransport 把 net.Pipe 包成 Transport，测试里模拟服务器。
type pipeTransport struct {
	net.Conn
}

func nowFixed() time.Time { return time.Unix(0, 0) }

func TestEnsureReadOnlyBlocksEveryWriteCommand(t *testing.T) {
	blocked := []string{"STORE 1 +FLAGS \\Seen", "store 1 +flags", "DELETE 1", "EXPUNGE", "COPY 1 INBOX", "APPEND INBOX {5}", "MOVE 1 Trash", "CREATE X", "RENAME A B", "SUBSCRIBE X", "UNSUBSCRIBE X"}
	for _, command := range blocked {
		if err := EnsureReadOnly(command); !errors.Is(err, ErrUnsupportedCommand) {
			t.Fatalf("write command allowed: %q", command)
		}
	}
	allowed := []string{"LOGIN \"u\" \"p\"", "EXAMINE \"INBOX\"", "UID SEARCH ALL", "UID FETCH 1 BODY.PEEK[]"}
	for _, command := range allowed {
		if err := EnsureReadOnly(command); err != nil {
			t.Fatalf("read command blocked: %q (%v)", command, err)
		}
	}
}

func TestQuoteEscapesBackslashAndQuote(t *testing.T) {
	if got := Quote("a\\b\"c"); got != "\"a\\\\b\\\"c\"" {
		t.Fatalf("quote: %s", got)
	}
}

func TestMailboxNameEncodesChinese(t *testing.T) {
	// 中文必须被编码（不再原样出现），且以 & 开头、- 结尾；
	// 具体 base64 变体值由 RFC 3501 的算法决定，这里断言结构而不是猜常量。
	got := MailboxName("草稿")
	if !strings.HasPrefix(got, "&") || !strings.HasSuffix(got, "-") || strings.Contains(got, "草稿") {
		t.Fatalf("chinese mailbox not encoded: %s", got)
	}
	if got != MailboxName("草稿") {
		t.Fatal("encoding is not deterministic")
	}
	if MailboxName("a草稿b") != "a"+got+"b" {
		t.Fatalf("mixed content not split around the encoded run: %s", MailboxName("a草稿b"))
	}
	if got := MailboxName("INBOX"); got != "INBOX" {
		t.Fatalf("ascii mailbox: %s", got)
	}
	if got := MailboxName("A&B"); got != "A&-B" {
		t.Fatalf("ampersand mailbox: %s", got)
	}
	// 空格与数字是可打印 ASCII，按 RFC 原样保留：编码段结束后直接接原文。
	if got := MailboxName("项目 2026"); !strings.HasPrefix(got, "&") || !strings.HasSuffix(got, "- 2026") {
		t.Fatalf("mixed mailbox: %s", got)
	}
}

// serverFor 起一个内存 IMAP 服务器：先发问候，再按脚本逐条回应。
func serverFor(t *testing.T, greeting string, replies []string) (*Session, func()) {
	t.Helper()
	client, server := net.Pipe()
	done := make(chan struct{})
	go func() {
		defer close(done)
		_, _ = io.WriteString(server, greeting)
		for _, reply := range replies {
			buf := make([]byte, 256)
			if _, err := server.Read(buf); err != nil {
				return
			}
			if _, err := io.WriteString(server, reply); err != nil {
				return
			}
		}
	}()
	session, err := New(pipeTransport{client}, nowFixed)
	if err != nil {
		t.Fatalf("greeting: %v", err)
	}
	return session, func() { _ = server.Close(); <-done }
}

func TestNewRejectsNonOkGreeting(t *testing.T) {
	client, server := net.Pipe()
	defer server.Close()
	go func() {
		_, _ = io.WriteString(server, "* BYE go away\r\n")
	}()
	if _, err := New(pipeTransport{client}, nowFixed); err == nil || !strings.Contains(err.Error(), "拒绝了连接") {
		t.Fatalf("non-OK greeting accepted: %v", err)
	}
}

func TestCommandParsesTaggedOkAndUidValidity(t *testing.T) {
	session, stop := serverFor(t, "* OK ready\r\n", []string{
		"* OK [UIDVALIDITY 42] done\r\nK0001 OK LOGIN completed\r\n",
		"* 7 EXISTS\r\n* OK [UIDVALIDITY 42] done\r\nK0002 OK EXAMINE completed\r\n",
	})
	defer stop()
	validity, exists, err := session.LoginAndExamine("u", "p", "草稿", nowFixed)
	if err != nil {
		t.Fatal(err)
	}
	if validity != 42 || exists != 7 {
		t.Fatalf("validity %d exists %d", validity, exists)
	}
}

func TestCommandFailureDoesNotEchoServerText(t *testing.T) {
	session, stop := serverFor(t, "* OK ready\r\n", []string{
		"K0001 NO [AUTHENTICATIONFAILED] invalid credentials for secret-pass\r\n",
	})
	defer stop()
	_, err := session.Command("LOGIN \"u\" \"secret-pass\"", false, nowFixed)
	if err == nil {
		t.Fatal("expected failure")
	}
	if strings.Contains(err.Error(), "secret-pass") {
		t.Fatalf("server text leaked into the error: %v", err)
	}
}

func TestCommandRejectsOversizedLiteral(t *testing.T) {
	session, stop := serverFor(t, "* OK ready\r\n", []string{
		"* 1 FETCH (BODY[] {999999999}\r\n",
	})
	defer stop()
	_, err := session.Command("UID FETCH 1 BODY.PEEK[]", true, nowFixed)
	if err == nil || !strings.Contains(err.Error(), "太大") {
		t.Fatalf("oversized literal accepted: %v", err)
	}
}

func TestSessionDeadlineStopsLongCommands(t *testing.T) {
	// 用**可推进**的时钟：如果 New 和 Command 都用同一个已过期的固定时刻，
	// deadline 会被算成「过期时刻 + 120 秒」，仍在过去，判据永远不触发（第一版就这样写错了）。
	current := time.Unix(1_000_000, 0)
	clock := func() time.Time { return current }
	client, server := net.Pipe()
	defer server.Close()
	go func() {
		_, _ = io.WriteString(server, greetingLine())
		buf := make([]byte, 256)
		for {
			if _, err := server.Read(buf); err != nil {
				return
			}
		}
	}()
	session, err := New(pipeTransport{client}, clock)
	if err != nil {
		t.Fatal(err)
	}
	// 时间推进到会话预算之后：必须立刻报错，而不是继续发命令。
	current = current.Add(SessionTimeout + time.Second)
	if _, err := session.Command("UID SEARCH ALL", false, clock); err == nil || !strings.Contains(err.Error(), "时间太长") {
		t.Fatalf("expired session accepted: %v", err)
	}
}

func TestParseExamineRequiresUidValidity(t *testing.T) {
	if _, _, err := parseExamine([]string{"* 7 EXISTS\r\n"}); err == nil {
		t.Fatal("missing UIDVALIDITY accepted")
	}
}

// greetingLine 返回 IMAP 问候行（用拼接避免在源码里写转义换行）。
func greetingLine() string { return "* OK ready" + crlf() }

func crlf() string { return string([]byte{13, 10}) }

// TestExportIMAPFixture 导出 Go 的协议层结论，供 Rust 对拍同一组输入。
func TestExportIMAPFixture(t *testing.T) {
	target := os.Getenv("KF_GO_IMAP_FIXTURE")
	if target == "" {
		t.Skip("set KF_GO_IMAP_FIXTURE to export the IMAP protocol fixture")
	}
	lines := []string{
		"quote=" + Quote("a\\b\"c"),
		"mailbox_cjk=" + MailboxName("草稿"),
		"mailbox_ascii=" + MailboxName("INBOX"),
		"mailbox_amp=" + MailboxName("A&B"),
	}
	if err := os.WriteFile(target, []byte(strings.Join(lines, "\n")+"\n"), 0644); err != nil {
		t.Fatal(err)
	}
}
