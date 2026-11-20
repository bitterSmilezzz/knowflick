package mail

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func validConfig() Config {
	return Config{
		ID: "6f1a5b3e-2c4d-4a8f-9e1b-7c5d2a9f0e33", Name: "工作邮箱", Email: "me@example.com",
		Host: "imap.example.com", Port: 993, Username: "me@example.com", Folder: "INBOX",
		SyncLimit: 50, SyncIntervalMinutes: 15,
	}
}

func TestValidateAcceptsAndTrims(t *testing.T) {
	config := validConfig()
	config.Name = "  工作邮箱  "
	config.Folder = "   "
	got, err := Validate(config)
	if err != nil {
		t.Fatal(err)
	}
	if got.Name != "工作邮箱" || got.Folder != DefaultFolder {
		t.Fatalf("trim/default: %+v", got)
	}
}

func TestValidateRejectsEachRule(t *testing.T) {
	cases := []struct {
		name   string
		mutate func(*Config)
		want   string
	}{
		{"bad id", func(c *Config) { c.ID = "not-a-uuid" }, "标准 UUID"},
		{"empty name", func(c *Config) { c.Name = "  " }, "账号名称"},
		{"control char", func(c *Config) { c.Name = "bad\nname" }, "控制字符"},
		{"no at", func(c *Config) { c.Email = "example.com" }, "邮箱地址格式"},
		{"zero port", func(c *Config) { c.Port = 0 }, "端口不对"},
		{"limit low", func(c *Config) { c.SyncLimit = 0 }, "1 到 200"},
		{"limit high", func(c *Config) { c.SyncLimit = 201 }, "1 到 200"},
		{"interval low", func(c *Config) { c.SyncIntervalMinutes = 3 }, "5 至 1440"},
		{"host with scheme", func(c *Config) { c.Host = "https://imap.example.com" }, "服务器地址"},
		{"host with port", func(c *Config) { c.Host = "imap.example.com:993" }, "服务器地址"},
	}
	for _, tc := range cases {
		config := validConfig()
		tc.mutate(&config)
		if _, err := Validate(config); err == nil || !strings.Contains(err.Error(), tc.want) {
			t.Fatalf("%s: expected error containing %q, got %v", tc.name, tc.want, err)
		}
	}
	// 同步间隔 0 表示关闭，必须放行。
	off := validConfig()
	off.SyncIntervalMinutes = 0
	if _, err := Validate(off); err != nil {
		t.Fatalf("interval 0 should disable sync: %v", err)
	}
}

func TestCredentialRoundTripAndPermissions(t *testing.T) {
	dir := t.TempDir()
	id := validConfig().ID
	if _, err := ReadPassword(dir, id); err == nil {
		t.Fatal("missing credential should error")
	}
	if err := WritePassword(dir, id, "secret-pass"); err != nil {
		t.Fatal(err)
	}
	path, err := CredentialPath(dir, id)
	if err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if perm := info.Mode().Perm(); perm != 0o600 {
		t.Fatalf("credential file mode %o, want 600", perm)
	}
	dirInfo, err := os.Stat(filepath.Dir(path))
	if err != nil {
		t.Fatal(err)
	}
	if perm := dirInfo.Mode().Perm(); perm != 0o700 {
		t.Fatalf("credential dir mode %o, want 700", perm)
	}
	got, err := ReadPassword(dir, id)
	if err != nil || got != "secret-pass" {
		t.Fatalf("round trip: %q %v", got, err)
	}
	entries, _ := os.ReadDir(filepath.Dir(path))
	if len(entries) != 1 {
		t.Fatalf("temp file left behind: %d entries", len(entries))
	}
}

func TestReadPasswordRejectsLoosePermissions(t *testing.T) {
	dir := t.TempDir()
	id := validConfig().ID
	if err := WritePassword(dir, id, "secret-pass"); err != nil {
		t.Fatal(err)
	}
	path, _ := CredentialPath(dir, id)
	if err := os.Chmod(path, 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := ReadPassword(dir, id); err == nil || !strings.Contains(err.Error(), "权限太宽") {
		t.Fatalf("loose permissions accepted: %v", err)
	}
}

func TestCredentialPathRejectsSymlinks(t *testing.T) {
	root := t.TempDir()
	elsecwhere := t.TempDir()
	if err := os.Symlink(elsecwhere, filepath.Join(root, "credentials")); err != nil {
		t.Skip("symlinks unsupported on this platform")
	}
	if _, err := CredentialPath(root, validConfig().ID); err == nil || !strings.Contains(err.Error(), "凭据目录不可用") {
		t.Fatalf("symlinked dir accepted: %v", err)
	}
}

func TestValidatePasswordRules(t *testing.T) {
	for _, bad := range []string{"", "with\nnewline", strings.Repeat("x", 4097)} {
		if err := ValidatePassword(bad); err == nil {
			t.Fatalf("accepted bad password %q", bad[:min(len(bad), 12)])
		}
	}
	if err := ValidatePassword("正常密码 abc"); err != nil {
		t.Fatalf("rejected valid password: %v", err)
	}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
