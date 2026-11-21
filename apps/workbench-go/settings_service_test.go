package main

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"knowflick.local/workbench-go/internal/creds"
)

func openFixtureCopy(t *testing.T) (*PreviewService, string) {
	t.Helper()
	fixture := os.Getenv("KF_SYSTEM_BACKUP_DB_FIXTURE_DIR")
	if fixture == "" {
		t.Skip("set KF_SYSTEM_BACKUP_DB_FIXTURE_DIR to the Rust-created database fixture")
	}
	dir := t.TempDir()
	path := filepath.Join(dir, "knowflick.db")
	data, err := os.ReadFile(filepath.Join(fixture, "knowflick.db"))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	service := &PreviewService{initialPath: path, path: path}
	t.Cleanup(func() { _ = service.ServiceShutdown() })
	if _, err := service.OpenInitialLibrary(context.Background()); err != nil {
		t.Fatal(err)
	}
	return service, dir
}

func TestSettingsSearchHistoryAndImportReportRoundTrip(t *testing.T) {
	service, _ := openFixtureCopy(t)
	ctx := context.Background()
	generation := 1
	settings, err := service.ReadSettings(ctx, generation)
	if err != nil || settings != "" {
		t.Fatalf("empty settings: %q, %v", settings, err)
	}
	if err := service.SaveSettings(ctx, generation, "{\"soundEffectsEnabled\":false}"); err != nil {
		t.Fatal(err)
	}
	if settings, err = service.ReadSettings(ctx, generation); err != nil || !strings.Contains(settings, "soundEffectsEnabled") {
		t.Fatalf("settings round trip: %q, %v", settings, err)
	}
	if history, err := service.ReadSearchHistory(ctx, generation); err != nil || history != "" {
		t.Fatalf("empty history: %q, %v", history, err)
	}
	if err := service.SaveSearchHistory(ctx, generation, "[\"向量检索\"]"); err != nil {
		t.Fatal(err)
	}
	if history, err := service.ReadSearchHistory(ctx, generation); err != nil || !strings.Contains(history, "向量检索") {
		t.Fatalf("history round trip: %q, %v", history, err)
	}
	if report, err := service.ReadImportReport(ctx, generation); err != nil || report != nil {
		t.Fatalf("missing report: %v, %v", report, err)
	}
	if err := service.SaveImportReport(ctx, generation, "{\"imported\":3}"); err != nil {
		t.Fatal(err)
	}
	report, err := service.ReadImportReport(ctx, generation)
	if err != nil || report == nil || !strings.Contains(*report, "imported") {
		t.Fatalf("report round trip: %v, %v", report, err)
	}
	if _, err := service.ReadSettings(ctx, 999); err == nil {
		t.Fatal("stale generation accepted")
	}
}

func TestAPIKeyIsPrivateAndSignatureTracksContent(t *testing.T) {
	service, dir := openFixtureCopy(t)
	ctx := context.Background()
	generation := 1
	if key, err := service.ReadAPIKey(ctx, generation); err != nil || key != "" {
		t.Fatalf("empty key: %q, %v", key, err)
	}
	if err := service.WriteAPIKey(ctx, generation, "sk-demo"); err != nil {
		t.Fatal(err)
	}
	if key, err := service.ReadAPIKey(ctx, generation); err != nil || key != "sk-demo" {
		t.Fatalf("key round trip: %q, %v", key, err)
	}
	info, err := os.Stat(creds.APIKey(dir))
	if err != nil {
		t.Fatal(err)
	}
	if perm := info.Mode().Perm(); perm&0o077 != 0 {
		t.Fatalf("api key permissions too open: %o", perm)
	}
	first, err := service.LibrarySignature(ctx, generation)
	if err != nil {
		t.Fatal(err)
	}
	parts := strings.Split(first, "|")
	if len(parts) != 3 || !strings.HasPrefix(parts[0], "knowflick.db:") || len(strings.SplitN(parts[0], ":", 2)[1]) != 16 {
		t.Fatalf("signature: %q", first)
	}
	if !strings.HasSuffix(parts[1], ":-") || !strings.HasSuffix(parts[2], ":-") {
		t.Fatalf("missing files should be '-': %q", first)
	}
	if err := service.SaveSettings(ctx, generation, "{}"); err != nil {
		t.Fatal(err)
	}
	second, err := service.LibrarySignature(ctx, generation)
	if err != nil || second == first {
		t.Fatalf("signature did not change with settings: %q -> %q, %v", first, second, err)
	}
	if strings.Split(second, "|")[2] == "settings.json:-" {
		t.Fatalf("settings fingerprint missing: %q", second)
	}
}
