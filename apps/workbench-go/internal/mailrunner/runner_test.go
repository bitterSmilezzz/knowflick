package mailrunner

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"database/sql"
	"encoding/pem"
	"fmt"
	"math/big"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"knowflick.local/workbench-go/internal/mail"
	"knowflick.local/workbench-go/internal/mailschedule"
	"knowflick.local/workbench-go/internal/mailsync"

	_ "modernc.org/sqlite"
)

const schema = `
CREATE TABLE materials (
  id TEXT PRIMARY KEY, source_type TEXT NOT NULL, title TEXT NOT NULL,
  source_url TEXT, raw_text TEXT NOT NULL, cleaned_markdown TEXT,
  content_hash TEXT NOT NULL, media_path TEXT, media_size_bytes INTEGER NOT NULL DEFAULT 0,
  metadata_json TEXT NOT NULL, inbox_status TEXT NOT NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1, is_deleted INTEGER NOT NULL DEFAULT 0,
  deleted_at INTEGER);
CREATE VIRTUAL TABLE fts_materials USING fts5(material_id UNINDEXED,title,raw_text,source_url);
CREATE TABLE mail_accounts (
  id TEXT PRIMARY KEY, config_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL DEFAULT 0, last_sync_at INTEGER, last_error TEXT,
  uid_validity INTEGER, last_uid INTEGER NOT NULL DEFAULT 0);
CREATE TABLE mail_imports (
  account_id TEXT NOT NULL, folder TEXT NOT NULL, uid_validity INTEGER NOT NULL,
  uid INTEGER NOT NULL, message_id TEXT NOT NULL DEFAULT '', material_id TEXT NOT NULL,
  PRIMARY KEY (account_id, folder, uid_validity, uid));
CREATE TABLE mail_rejected (
  account_id TEXT NOT NULL, folder TEXT NOT NULL, uid_validity INTEGER NOT NULL,
  uid INTEGER NOT NULL, reason TEXT NOT NULL DEFAULT '', rejected_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, folder, uid_validity, uid));
CREATE TABLE mail_sync_state (
  account_id TEXT PRIMARY KEY, history_before INTEGER, history_complete INTEGER NOT NULL DEFAULT 0,
  last_attempt_at INTEGER);
`

func openDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "lib.db"))
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(schema); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("INSERT INTO mail_accounts(id) VALUES('acct-1')"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("INSERT INTO mail_sync_state(account_id) VALUES('acct-1')"); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

// fakeImap 是一个最小 IMAP 服务器：只认 LOGIN/EXAMINE/UID SEARCH/UID FETCH。
type fakeImap struct {
	listener net.Listener
	roots    *x509.CertPool
	validity uint32
	uids     []uint32
	bodies   map[uint32]string
	seen     []string
}

func startFakeImap(t *testing.T, validity uint32, uids []uint32, bodies map[uint32]string) *fakeImap {
	t.Helper()
	cert, roots := selfSignedWithRoots(t)
	listener, err := tls.Listen("tcp", "127.0.0.1:0", &tls.Config{Certificates: []tls.Certificate{cert}})
	if err != nil {
		t.Fatal(err)
	}
	server := &fakeImap{listener: listener, validity: validity, uids: uids, bodies: bodies, roots: roots}
	go server.acceptLoop()
	t.Cleanup(func() { _ = listener.Close() })
	return server
}

func (f *fakeImap) port() uint16 { return uint16(f.listener.Addr().(*net.TCPAddr).Port) }

// acceptLoop 持续接受连接：一轮同步结束后连接会关，下一轮必须能再连上。
// 只接受一次会让第二轮挂在 TLS 握手上直到超时，看起来像「同步失败」。
func (f *fakeImap) acceptLoop() {
	for {
		conn, err := f.listener.Accept()
		if err != nil {
			return
		}
		go f.serve(conn)
	}
}

func (f *fakeImap) serve(conn net.Conn) {
	defer conn.Close()
	fmt.Fprintf(conn, "* OK fake ready\r\n")
	reader := make([]byte, 4096)
	pending := ""
	for {
		n, readErr := conn.Read(reader)
		if n > 0 {
			pending += string(reader[:n])
		}
		for {
			index := strings.Index(pending, "\r\n")
			if index < 0 {
				break
			}
			line := pending[:index]
			pending = pending[index+2:]
			f.seen = append(f.seen, line)
			f.respond(conn, line)
		}
		if readErr != nil {
			return
		}
	}
}

func (f *fakeImap) respond(conn net.Conn, line string) {
	fields := strings.Fields(line)
	if len(fields) < 2 {
		return
	}
	tag := fields[0]
	command := strings.ToUpper(fields[1])
	switch command {
	case "LOGIN":
		fmt.Fprintf(conn, "%s OK LOGIN completed\r\n", tag)
	case "EXAMINE":
		fmt.Fprintf(conn, "* %d EXISTS\r\n* OK [UIDVALIDITY %d] done\r\n%s OK EXAMINE completed\r\n", len(f.uids), f.validity, tag)
	case "UID":
		if len(fields) < 3 {
			fmt.Fprintf(conn, "%s BAD\r\n", tag)
			return
		}
		switch strings.ToUpper(fields[2]) {
		case "SEARCH":
			parts := make([]string, 0, len(f.uids))
			for _, uid := range f.uids {
				parts = append(parts, fmt.Sprint(uid))
			}
			fmt.Fprintf(conn, "* SEARCH %s\r\n%s OK SEARCH completed\r\n", strings.Join(parts, " "), tag)
		case "FETCH":
			uid := uint32(0)
			fmt.Sscanf(fields[3], "%d", &uid)
			body, ok := f.bodies[uid]
			if !ok {
				fmt.Fprintf(conn, "%s OK FETCH completed\r\n", tag)
				return
			}
			if strings.Contains(strings.ToUpper(line), "RFC822.SIZE") {
				fmt.Fprintf(conn, "* 1 FETCH (UID %d RFC822.SIZE %d)\r\n%s OK FETCH completed\r\n", uid, len(body), tag)
				return
			}
			fmt.Fprintf(conn, "* 1 FETCH (UID %d BODY[] {%d}\r\n%s)\r\n%s OK FETCH completed\r\n", uid, len(body), body, tag)
		default:
			fmt.Fprintf(conn, "%s OK\r\n", tag)
		}
	default:
		fmt.Fprintf(conn, "%s OK\r\n", tag)
	}
}

func selfSignedWithRoots(t *testing.T) (tls.Certificate, *x509.CertPool) {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	template := x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject:      pkix.Name{Organization: []string{"KnowFlick Runner Test"}},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		IPAddresses:  []net.IP{net.ParseIP("127.0.0.1")},
	}
	der, err := x509.CreateCertificate(rand.Reader, &template, &template, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	keyDER, err := x509.MarshalECPrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: keyDER})
	cert, err := tls.X509KeyPair(certPEM, keyPEM)
	if err != nil {
		t.Fatal(err)
	}
	// 只把这张测试证书放进池子：客户端仍然完整校验链与主机名。
	roots := x509.NewCertPool()
	if !roots.AppendCertsFromPEM(certPEM) {
		t.Fatal("failed to build test root pool")
	}
	return cert, roots
}

func mailBody(subject, messageID, text string) string {
	return "Subject: " + subject + "\r\nMessage-Id: " + messageID + "\r\n" +
		"Content-Type: text/plain; charset=utf-8\r\n\r\n" + text + "\r\n"
}

// TestRunSyncsAgainstFakeServer 是整条链路的端到端验证：
// 连服务器、登录、搜索、取信、解析、映射、写库、账本、游标。
func TestRunSyncsAgainstFakeServer(t *testing.T) {
	db := openDB(t)
	bodies := map[uint32]string{
		3: mailBody("第一封", "<m1@x>", "正文一"),
		4: mailBody("第二封", "<m2@x>", "正文二"),
	}
	server := startFakeImap(t, 7, []uint32{3, 4}, bodies)
	result, err := Run(context.Background(), Config{
		AccountID: "acct-1", Folder: "INBOX", Limit: 10, Mode: mailsync.ModeNew,
		Host: "127.0.0.1", Port: server.port(), Username: "u", Password: "p",
		Email: "me@example.com", DB: db, Roots: server.roots,
		Now: func() int64 { return 1000 },
	})
	if err != nil {
		t.Fatalf("sync failed: %v", err)
	}
	if result.Imported != 2 {
		t.Fatalf("imported: %+v", result)
	}
	var count int
	if err := db.QueryRow("SELECT COUNT(*) FROM materials").Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 2 {
		t.Fatalf("materials: %d", count)
	}
	var title, body string
	if err := db.QueryRow("SELECT title, raw_text FROM materials ORDER BY title LIMIT 1").Scan(&title, &body); err != nil {
		t.Fatal(err)
	}
	if title != "第一封" || body != "正文一" {
		t.Fatalf("material: title=%q body=%q", title, body)
	}
	var ledger int
	if err := db.QueryRow("SELECT COUNT(*) FROM mail_imports").Scan(&ledger); err != nil {
		t.Fatal(err)
	}
	if ledger != 2 {
		t.Fatalf("ledger rows: %d", ledger)
	}
	var lastUID int
	if err := db.QueryRow("SELECT last_uid FROM mail_accounts WHERE id='acct-1'").Scan(&lastUID); err != nil {
		t.Fatal(err)
	}
	if lastUID != 4 {
		t.Fatalf("cursor: %d", lastUID)
	}
}

