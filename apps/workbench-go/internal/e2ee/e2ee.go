// Package e2ee 迁自 Rust 的 e2ee.rs：备份包的端到端加密。
//
// 口径与原实现一致：
//   - 上传前加密内容与附件：AES-256-GCM（认证加密——密文被篡改时解密失败，
//     而不是静默还原出坏数据）；
//   - 密钥本地派生：SHA-256 多轮迭代，每轮混入轮次号，避免轮函数可被预计算折叠；
//   - 文件头自描述（魔数、版本、轮数、盐、nonce）：旧版本解不开新文件时明确报「版本不认识」，不猜；
//   - 忘记口令不能找回：错误消息如实说。
//
// 明确不做：静态数据库加密（文档要求独立评估，不以本模块冒充）。
package e2ee

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"fmt"
)

// header 是 8 字节自描述头：[0..5]=KFENC\0，[6]=版本，[7]=保留。
// 版本位不进魔数，否则新版本文件会被误报成「不是加密文件」。
var header = [8]byte{'K', 'F', 'E', 'N', 'C', 0, 1, 0}

// DefaultIterations 是 OWASP 2023 对 SHA-256 的建议值，与 Rust 一致。
// 轮数写进密文头里，未来可调——旧文件仍能解。
const DefaultIterations = 210_000

const (
	saltSize  = 16
	nonceSize = 12
	minSize   = len(header) + 4 + saltSize + nonceSize
)

var (
	// ErrNotEncrypted 表示根本不是 KnowFlick 加密备份。
	ErrNotEncrypted = errors.New("这不是 KnowFlick 加密备份")
	// ErrEmptyPassphrase 表示口令为空。
	ErrEmptyPassphrase = errors.New("口令不能为空——空口令的加密等于没加密")
)

// deriveKey 与 Rust 的 derive_key 逐字节一致：
// key = SHA256(salt)，之后迭代 iterations 次 key = SHA256(key || pass || i_le_u32)。
func deriveKey(passphrase string, salt []byte, iterations uint32) [32]byte {
	key := sha256.Sum256(salt)
	passBytes := []byte(passphrase)
	var counter [4]byte
	for i := uint32(0); i < iterations; i++ {
		hasher := sha256.New()
		hasher.Write(key[:])
		hasher.Write(passBytes)
		binary.LittleEndian.PutUint32(counter[:], i)
		hasher.Write(counter[:])
		copy(key[:], hasher.Sum(nil))
	}
	return key
}

// Encrypt 用口令加密备份包，返回自描述容器：头 + 轮数 + 盐 + nonce + 密文。
func Encrypt(passphrase string, plaintext []byte) ([]byte, error) {
	if passphrase == "" {
		return nil, ErrEmptyPassphrase
	}
	salt := make([]byte, saltSize)
	nonce := make([]byte, nonceSize)
	if _, err := rand.Read(salt); err != nil {
		return nil, errors.New("无法生成随机盐值")
	}
	if _, err := rand.Read(nonce); err != nil {
		return nil, errors.New("无法生成随机 nonce")
	}
	key := deriveKey(passphrase, salt, DefaultIterations)
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return nil, errors.New("加密失败")
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, errors.New("加密失败")
	}
	ciphertext := gcm.Seal(nil, nonce, plaintext, nil)
	total := len(header) + 4 + len(salt) + len(nonce) + len(ciphertext)
	out := make([]byte, 0, total)
	out = append(out, header[:]...)
	out = binary.LittleEndian.AppendUint32(out, DefaultIterations)
	out = append(out, salt...)
	out = append(out, nonce...)
	out = append(out, ciphertext...)
	return out, nil
}

// Decrypt 口令解密。错误区分三种：不是加密文件 / 版本不认识 / 口令不对或数据被改。
func Decrypt(passphrase string, blob []byte) ([]byte, error) {
	if len(blob) < minSize {
		return nil, errors.New("这不是 KnowFlick 加密备份（头都不完整）")
	}
	// 魔数只比前 6 字节（KFENC\0）；[6] 是版本、[7] 保留。
	for i := 0; i < 6; i++ {
		if blob[i] != header[i] {
			return nil, ErrNotEncrypted
		}
	}
	version := blob[6]
	if version != 1 {
		return nil, fmt.Errorf("加密版本 %d 不认识——本版本只认 1；请用更新版本的应用打开", version)
	}
	offset := len(header)
	iterations := binary.LittleEndian.Uint32(blob[offset : offset+4])
	offset += 4
	salt := blob[offset : offset+saltSize]
	offset += saltSize
	nonce := blob[offset : offset+nonceSize]
	offset += nonceSize
	ciphertext := blob[offset:]
	key := deriveKey(passphrase, salt, iterations)
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return nil, errors.New("口令不对，或文件在服务端被改动（认证校验没过）。忘记口令无法找回——这是端到端加密的代价")
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, errors.New("口令不对，或文件在服务端被改动（认证校验没过）。忘记口令无法找回——这是端到端加密的代价")
	}
	plaintext, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return nil, errors.New("口令不对，或文件在服务端被改动（认证校验没过）。忘记口令无法找回——这是端到端加密的代价")
	}
	return plaintext, nil
}
