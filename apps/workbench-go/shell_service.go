package main

import (
	"context"
	"encoding/base64"
	"errors"
	"os"
	"path/filepath"
	"unicode/utf8"

	"knowflick.local/workbench-go/internal/creds"
	"knowflick.local/workbench-go/internal/e2ee"
)

const maxTextImportBytes = 32 * 1024 * 1024

// ReadTextFile 读用户选定的文本文件；只接受 UTF-8，超过 32 MiB 拒绝。
func (s *PreviewService) ReadTextFile(ctx context.Context, path string) (string, error) {
	if path == "" {
		return "", errors.New("没有选择要读取的文件")
	}
	info, err := os.Stat(path)
	if err != nil || !info.Mode().IsRegular() {
		return "", errors.New("无法读取所选文件")
	}
	if info.Size() > maxTextImportBytes {
		return "", errors.New("文件超过 32 MiB")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return "", errors.New("无法读取所选文件")
	}
	if !utf8.Valid(data) {
		return "", errors.New("文件不是 UTF-8 文本")
	}
	return string(data), nil
}

// E2EEEncrypt 用口令加密一段字节，输入输出都用 base64 避免数组膨胀。
func (s *PreviewService) E2EEEncrypt(ctx context.Context, passphrase, dataB64 string) (string, error) {
	data, err := base64.StdEncoding.DecodeString(dataB64)
	if err != nil {
		return "", errors.New("待加密数据无效，无法解码")
	}
	if len(data) > 64*1024*1024 {
		return "", errors.New("待加密数据超过 64 MB 上限")
	}
	blob, err := e2ee.Encrypt(passphrase, data)
	if err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(blob), nil
}

// E2EEDecrypt 用口令解开一段加密字节。
func (s *PreviewService) E2EEDecrypt(ctx context.Context, passphrase, blobB64 string) (string, error) {
	blob, err := base64.StdEncoding.DecodeString(blobB64)
	if err != nil {
		return "", errors.New("加密数据无效，无法解码")
	}
	plain, err := e2ee.Decrypt(passphrase, blob)
	if err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(plain), nil
}

// ReadWebDAVCredential 读已记住的 WebDAV 凭据；没有返回空串。
func (s *PreviewService) ReadWebDAVCredential(ctx context.Context, generation int) (string, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.current == nil || s.generation != generation {
		return "", errors.New("请重新打开资料库")
	}
	return creds.Read(filepath.Dir(s.path), "webdav.credential")
}

// WriteWebDAVCredential 记住 WebDAV 凭据；空值表示删除。
func (s *PreviewService) WriteWebDAVCredential(ctx context.Context, generation int, value string) error {
	s.mu.RLock()
	dir := ""
	if s.current != nil && s.generation == generation {
		dir = filepath.Dir(s.path)
	}
	s.mu.RUnlock()
	if dir == "" {
		return errors.New("请重新打开资料库")
	}
	return creds.Write(dir, "webdav.credential", value)
}
