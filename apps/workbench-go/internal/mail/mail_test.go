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

func TestSaveListAndGetAccount(t *testing.T) {
	dir := t.TempDir()
	config := validConfig()
	account, err := SaveAccount(dir, config, "secret-pass")
	if err != nil {
		t.Fatal(err)
	}
	if !account.HasPassword || account.Config.Name != "工作邮箱" || account.HistoryComplete {
		t.Fatalf("saved account: %+v", account)
	}
	list, err := ListAccounts(dir)
	if err != nil || len(list) != 1 || list[0].Config.ID != config.ID {
		t.Fatalf("list: %+v %v", list, err)
	}
	got, err := GetAccount(dir, config.ID)
	if err != nil || got == nil || !got.HasPassword {
		t.Fatalf("get: %+v %v", got, err)
	}
	missing, err := GetAccount(dir, "6f1a5b3e-2c4d-4a8f-9e1b-7c5d2a9f0e44")
	if err != nil || missing != nil {
		t.Fatalf("missing account should be nil: %+v %v", missing, err)
	}
}

func TestEmptyPasswordRules(t *testing.T) {
	dir := t.TempDir()
	config := validConfig()
	if _, err := SaveAccount(dir, config, ""); err == nil || !strings.Contains(err.Error(), "新账号需要输入密码") {
		t.Fatalf("new account without password: %v", err)
	}
	if _, err := SaveAccount(dir, config, "secret-pass"); err != nil {
		t.Fatal(err)
	}
	// 同服务器同用户名：空密码沿用已存的。
	renamed := config
	renamed.Name = "改名后"
	if _, err := SaveAccount(dir, renamed, ""); err != nil {
		t.Fatalf("keep password: %v", err)
	}
	// 换服务器：必须重输密码。
	moved := config
	moved.Host = "imap.other.com"
	if _, err := SaveAccount(dir, moved, ""); err == nil || !strings.Contains(err.Error(), "重新输入密码") {
		t.Fatalf("host change without password: %v", err)
	}
}

func TestIdentityChangeClearsLedger(t *testing.T) {
	dir := t.TempDir()
	config := validConfig()
	if _, err := SaveAccount(dir, config, "secret-pass"); err != nil {
		t.Fatal(err)
	}
	db, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("INSERT INTO mail_imports(account_id,folder,uid_validity,uid,message_id,material_id) VALUES(?1,'INBOX',7,42,'m1','mat1')", config.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("INSERT INTO mail_rejected(account_id,folder,uid_validity,uid,reason) VALUES(?1,'INBOX',7,43,'too large')", config.ID); err != nil {
		t.Fatal(err)
	}
	db.Close()

	// 只改名字：账本必须保留。
	renamed := config
	renamed.Name = "改名后"
	if _, err := SaveAccount(dir, renamed, ""); err != nil {
		t.Fatal(err)
	}
	if count := countRows(t, dir, "SELECT COUNT(*) FROM mail_imports"); count != 1 {
		t.Fatalf("ledger dropped on rename: %d", count)
	}

	// 换文件夹：账本必须清空（不同邮箱会复用同一对 UIDVALIDITY/UID）。
	moved := renamed
	moved.Folder = "Archive"
	if _, err := SaveAccount(dir, moved, "secret-pass"); err != nil {
		t.Fatal(err)
	}
	if count := countRows(t, dir, "SELECT COUNT(*) FROM mail_imports"); count != 0 {
		t.Fatalf("ledger kept after identity change: %d", count)
	}
	if count := countRows(t, dir, "SELECT COUNT(*) FROM mail_rejected"); count != 0 {
		t.Fatalf("rejected kept after identity change: %d", count)
	}
}

func TestRemoveAccountKeepsLedger(t *testing.T) {
	dir := t.TempDir()
	config := validConfig()
	if _, err := SaveAccount(dir, config, "secret-pass"); err != nil {
		t.Fatal(err)
	}
	db, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("INSERT INTO mail_imports(account_id,folder,uid_validity,uid,message_id,material_id) VALUES(?1,'INBOX',7,42,'m1','mat1')", config.ID); err != nil {
		t.Fatal(err)
	}
	db.Close()
	if err := RemoveAccount(dir, config.ID); err != nil {
		t.Fatal(err)
	}
	if list, _ := ListAccounts(dir); len(list) != 0 {
		t.Fatalf("account survived removal: %+v", list)
	}
	if count := countRows(t, dir, "SELECT COUNT(*) FROM mail_imports"); count != 1 {
		t.Fatalf("ledger lost on removal: %d", count)
	}
	if _, err := ReadPassword(dir, config.ID); err == nil {
		t.Fatal("credential survived removal")
	}
}

func countRows(t *testing.T, dir, statement string) int {
	t.Helper()
	db, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var n int
	if err := db.QueryRow(statement).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// TestExportAccountFixture 生成 Go 写的邮箱库，供 Rust 读回对拍。
func TestExportAccountFixture(t *testing.T) {
	target := os.Getenv("KF_GO_MAIL_FIXTURE")
	if target == "" {
		t.Skip("set KF_GO_MAIL_FIXTURE to export the mail fixture")
	}
	if _, err := os.Lstat(target); !os.IsNotExist(err) {
		t.Fatalf("fixture dir must not exist: %v", err)
	}
	config := validConfig()
	if _, err := SaveAccount(target, config, "go-secret-pass"); err != nil {
		t.Fatal(err)
	}
	db, err := Open(target)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	// 拒收统计按 (account_id, uid_validity) 关联：账号还没有 uid_validity 时
	// 统计必然为 0。夹具要先写上 UIDVALIDITY，才能验证这条统计口径。
	if _, err := db.Exec("UPDATE mail_accounts SET uid_validity=7 WHERE id=?1", config.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("INSERT INTO mail_rejected(account_id,folder,uid_validity,uid,reason,rejected_at) VALUES(?1,'INBOX',7,43,'too large',1000)", config.ID); err != nil {
		t.Fatal(err)
	}
}

// TestReadRustWrittenAccount 读回 Rust 写的账号，验证跨运行时双向一致。
func TestReadRustWrittenAccount(t *testing.T) {
	dir := os.Getenv("KF_RUST_MAIL_FIXTURE")
	if dir == "" {
		t.Skip("set KF_RUST_MAIL_FIXTURE to the Rust-written mail fixture")
	}
	accounts, err := ListAccounts(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(accounts) != 1 {
		t.Fatalf("expected 1 Rust-written account, got %d", len(accounts))
	}
	account := accounts[0]
	if account.Config.Name != "Rust 写的账号" || account.Config.Host != "imap.rust.example" || account.Config.SyncLimit != 25 {
		t.Fatalf("config mismatch: %+v", account.Config)
	}
	if account.Config.SyncIntervalMinutes != 0 {
		t.Fatalf("interval should be 0 (sync off): %d", account.Config.SyncIntervalMinutes)
	}
	if !account.HasPassword {
		t.Fatal("Rust-written credential not visible to Go")
	}
	password, err := ReadPassword(dir, account.Config.ID)
	if err != nil || password != "rust-secret-pass" {
		t.Fatalf("password: %q %v", password, err)
	}
}
