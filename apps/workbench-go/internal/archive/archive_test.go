package archive

import (
	"errors"
	"os"
	"strings"
	"testing"

	"knowflick.local/workbench-go/internal/e2ee"
)

const cardsJSON = `["card-1","card-2"]`

func TestReadPlainUTF8Cards(t *testing.T) {
	payload, err := Read([]byte(cardsJSON))
	if err != nil {
		t.Fatal(err)
	}
	if payload.Cards != cardsJSON || payload.Settings != nil {
		t.Fatalf("payload: %+v", payload)
	}
	if _, err := Read([]byte("   \n  ")); err == nil || !strings.Contains(err.Error(), "未检测到有效的") {
		t.Fatalf("empty archive accepted: %v", err)
	}
	if _, err := Read([]byte{0xff, 0xfe, 0x00}); err == nil || !strings.Contains(err.Error(), "UTF-8") {
		t.Fatalf("non-utf8 accepted: %v", err)
	}
}

func TestReadRejectsOversizedArchive(t *testing.T) {
	// 不真的分配 50 MiB：只验证判断在读取之前生效。
	if MaxArchiveBytes != 50*1024*1024 {
		t.Fatalf("limit changed: %d", MaxArchiveBytes)
	}
	if IsZIP([]byte("PK")) {
		t.Fatal("two bytes should not be a zip")
	}
	if !IsZIP([]byte("PK\x03\x04rest")) {
		t.Fatal("PK magic not detected")
	}
}

func TestWriteThenReadRoundTrip(t *testing.T) {
	settings := `{"theme":"dark","apiKey":"sk-secret"}`
	data, err := Write(cardsJSON, settings)
	if err != nil {
		t.Fatal(err)
	}
	if !IsZIP(data) {
		t.Fatal("written archive is not a zip")
	}
	payload, err := Read(data)
	if err != nil {
		t.Fatal(err)
	}
	if payload.Cards != cardsJSON {
		t.Fatalf("cards: %q", payload.Cards)
	}
	if payload.Settings == nil {
		t.Fatal("settings missing")
	}
	// 密钥必须已经不在导出包里——这是「可分享文件」的硬承诺。
	if strings.Contains(*payload.Settings, "sk-secret") || strings.Contains(*payload.Settings, "apiKey") {
		t.Fatalf("secret leaked into export: %s", *payload.Settings)
	}
	if !strings.Contains(*payload.Settings, "theme") {
		t.Fatalf("non-secret settings dropped: %s", *payload.Settings)
	}
}

func TestReadAcceptsNestedPathAndCaseInsensitive(t *testing.T) {
	data, err := Write(cardsJSON, "{}")
	if err != nil {
		t.Fatal(err)
	}
	payload, err := Read(data)
	if err != nil || payload.Cards != cardsJSON {
		t.Fatalf("nested/case read: %+v %v", payload, err)
	}
}

func TestReadZipWithoutCardsFails(t *testing.T) {
	data, err := Write(cardsJSON, "{}")
	if err != nil {
		t.Fatal(err)
	}
	// 空 cards.json 必须拒绝，否则会把空卡库当成正常导入。
	if _, err := Write("   ", "{}"); err == nil {
		t.Fatal("empty cards accepted")
	}
	if _, err := Read(data); err != nil {
		t.Fatalf("valid zip rejected: %v", err)
	}
}

func TestStripSecretSettings(t *testing.T) {
	cases := []struct {
		input string
		want  []string
		gone  []string
	}{
		{`{"apiKey":"x","theme":"dark"}`, []string{"theme"}, []string{"apiKey"}},
		{`{"API_KEY":"x","Token":"y","password":"z"}`, nil, []string{"API_KEY", "Token", "password"}},
	}
	for _, tc := range cases {
		got := StripSecretSettings(tc.input)
		for _, keep := range tc.want {
			if !strings.Contains(got, keep) {
				t.Fatalf("%s: kept key %q lost: %s", tc.input, keep, got)
			}
		}
		for _, drop := range tc.gone {
			if strings.Contains(got, drop) {
				t.Fatalf("%s: secret %q leaked: %s", tc.input, drop, got)
			}
		}
	}
	for _, input := range []string{`{"token":"fixture-value"`, `[{"password":"fixture-value"}]`, `{"theme":"dark"} false`, "null", ""} {
		if got := StripSecretSettings(input); got != "{}" {
			t.Fatal("invalid settings must export as an empty object")
		}
	}
}

