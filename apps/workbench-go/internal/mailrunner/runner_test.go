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
	"path/filepath"
	"strings"
	"testing"
	"time"

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
	go server.serve()
	t.Cleanup(func() { _ = listener.Close() })
	return server
}

func (f *fakeImap) port() uint16 { return uint16(f.listener.Addr().(*net.TCPAddr).Port) }

func (f *fakeImap) serve() {
	conn, err := f.listener.Accept()
	if err != nil {
		return
	}
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
