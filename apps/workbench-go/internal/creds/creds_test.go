package creds

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestFileRules(t *testing.T) {
	// 库名为 store：凭据放父目录——库目录可能被整体替换。
	got := File("/data/knowflick/store", "apiKey.credential")
	want := "/data/knowflick/credentials/apiKey.credential"
	if filepath.Clean(got) != filepath.Clean(want) {
		t.Fatalf("store dir: got %s want %s", got, want)
	}
	// 其它库名：凭据放库目录内。
	got = File("/data/mylib", "webdav.credential")
	want = "/data/mylib/credentials/webdav.credential"
	if filepath.Clean(got) != filepath.Clean(want) {
		t.Fatalf("other dir: got %s want %s", got, want)
	}
	if filepath.Base(APIKey("/x")) != APIKeyFile {
		t.Fatalf("api key name: %s", APIKey("/x"))
	}
}

func TestReadMissingReturnsEmptyNotError(t *testing.T) {
	value, err := Read(t.TempDir(), "apiKey.credential")
	if err != nil {
		t.Fatalf("missing credential must not be an error: %v", err)
	}
	if value != "" {
		t.Fatalf("missing credential should read as empty, got %q", value)
	}
}

func TestWriteRoundTripAndPermissions(t *testing.T) {
	dir := t.TempDir()
	if err := Write(dir, "apiKey.credential", "sk-secret"); err != nil {
		t.Fatal(err)
	}
	path := File(dir, "apiKey.credential")
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
	value, err := Read(dir, "apiKey.credential")
	if err != nil || value != "sk-secret" {
		t.Fatalf("round trip: %q %v", value, err)
	}
	// 原子写不留临时文件。
	entries, err := os.ReadDir(filepath.Dir(path))
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if strings.HasSuffix(entry.Name(), ".tmp") {
			t.Fatalf("tmp left behind: %s", entry.Name())
		}
	}
}

func TestWriteAPIKeyUsesSameRules(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "store")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := WriteAPIKey(dir, "key"); err != nil {
		t.Fatal(err)
	}
	path := APIKey(dir)
	if filepath.Base(filepath.Dir(filepath.Dir(path))) != "knowflick-parent-not-store" {
		// store 目录：凭据应在父目录的 credentials/ 下。
		if filepath.Base(filepath.Dir(filepath.Dir(path))) != filepath.Base(filepath.Dir(dir)) {
			t.Fatalf("api key not in parent: %s", path)
		}
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("api key missing: %v", err)
	}
	info, _ := os.Stat(path)
	if perm := info.Mode().Perm(); perm != 0o600 {
		t.Fatalf("api key mode %o", perm)
	}
}

func TestAtomicWriteReplacesAtomically(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "settings.json")
	if err := AtomicWrite(path, []byte("first")); err != nil {
		t.Fatal(err)
	}
	if err := AtomicWrite(path, []byte("second")); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil || string(data) != "second" {
		t.Fatalf("replace: %q %v", data, err)
	}
	entries, _ := os.ReadDir(dir)
	if len(entries) != 1 {
		t.Fatalf("tmp leftovers: %d entries", len(entries))
	}
}

// TestExportCredentialFixture 写出 Go 的凭据文件，供 Rust 读回对拍。
func TestExportCredentialFixture(t *testing.T) {
	root := os.Getenv("KF_GO_CREDS_DIR")
	if root == "" {
		t.Skip("set KF_GO_CREDS_DIR to export the credential fixture")
	}
	storeDir := filepath.Join(root, "store")
	if err := os.MkdirAll(storeDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := WriteAPIKey(storeDir, "go-api-key-value"); err != nil {
		t.Fatal(err)
	}
	if err := Write(storeDir, "webdav.credential", "go-webdav-value"); err != nil {
		t.Fatal(err)
	}
}

// TestReadRustCredentialFixture 读 Rust 写的凭据。
func TestReadRustCredentialFixture(t *testing.T) {
	root := os.Getenv("KF_RUST_CREDS_DIR")
	if root == "" {
		t.Skip("set KF_RUST_CREDS_DIR to the Rust-written credential dir")
	}
	storeDir := filepath.Join(root, "store")
	apiKey, err := Read(storeDir, APIKeyFile)
	if err != nil {
		t.Fatal(err)
	}
	if apiKey != "rust-api-key-value" {
		t.Fatalf("api key: %q", apiKey)
	}
	webdav, err := Read(storeDir, "webdav.credential")
	if err != nil {
		t.Fatal(err)
	}
	if webdav != "rust-webdav-value" {
		t.Fatalf("webdav: %q", webdav)
	}
	// Go 侧统一 0600：读回时也要求凭据不可被他人读，避免「读进来又写出去时放宽」。
	path := File(storeDir, APIKeyFile)
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if perm := info.Mode().Perm(); perm&0o077 != 0 {
		t.Fatalf("credential must not be group/other readable, got %o", perm)
	}
}