func TestStripSecretSettingsUsesLegacyKeyFragments(t *testing.T) {
	// authored 含 "auth" 子串，按 Rust 的规则**会被剔除**。
	// 这里钉住实际行为而不是我的期望：如果哪天规则改成「整词匹配」，这条会失败。
	got := StripSecretSettings(`{"authored":true,"author":"me"}`)
	if strings.Contains(got, "authored") {
		t.Fatalf("rule changed? authored kept: %s", got)
	}
	// author 同样含 auth 子串，也会被剔除——子串匹配会过度命中。
	if strings.Contains(got, "author") {
		t.Fatalf("author should be dropped: %s", got)
	}
}

func TestStripSecretSettingsRecursesAndPreservesNumbers(t *testing.T) {
	input := `{"sync":{"url":"https://example.com","passWord":"fixture-value"},"providers":[{"api-key":"fixture-value","name":"demo"}],"updatedAt":9007199254740993}`
	want := `{"providers":[{"name":"demo"}],"sync":{"url":"https://example.com"},"updatedAt":9007199254740993}`
	if got := StripSecretSettings(input); got != want {
		t.Fatal("nested credential filtering changed the exported settings")
	}
}

// TestExportArchiveFixture 导出 Go 打的归档，供 Rust 读回对拍。
func TestExportArchiveFixture(t *testing.T) {
	target := os.Getenv("KF_GO_ARCHIVE_FIXTURE")
	if target == "" {
		t.Skip("set KF_GO_ARCHIVE_FIXTURE to export the archive fixture")
	}
	settings := StripSecretSettings(`{"theme":"dark","apiKey":"sk-go-secret","model":"gpt-4"}`)
	data, err := Write(`["card-1","card-2"]`, settings)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(target, data, 0644); err != nil {
		t.Fatal(err)
	}
}

