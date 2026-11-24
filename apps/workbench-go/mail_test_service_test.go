package main

import (
	"bufio"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"math/big"
	"net"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"knowflick.local/workbench-go/internal/mail"
)

func TestTestMailAccountLogsInAndReportsCount(t *testing.T) {
	cert := selfSignedIMAPCert(t)
	listener, stop := fakeIMAPServer(t, cert)
	defer stop()
	port := uint16(listener.Addr().(*net.TCPAddr).Port)
	config := mail.Config{ID: "11111111-1111-4111-8111-111111111111", Name: "账号", Email: "demo@example.org", Host: "127.0.0.1", Port: port, Username: "demo", Folder: "INBOX", SyncLimit: 50}
	service := newMailService(t)
	summary, err := service.testMailAccount(context.Background(), config, "fixture", trustLocalCert(t, cert))
	if err != nil {
		t.Fatal(err)
	}
	if summary.Folder != "INBOX" || summary.MessageCount != 7 {
		t.Fatalf("summary: %+v", summary)
	}
	if _, err := service.testMailAccount(context.Background(), config, "", trustLocalCert(t, cert)); err == nil {
		t.Fatal("空密码也能测试连接")
	}
}

func TestTestMailAccountUsesSavedPasswordForMatchingIdentity(t *testing.T) {
	cert := selfSignedIMAPCert(t)
	listener, stop := fakeIMAPServer(t, cert)
	defer stop()
	service := newMailService(t)
	port := uint16(listener.Addr().(*net.TCPAddr).Port)
	config := mail.Config{ID: "11111111-1111-4111-8111-111111111111", Name: "账号", Email: "demo@example.org", Host: "127.0.0.1", Port: port, Username: "demo", Folder: "INBOX", SyncLimit: 50}
	ctx := context.Background()
	if _, err := service.SaveMailAccount(ctx, config, "fixture"); err != nil {
		t.Fatal(err)
	}
	roots := trustLocalCert(t, cert)
	changedHost, changedPort, changedUser := config, config, config
	changedHost.Host = "localhost"
	changedPort.Port = 1
	changedUser.Username = "other"
	for _, changed := range []mail.Config{changedHost, changedPort, changedUser} {
		if _, err := service.testMailAccount(ctx, changed, "", roots); err == nil || !strings.Contains(err.Error(), "重新输入密码") {
			t.Fatalf("changed login identity should require a new password: %v", err)
		}
	}
	summary, err := service.testMailAccount(ctx, config, "", roots)
	if err != nil || summary.Folder != "INBOX" || summary.MessageCount != 7 {
		t.Fatalf("saved credential test = %+v, %v", summary, err)
	}
	dir := filepath.Dir(service.preview.path)
	if saved, err := mail.ReadPassword(dir, config.ID); err != nil || saved != "fixture" {
		t.Fatal("connection test changed the saved credential")
	}
}

// fakeIMAPServer 起一个只讲 LOGIN / EXAMINE 的本地 TLS 服务器：问候行 + 两条回复。
func fakeIMAPServer(t *testing.T, cert tls.Certificate) (net.Listener, func()) {
	t.Helper()
	listener, err := tls.Listen("tcp", "127.0.0.1:0", &tls.Config{Certificates: []tls.Certificate{cert}})
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan struct{})
	go func() {
		defer close(done)
		conn, err := listener.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		_, _ = conn.Write([]byte("* OK ready\r\n"))
		reader := bufio.NewReader(conn)
		for {
			line, err := reader.ReadString('\n')
			if err != nil {
				return
			}
			fields := strings.Fields(strings.TrimSpace(line))
			if len(fields) == 0 {
				return
			}
			tag := fields[0]
			upper := strings.ToUpper(line)
			switch {
			case strings.Join(fields[1:], " ") == `LOGIN "demo" "fixture"`:
				_, _ = conn.Write([]byte(tag + " OK LOGIN completed\r\n"))
			case strings.Contains(upper, "EXAMINE"):
				_, _ = conn.Write([]byte("* 7 EXISTS\r\n* OK [UIDVALIDITY 42] ready\r\n" + tag + " OK EXAMINE completed\r\n"))
			default:
				_, _ = conn.Write([]byte(tag + " NO unsupported\r\n"))
			}
		}
	}()
	return listener, func() { _ = listener.Close(); <-done }
}

func trustLocalCert(t *testing.T, cert tls.Certificate) *x509.CertPool {
	t.Helper()
	leaf, err := x509.ParseCertificate(cert.Certificate[0])
	if err != nil {
		t.Fatal(err)
	}
	pool := x509.NewCertPool()
	pool.AddCert(leaf)
	return pool
}

func selfSignedIMAPCert(t *testing.T) tls.Certificate {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	template := x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{Organization: []string{"KnowFlick Test"}},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(time.Hour),
		KeyUsage:              x509.KeyUsageDigitalSignature | x509.KeyUsageCertSign,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
		IsCA:                  true,
		IPAddresses:           []net.IP{net.ParseIP("127.0.0.1")},
	}
	der, err := x509.CreateCertificate(rand.Reader, &template, &template, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	return tls.Certificate{Certificate: [][]byte{der}, PrivateKey: key}
}

var _ = strconv.Itoa