func TestRunRejectsWithoutPassword(t *testing.T) {
	db := openDB(t)
	if _, err := Run(context.Background(), Config{DB: db, AccountID: "acct-1"}); err == nil || !strings.Contains(err.Error(), "密码") {
		t.Fatalf("missing password accepted: %v", err)
	}
}

func TestSyncDueRunsRunnerAndSkipsUntilInterval(t *testing.T) {
	db := openDB(t)
	dir := t.TempDir()
	id := "6f1a5b3e-2c4d-4a8f-9e1b-7c5d2a9f0e33"
	if err := mail.WritePassword(dir, id, "p"); err != nil {
		t.Fatal(err)
	}
	bodies := map[uint32]string{
		3: mailBody("第一封", "<m1@x>", "正文一"),
		4: mailBody("第二封", "<m2@x>", "正文二"),
	}
	server := startFakeImap(t, 7, []uint32{3, 4}, bodies)
	config := fmt.Sprintf(
		`{"id":"%s","name":"工作","email":"me@example.com","host":"127.0.0.1","port":%d,"username":"u","folder":"INBOX","syncLimit":10,"syncIntervalMinutes":15}`,
		id, server.port())
	if _, err := db.Exec("INSERT INTO mail_accounts(id,config_json,created_at) VALUES(?1,?2,2)", id, config); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("INSERT INTO mail_sync_state(account_id) VALUES(?1)", id); err != nil {
		t.Fatal(err)
	}
	// 没有密码的账号也到期：必须记成这一轮的错误，但不能挡住前面那个账号。
	missing := "6f1a5b3e-2c4d-4a8f-9e1b-7c5d2a9f0e44"
	missingConfig := `{"id":"6f1a5b3e-2c4d-4a8f-9e1b-7c5d2a9f0e44","name":"缺密码","email":"x@example.com","host":"127.0.0.1","port":993,"username":"x","folder":"INBOX","syncLimit":10,"syncIntervalMinutes":15}`
	if _, err := db.Exec("INSERT INTO mail_accounts(id,config_json,created_at) VALUES(?1,?2,3)", missing, missingConfig); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("INSERT INTO mail_sync_state(account_id) VALUES(?1)", missing); err != nil {
		t.Fatal(err)
	}
	clock := func() int64 { return 1_000_000 }
	outcomes, err := SyncDue(context.Background(), db, dir, clock, server.roots)
	if err != nil {
		t.Fatal(err)
	}
	if len(outcomes) != 2 {
		t.Fatalf("outcomes: %+v", outcomes)
	}
	if outcomes[0].AccountID != id || outcomes[0].Imported != 2 || outcomes[0].Error != "" {
		t.Fatalf("first: %+v", outcomes[0])
	}
	if outcomes[1].AccountID != missing || outcomes[1].Error == "" {
		t.Fatalf("missing password should be an outcome error: %+v", outcomes[1])
	}
	var count int
	if err := db.QueryRow("SELECT COUNT(*) FROM materials").Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 2 {
		t.Fatalf("materials: %d", count)
	}
	// 同一时刻再跑一轮：两次尝试都已记下，间隔未到，一个都不该再连。
	again, err := SyncDue(context.Background(), db, dir, clock, server.roots)
	if err != nil {
		t.Fatal(err)
	}
	if len(again) != 0 {
		t.Fatalf("second round should wait: %+v", again)
	}
	// 游标落后于去重账本时，手动同步应在回执里报告实际跳过的邮件。
	if _, err := db.Exec("UPDATE mail_accounts SET last_uid=3 WHERE id=?1", id); err != nil {
		t.Fatal(err)
	}
	manualClock := func() int64 { return clock() + 1 }
	manual, err := SyncAccount(context.Background(), db, dir, id, mailsync.ModeNew, manualClock, server.roots)
	if err != nil || manual.AccountID != id || manual.Imported != 0 || manual.Skipped != 1 ||
		manual.Rejected != 0 || manual.LastSyncAt != manualClock() || !manual.HistoryComplete {
		t.Fatalf("manual sync result: %+v, %v", manual, err)
	}
	// 导出真实结果供 Rust 对拍：不靠猜「应该导入几封」。
	if target := os.Getenv("KF_GO_DUE_FIXTURE"); target != "" {
		lines := make([]string, 0, len(outcomes))
		for _, outcome := range outcomes {
			lines = append(lines, outcome.AccountID+" imported="+fmt.Sprint(outcome.Imported)+
				" rejected="+fmt.Sprint(outcome.Rejected)+
				" hasError="+fmt.Sprint(outcome.Error != ""))
		}
		if err := os.WriteFile(target, []byte(strings.Join(lines, "\n")+"\n"), 0644); err != nil {
			t.Fatal(err)
		}
	}
}

