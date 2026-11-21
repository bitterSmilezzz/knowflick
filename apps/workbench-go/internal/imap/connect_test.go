package imap

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"net"
	"testing"
	"time"
)

// TestConnectVerifiesCertificates 起一个自签名 TLS 服务器：Go 必须拒绝，
// 因为证书不在系统根里。这条守住「TLS 始终校验」——没有明文开关，也没有跳过校验的路径。
func TestConnectVerifiesCertificates(t *testing.T) {
	cert := selfSigned(t)
	server, err := tls.Listen("tcp", "127.0.0.1:0", &tls.Config{Certificates: []tls.Certificate{cert}})
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close()
	go func() {
		conn, acceptErr := server.Accept()
		if acceptErr == nil {
			_ = conn.Close()
		}
	}()
	port := uint16(server.Addr().(*net.TCPAddr).Port)
	if _, err := Connect("127.0.0.1", port); err == nil {
		t.Fatal("self-signed certificate accepted: TLS verification is not enforced")
	}
}

func TestConnectRejectsUnresolvableHost(t *testing.T) {
	if _, err := Connect("no-such-host.invalid", 993); err == nil {
		t.Fatal("unresolvable host accepted")
	}
}

func TestConnectRejectsClosedPort(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := uint16(listener.Addr().(*net.TCPAddr).Port)
	listener.Close()
	if _, err := Connect("127.0.0.1", port); err == nil {
		t.Fatal("closed port accepted")
	}
}

// selfSigned 现场生成自签名证书：手写 PEM 常量容易写错，生成更可靠。
func selfSigned(t *testing.T) tls.Certificate {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	template := x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject:      pkix.Name{Organization: []string{"KnowFlick Test"}},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		DNSNames:     []string{"localhost"},
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
	return cert
}
