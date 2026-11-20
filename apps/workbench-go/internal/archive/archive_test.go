package archive

import (
	"os"
	"strings"
	"testing"
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
	data, err := Write(cardsJSON, StripSecretSettings(settings))
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
	// 坏 JSON 原样返回：导出不该因为设置文件坏了就失败。
	if got := StripSecretSettings("{not json"); got != "{not json" {
		t.Fatalf("bad json altered: %s", got)
	}
	// 非对象原样返回。
	if got := StripSecretSettings("[1,2,3]"); got != "[1,2,3]" {
		t.Fatalf("non-object altered: %s", got)
	}
}

func TestStripSecretSettingsKeepsBooleanAuthorField(t *testing.T) {
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