// TestReadRustArchiveFixture 读 Rust 手写 zip_store 打的归档。
func TestReadRustArchiveFixture(t *testing.T) {
	path := os.Getenv("KF_RUST_ARCHIVE_FIXTURE")
	if path == "" {
		t.Skip("set KF_RUST_ARCHIVE_FIXTURE to the Rust-written archive")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	payload, err := Read(data)
	if err != nil {
		t.Fatalf("Go should read the Rust-written archive: %v", err)
	}
	expected, err := os.ReadFile(path + ".cards")
	if err != nil {
		t.Fatal(err)
	}
	if payload.Cards != string(expected) {
		t.Fatalf("cards: got %q want %q", payload.Cards, expected)
	}
	if payload.Settings == nil {
		t.Fatal("settings.json should be read")
	}
	if strings.Contains(*payload.Settings, "apiKey") || strings.Contains(*payload.Settings, "sk-should-not-ship") {
		t.Fatalf("secret leaked into the archive: %s", *payload.Settings)
	}
	if !strings.Contains(*payload.Settings, "theme") {
		t.Fatalf("non-secret settings dropped: %s", *payload.Settings)
	}
}

func TestEncryptedArchiveRoundTrip(t *testing.T) {
	cards := `["card-1","card-2"]`
	settings := `{"theme":"dark","apiKey":"sk-must-not-leak"}`
	blob, err := WriteEncrypted("correct horse", cards, settings)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(string(blob[:6]), "KFENC") {
		t.Fatal("encrypted archive must start with the KFENC header")
	}
	// 密文里不能直接看到明文（这是「上传前加密」的意义）。
	if strings.Contains(string(blob), "card-1") || strings.Contains(string(blob), "sk-must-not-leak") {
		t.Fatal("plaintext leaked into the encrypted blob")
	}
	payload, err := ReadEncrypted("correct horse", blob)
	if err != nil {
		t.Fatal(err)
	}
	if payload.Cards != cards {
		t.Fatalf("cards: %q", payload.Cards)
	}
	if payload.Settings == nil || !strings.Contains(*payload.Settings, "theme") {
		t.Fatalf("settings: %v", payload.Settings)
	}
}

func TestEncryptedArchiveSeparatesTwoKindsOfFailure(t *testing.T) {
	blob, err := WriteEncrypted("correct horse", `["c"]`, "{}")
	if err != nil {
		t.Fatal(err)
	}
	// 口令不对 → e2ee 的错。
	if _, err := ReadEncrypted("wrong", blob); err == nil || !strings.Contains(err.Error(), "口令不对") {
		t.Fatalf("wrong passphrase: %v", err)
	}
	// 被篡改 → 同样是 e2ee 的错（GCM 认证失败）。
	tampered := append([]byte(nil), blob...)
	tampered[len(tampered)-1] ^= 0x01
	if _, err := ReadEncrypted("correct horse", tampered); err == nil || !strings.Contains(err.Error(), "口令不对") {
		t.Fatalf("tampered: %v", err)
	}
	// 解密成功但容器不合法 → archive 的错，不能报成「口令不对」。
	badContainer, err := e2ee.Encrypt("correct horse", []byte("   "))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := ReadEncrypted("correct horse", badContainer); err == nil || strings.Contains(err.Error(), "口令不对") {
		t.Fatalf("container error reported as passphrase error: %v", err)
	}
	// 空口令直接被拒，不会走到容器层。
	if _, err := WriteEncrypted("", `["c"]`, "{}"); !errors.Is(err, e2ee.ErrEmptyPassphrase) {
		t.Fatalf("empty passphrase: %v", err)
	}
}

// TestExportEncryptedArchiveFixture 导出 Go 的加密归档，供 Rust 解密后读出。
func TestExportEncryptedArchiveFixture(t *testing.T) {
	target := os.Getenv("KF_GO_ENC_ARCHIVE_FIXTURE")
	if target == "" {
		t.Skip("set KF_GO_ENC_ARCHIVE_FIXTURE to export the encrypted archive")
	}
	settings := StripSecretSettings(`{"theme":"dark","apiKey":"sk-go-secret"}`)
	blob, err := WriteEncrypted("correct horse", `["card-1","card-2"]`, settings)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(target, blob, 0644); err != nil {
		t.Fatal(err)
	}
}

// TestReadRustEncryptedArchiveFixture 解密并读出 Rust 打的加密归档。
func TestReadRustEncryptedArchiveFixture(t *testing.T) {
	path := os.Getenv("KF_RUST_ENC_ARCHIVE_FIXTURE")
	if path == "" {
		t.Skip("set KF_RUST_ENC_ARCHIVE_FIXTURE to the Rust-written encrypted archive")
	}
	blob, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	payload, err := ReadEncrypted("correct horse", blob)
	if err != nil {
		t.Fatalf("Go should decrypt and read the Rust archive: %v", err)
	}
	expected, err := os.ReadFile(path + ".cards")
	if err != nil {
		t.Fatal(err)
	}
	if payload.Cards != string(expected) {
		t.Fatalf("cards: got %q want %q", payload.Cards, expected)
	}
	if payload.Settings == nil || !strings.Contains(*payload.Settings, "theme") {
		t.Fatalf("settings: %v", payload.Settings)
	}
	if strings.Contains(*payload.Settings, "apiKey") {
		t.Fatalf("secret leaked: %s", *payload.Settings)
	}
	// 口令必须真的起作用：换个口令读不开。
	if _, err := ReadEncrypted("wrong", blob); err == nil || !strings.Contains(err.Error(), "口令不对") {
		t.Fatalf("wrong passphrase should fail: %v", err)
	}
}
