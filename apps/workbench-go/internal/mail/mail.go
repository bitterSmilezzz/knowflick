// Package mail 迁自 Rust 的 mail.rs（分批）：先落**配置校验**与**凭据存储**，
// 这两块是安全边界，IMAP 会话与导入流水后续再来。
//
// 与原实现一致的三条硬约束：
//   - 密码只存在 <dir>/credentials/mail-<uuid>（0600 文件、0700 目录），
//     绝不进 SQLite、DTO、日志或备份包。
//   - 凭据目录/文件若是指向别处的符号链接，一律拒绝——防止被替换后读到别人的文件。
//   - 读回时校验权限：权限太宽就报错，不「顺手修好」。
package mail

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"unicode"
)

const (
	// MaxFolderLen 与 Rust 的 MAX_FOLDER_LEN 一致。
	MaxFolderLen = 512
	// DefaultFolder 是未填文件夹时的默认值。
	DefaultFolder = "INBOX"
	// DefaultLimit 是每次同步的默认封数。
	DefaultLimit = 50
)

// Config 是界面上编辑的账号设置；ID 由界面生成的 UUID。
type Config struct {
	ID                  string `json:"id"`
	Name                string `json:"name"`
	Email               string `json:"email"`
	Host                string `json:"host"`
	Port                uint16 `json:"port"`
	Username            string `json:"username"`
	Folder              string `json:"folder"`
	SyncLimit           int    `json:"syncLimit"`
	SyncIntervalMinutes int    `json:"syncIntervalMinutes"`
}

var uuidPattern = regexp.MustCompile("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")

// ValidID 要求标准 UUID；Rust 用 Uuid::parse_str 且要求回写文本完全相同。
func ValidID(id string) error {
	if !uuidPattern.MatchString(id) {
		return errors.New("账号 id 必须是标准 UUID（形如 6f1a5b3e-2c4d-4a8f-9e1b-7c5d2a9f0e33）")
	}
	return nil
}

// Validate 逐条对齐 Rust 的 validate：必填、长度、控制字符、邮箱形状、
// 端口范围、同步封数、同步间隔、主机名形状。
func Validate(config Config) (Config, error) {
	if err := ValidID(config.ID); err != nil {
		return config, err
	}
	config.Name = strings.TrimSpace(config.Name)
	config.Email = strings.TrimSpace(config.Email)
	config.Host = strings.TrimSpace(config.Host)
	config.Username = strings.TrimSpace(config.Username)
	config.Folder = strings.TrimSpace(config.Folder)
	if config.Folder == "" {
		config.Folder = DefaultFolder
	}
	fields := []struct {
		label string
		value string
		max   int
	}{
		{"账号名称", config.Name, 200},
		{"邮箱地址", config.Email, 320},
		{"服务器地址", config.Host, 253},
		{"用户名", config.Username, 320},
		{"文件夹名", config.Folder, MaxFolderLen},
	}
	for _, field := range fields {
		if field.value == "" || len(field.value) > field.max || hasControl(field.value) {
			return config, fmt.Errorf("%s不能为空，且不能超过 %d 个字符，也不能含换行等控制字符", field.label, field.max)
		}
	}
	if !strings.Contains(config.Email, "@") {
		return config, errors.New("邮箱地址格式不对，请检查是否写全了")
	}
	if config.Port == 0 {
		return config, errors.New("端口不对：请填 1 到 65535 之间的数字（IMAP 通常是 993）")
	}
	if config.SyncLimit < 1 || config.SyncLimit > 200 {
		return config, errors.New("每次同步的邮件数要在 1 到 200 之间")
	}
	if config.SyncIntervalMinutes != 0 && (config.SyncIntervalMinutes < 5 || config.SyncIntervalMinutes > 1440) {
		return config, errors.New("自动同步间隔须为 5 至 1440 分钟，或设为 0 关闭")
	}
	if !isASCII(config.Host) || strings.ContainsAny(config.Host, "/\\:@[]\"'<> ") {
		return config, errors.New("服务器地址要填域名或 IP，不能带 https:// 这样的前缀，也不能带端口（端口另有单独一栏）")
	}
	return config, nil
}