// TestSyncDueLoopRunsRoundsUntilCancelled 验证定时器真的会反复跑「一轮到期同步」，
// 且取消后停下——不是「调了一次就算数」。
func TestSyncDueLoopRunsRoundsUntilCancelled(t *testing.T) {
	db := openDB(t)
	dir := t.TempDir()
	id := "6f1a5b3e-2c4d-4a8f-9e1b-7c5d2a9f0e55"
	if err := mail.WritePassword(dir, id, "p"); err != nil {
		t.Fatal(err)
	}
	server := startFakeImap(t, 7, []uint32{3}, map[uint32]string{
		3: mailBody("唯一一封", "<m1@x>", "正文"),
	})
	config := fmt.Sprintf(`{"id":"%s","host":"127.0.0.1","port":%d,"username":"u","folder":"INBOX","syncLimit":10,"syncIntervalMinutes":5}`, id, server.port())
	if _, err := db.Exec("INSERT INTO mail_accounts(id,config_json,created_at) VALUES(?1,?2,1)", id, config); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("INSERT INTO mail_sync_state(account_id) VALUES(?1)", id); err != nil {
		t.Fatal(err)
	}
	// 固定时钟：第一轮到期并导入，之后 last_attempt_at 等于当前时刻，
	// 后续轮次按间隔跳过。这正好同时验证两件事：定时器在反复跑、重复轮次不重复导入。
	// （不能让时钟每次推进 10 分钟——那会越过 120 秒的会话预算，会话直接被判超时。）
	clock := func() int64 { return 1_000_000 }
	ctx, cancel := context.WithCancel(context.Background())
	var rounds int32
	var errMu sync.Mutex
	firstErr := ""
	done := make(chan struct{})
	go func() {
		defer close(done)
		_ = SyncDueLoop(ctx, 5*time.Millisecond, db, dir, clock, server.roots, func(outcomes []mailschedule.Outcome, err error) {
			atomic.AddInt32(&rounds, 1)
			if err != nil {
				errMu.Lock()
				if firstErr == "" {
					firstErr = err.Error()
				}
				errMu.Unlock()
			} else {
				for _, o := range outcomes {
					if o.Error != "" {
						errMu.Lock()
						if firstErr == "" {
							firstErr = o.AccountID + ": " + o.Error
						}
						errMu.Unlock()
					}
				}
			}
		})
	}()
	deadline := time.Now().Add(time.Second)
	for atomic.LoadInt32(&rounds) < 2 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	cancel()
	<-done
	if got := atomic.LoadInt32(&rounds); got < 2 {
		t.Fatalf("loop should run several rounds: %d", got)
	}
	var materials int
	if err := db.QueryRow("SELECT COUNT(*) FROM materials").Scan(&materials); err != nil {
		t.Fatal(err)
	}
	if materials != 1 {
		t.Fatalf("repeated rounds must not duplicate the material: %d (first error: %s)", materials, firstErr)
	}
}
