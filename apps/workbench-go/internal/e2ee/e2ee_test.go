package e2ee

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"encoding/binary"
	"errors"
	"os"
	"strings"
	"testing"
)

func TestRoundTripAndTamperDetection(t *testing.T) {
	plaintext := []byte("PK\x03\x04 backup archive bytes")
	blob, err := Encrypt("correct horse", plaintext)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.HasPrefix(blob, header[:]) {
		t.Fatal("blob must start with the KFENC header")
	}
	restored, err := Decrypt("correct horse", blob)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(restored, plaintext) {
		t.Fatalf("round trip: %q", restored)
	}
	// 错误口令 → 明确说「口令不对」，不是静默坏数据。
	if _, err := Decrypt("wrong", blob); err == nil || !strings.Contains(err.Error(), "口令不对") {
		t.Fatalf("wrong passphrase: %v", err)
	}
	// 服务端篡改一个字节 → GCM 认证失败（同样是那条错误）。
	tampered := append([]byte(nil), blob...)
	tampered[len(tampered)-1] ^= 0x01
	if _, err := Decrypt("correct horse", tampered); err == nil || !strings.Contains(err.Error(), "口令不对") {
		t.Fatalf("tampered blob accepted: %v", err)
	}
	// 不是加密文件 / 头不完整。
	// 与 Rust 同口径：短文件先被「头不完整」拦下，但两条错误都必须明确说
	// 「不是 KnowFlick 加密备份」——不能只说「长度不对」，那会让用户以为文件损坏了。
	if _, err := Decrypt("x", []byte("PK-plain-zip")); err == nil || !strings.Contains(err.Error(), "不是 KnowFlick 加密备份") {
		t.Fatalf("plain file accepted: %v", err)
	}
	if _, err := Decrypt("x", blob[:10]); err == nil || !strings.Contains(err.Error(), "头都不完整") {
		t.Fatalf("truncated header: %v", err)
	}
	// 空口令拒绝。
	if _, err := Encrypt("", plaintext); !errors.Is(err, ErrEmptyPassphrase) {
		t.Fatalf("empty passphrase: %v", err)
	}
	// 同一口令两次加密产生不同密文（盐与 nonce 都随机）。
	again, err := Encrypt("correct horse", plaintext)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(blob, again) {
		t.Fatal("two encryptions produced identical ciphertext")
	}
}

func TestFutureVersionIsRejectedWithClearMessage(t *testing.T) {
	blob, err := Encrypt("p", []byte("data"))
	if err != nil {
		t.Fatal(err)
	}
	blob[6] = 2 // 头里的版本位（offset 6）
	if _, err := Decrypt("p", blob); err == nil || !strings.Contains(err.Error(), "版本 2 不认识") {
		t.Fatalf("future version: %v", err)
	}
}

func TestIterationCountComesFromTheHeader(t *testing.T) {
	// 轮数写进头里：解密按头里的轮数派生，而不是把常量写死。
	blob, err := Encrypt("p", []byte("data"))
	if err != nil {
		t.Fatal(err)
	}
	if got := binary.LittleEndian.Uint32(blob[8:12]); got != DefaultIterations {
		t.Fatalf("header iterations: %d", got)
	}
	salt := []byte("0123456789abcdef")
	nonce := []byte("0123456789ab")
	key := deriveKey("p", salt, 5)
	block, err := aes.NewCipher(key[:])
	if err != nil {
		t.Fatal(err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		t.Fatal(err)
	}
	plaintext := []byte("short iteration")
	sealed := gcm.Seal(nil, nonce, plaintext, nil)
	custom := make([]byte, 0, len(header)+4+16+12+len(sealed))
	custom = append(custom, header[:]...)
	custom = binary.LittleEndian.AppendUint32(custom, 5)
	custom = append(custom, salt...)
	custom = append(custom, nonce...)
	custom = append(custom, sealed...)
	restored, err := Decrypt("p", custom)
	if err != nil {
		t.Fatalf("custom iterations should decrypt: %v", err)
	}
	if !bytes.Equal(restored, plaintext) {
		t.Fatalf("custom iteration decrypt: %q", restored)
	}
}

const fixturePassphrase = "correct horse"

// TestExportE2EEFixture 导出 Go 加密的密文，供 Rust 用同一口令解开。
// 两个方向都测：只要有一边的密钥派生或 GCM 参数对不上，对方就解不开。
func TestExportE2EEFixture(t *testing.T) {
	target := os.Getenv("KF_GO_E2EE_FIXTURE")
	if target == "" {
		t.Skip("set KF_GO_E2EE_FIXTURE to export the encrypted fixture")
	}
	plaintext := []byte("PK\x03\x04 端到端加密的备份包内容")
	blob, err := Encrypt(fixturePassphrase, plaintext)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(target, blob, 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(target+".plain", plaintext, 0644); err != nil {
		t.Fatal(err)
	}
}

// TestDecryptRustFixture 读 Rust 加密的密文并解密。
func TestDecryptRustFixture(t *testing.T) {
	path := os.Getenv("KF_RUST_E2EE_FIXTURE")
	if path == "" {
		t.Skip("set KF_RUST_E2EE_FIXTURE to the Rust-written blob")
	}
	blob, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	plaintext, err := os.ReadFile(path + ".plain")
	if err != nil {
		t.Fatal(err)
	}
	restored, err := Decrypt(fixturePassphrase, blob)
	if err != nil {
		t.Fatalf("Go should decrypt the Rust-written blob: %v", err)
	}
	if !bytes.Equal(restored, plaintext) {
		t.Fatalf("round trip mismatch: %q", restored)
	}
}