func hasControl(s string) bool {
	for _, r := range s {
		if unicode.IsControl(r) {
			return true
		}
	}
	return false
}

func isASCII(s string) bool {
	for i := 0; i < len(s); i++ {
		if s[i] > 127 {
			return false
		}
	}
	return true
}

// CredentialPath 返回凭据文件路径，并拒绝符号链接的目录或文件。
func CredentialPath(dir, id string) (string, error) {
	if err := ValidID(id); err != nil {
		return "", err
	}
	root := filepath.Join(dir, "credentials")
	if info, err := os.Lstat(root); err == nil {
		if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
			return "", errors.New("凭据目录不可用，请检查它的路径与权限")
		}
	}
	path := filepath.Join(root, "mail-"+id)
	if info, err := os.Lstat(path); err == nil {
		if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
			return "", errors.New("凭据文件不可用，请检查它的路径与权限")
		}
	}
	return path, nil
}

// ValidatePassword 与 Rust 同口径：非空、不超 4096 字节、无控制字符。
func ValidatePassword(password string) error {
	if password == "" || len(password) > 4096 || hasControl(password) {
		return errors.New("请填写 1 到 4096 字节的密码，且不能包含换行等控制字符")
	}
	return nil
}

// ReadPassword 读回密码。权限太宽就报错，不「顺手修好」——
// 静默修权限会掩盖「这个文件曾经被别人读过」的可能。
func ReadPassword(dir, id string) (string, error) {
	path, err := CredentialPath(dir, id)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(path)
	if err != nil {
		return "", errors.New("还没有保存这个账号的密码，请重新输入")
	}
	if perm := info.Mode().Perm(); perm&0o077 != 0 {
		return "", errors.New("凭据文件只能由本人读取（权限太宽了），请把它改成仅本人可读")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return "", errors.New("无法读取邮箱凭据")
	}
	password := string(data)
	if err := ValidatePassword(password); err != nil {
		return "", err
	}
	return password, nil
}

// WritePassword 原子写密码：临时文件（0600）→ Sync → Rename，目录置 0700。
// 失败清临时文件，绝不留下半截凭据。
func WritePassword(dir, id, password string) error {
	if err := ValidatePassword(password); err != nil {
		return err
	}
	path, err := CredentialPath(dir, id)
	if err != nil {
		return err
	}
	root := filepath.Dir(path)
	if err := os.MkdirAll(root, 0o700); err != nil {
		return errors.New("无法创建邮箱凭据目录")
	}
	if err := os.Chmod(root, 0o700); err != nil {
		return errors.New("无法收紧邮箱凭据目录权限")
	}
	temp := filepath.Join(root, ".mail-"+randomSuffix())
	file, err := os.OpenFile(temp, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return errors.New("无法写入邮箱凭据")
	}
	cleanup := func() { _ = os.Remove(temp) }
	if _, err := file.WriteString(password); err != nil {
		file.Close()
		cleanup()
		return errors.New("无法写入邮箱凭据")
	}
	if err := file.Sync(); err != nil {
		file.Close()
		cleanup()
		return errors.New("无法写入邮箱凭据")
	}
	if err := file.Close(); err != nil {
		cleanup()
		return errors.New("无法写入邮箱凭据")
	}
	if err := os.Rename(temp, path); err != nil {
		cleanup()
		return errors.New("无法写入邮箱凭据")
	}
	return nil
}

// RemovePassword 删除凭据；不存在不算错（删账号要幂等）。
func RemovePassword(dir, id string) error {
	path, err := CredentialPath(dir, id)
	if err != nil {
		return err
	}
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return errors.New("无法删除邮箱凭据")
	}
	return nil
}

func randomSuffix() string {
	b := make([]byte, 8)
	if _, err := randRead(b); err != nil {
		return "fallback"
	}
	return hexEncode(b)
}

func randRead(b []byte) (int, error) { return rand.Read(b) }

func hexEncode(b []byte) string { return hex.EncodeToString(b) }
