package libfiles

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSaveCardsRotatesThreeGenerations(t *testing.T) {
	dir := t.TempDir()
	// 第一次保存：只有主文件，没有备份。
	if err := SaveCards(dir, "v1"); err != nil {
		t.Fatal(err)
	}
	if err := SaveCards(dir, "v2"); err != nil {
		t.Fatal(err)
	}
	if err := SaveCards(dir, "v3"); err != nil {
		t.Fatal(err)
	}
	assertContent(t, dir, "cards.json", "v3")
	assertContent(t, dir, "cards.backup.json", "v2")
	assertContent(t, dir, "cards.backup.2.json", "v1")
	// 第四次：二代被一代顶掉。
	if err := SaveCards(dir, "v4"); err != nil {
		t.Fatal(err)
	}
	assertContent(t, dir, "cards.json", "v4")
	assertContent(t, dir, "cards.backup.json", "v3")
	assertContent(t, dir, "cards.backup.2.json", "v2")
	// 轮转后不该多出临时文件。
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 3 {
		t.Fatalf("unexpected files after rotation: %d", len(entries))
	}
}

func TestReadReturnsNilForMissingFiles(t *testing.T) {
	dir := t.TempDir()
	files, err := Read(dir)
	if err != nil {
		t.Fatal(err)
	}
	if files.Cards != nil || files.Backup != nil || files.Backup2 != nil || files.Settings != nil || files.SearchHistory != nil {
		t.Fatalf("missing files should be nil: %+v", files)
	}
	if value, err := ReadImportReport(dir); err != nil || value != nil {
		t.Fatalf("missing report: %v %v", value, err)
	}
}

func TestSaveSettingsAndReportRoundTrip(t *testing.T) {
	dir := t.TempDir()
	if err := SaveSettings(dir, `{"theme":"dark"}`); err != nil {
		t.Fatal(err)
	}
	if err := SaveSearchHistory(dir, `["a","b"]`); err != nil {
		t.Fatal(err)
	}
	if err := SaveImportReport(dir, `{"imported":3}`); err != nil {
		t.Fatal(err)
	}
	files, err := Read(dir)
	if err != nil {
		t.Fatal(err)
	}
	if files.Settings == nil || *files.Settings != `{"theme":"dark"}` {
		t.Fatalf("settings: %v", files.Settings)
	}
	if files.SearchHistory == nil || *files.SearchHistory != `["a","b"]` {
		t.Fatalf("search history: %v", files.SearchHistory)
	}
	report, err := ReadImportReport(dir)
	if err != nil || report == nil || *report != `{"imported":3}` {
		t.Fatalf("report: %v %v", report, err)
	}
}

func TestSaveCardsDoesNotCorruptOnFailurePath(t *testing.T) {
	// 主文件在轮转过程中始终可用：即使只保存过一次，cards.json 也必须是完整内容。
	dir := t.TempDir()
	if err := SaveCards(dir, "only-once"); err != nil {
		t.Fatal(err)
	}
	assertContent(t, dir, "cards.json", "only-once")
	if _, err := os.Stat(filepath.Join(dir, "cards.backup.json")); !os.IsNotExist(err) {
		t.Fatal("first save must not create a backup")
	}
}

func assertContent(t *testing.T, dir, name, want string) {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(dir, name))
	if err != nil {
		t.Fatalf("%s: %v", name, err)
	}
	if string(data) != want {
		t.Fatalf("%s = %q, want %q", name, data, want)
	}
}

// TestExportCardsRotationFixture 写出 Go 的三代轮转结果，供 Rust 读回对拍。
func TestExportCardsRotationFixture(t *testing.T) {
	dir := os.Getenv("KF_GO_CARDS_DIR")
	if dir == "" {
		t.Skip("set KF_GO_CARDS_DIR to export the cards rotation fixture")
	}
	for _, text := range []string{"go-v1", "go-v2", "go-v3"} {
		if err := SaveCards(dir, text); err != nil {
			t.Fatal(err)
		}
	}
	if err := SaveSettings(dir, `{"theme":"dark"}`); err != nil {
		t.Fatal(err)
	}
}

// TestReadRustCardsRotation 读 Rust 写的三代轮转。
func TestReadRustCardsRotation(t *testing.T) {
	dir := os.Getenv("KF_RUST_CARDS_DIR")
	if dir == "" {
		t.Skip("set KF_RUST_CARDS_DIR to the Rust-written card files")
	}
	files, err := Read(dir)
	if err != nil {
		t.Fatal(err)
	}
	if files.Cards == nil || *files.Cards != "rust-v3" {
		t.Fatalf("main: %v", files.Cards)
	}
	if files.Backup == nil || *files.Backup != "rust-v2" {
		t.Fatalf("backup: %v", files.Backup)
	}
	if files.Backup2 == nil || *files.Backup2 != "rust-v1" {
		t.Fatalf("backup2: %v", files.Backup2)
	}
	if files.Settings == nil || *files.Settings != `{"theme":"light"}` {
		t.Fatalf("settings: %v", files.Settings)
	}
}
