package main

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestReadTextFileUTF8AndLimits(t *testing.T) {
	service, _ := openFixtureCopy(t)
	dir := t.TempDir()
	path := filepath.Join(dir, "note.md")
	contents := "# 标题\n\n正文\n"
	if err := os.WriteFile(path, []byte(contents), 0600); err != nil {
		t.Fatal(err)
	}
	text, err := service.ReadTextFile(t.Context(), path)
	if err != nil || text != contents {
		t.Fatalf("read text: %q, %v", text, err)
	}
	invalid := filepath.Join(dir, "invalid.txt")
	if err := os.WriteFile(invalid, []byte{0xff, 0xfe, 0x00}, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := service.ReadTextFile(t.Context(), invalid); err == nil || !strings.Contains(err.Error(), "UTF-8") {
		t.Fatalf("invalid utf8: %v", err)
	}
	large := filepath.Join(dir, "large.txt")
	if err := os.WriteFile(large, nil, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Truncate(large, maxTextImportBytes+1); err != nil {
		t.Fatal(err)
	}
	if _, err := service.ReadTextFile(t.Context(), large); err == nil || !strings.Contains(err.Error(), "32 MiB") {
		t.Fatalf("oversized text: %v", err)
	}
}

func TestE2EEServiceRoundTrip(t *testing.T) {
	service, _ := openFixtureCopy(t)
	plain := []byte("备份内容 with ASCII")
	encoded := base64.StdEncoding.EncodeToString(plain)
	blob, err := service.E2EEEncrypt(t.Context(), "口令-pass", encoded)
	if err != nil {
		t.Fatal(err)
	}
	back, err := service.E2EEDecrypt(t.Context(), "口令-pass", blob)
	if err != nil || back != encoded {
		t.Fatalf("decrypted: %q, %v", back, err)
	}
	if _, err := service.E2EEDecrypt(t.Context(), "wrong", blob); err == nil {
		t.Fatal("wrong passphrase accepted")
	}
	if _, err := service.E2EEEncrypt(t.Context(), "", encoded); err == nil {
		t.Fatal("empty passphrase accepted")
	}
	if _, err := service.E2EEEncrypt(t.Context(), "x", "not-base64"); err == nil {
		t.Fatal("invalid base64 accepted")
	}
}

func TestWebDAVCredentialRoundTrip(t *testing.T) {
	service, _ := openFixtureCopy(t)
	ctx := t.Context()
	value, err := service.ReadWebDAVCredential(ctx, 1)
	if err != nil || value != "" {
		t.Fatalf("empty credential: %q, %v", value, err)
	}
	if err := service.WriteWebDAVCredential(ctx, 1, "s3cret"); err != nil {
		t.Fatal(err)
	}
	value, err = service.ReadWebDAVCredential(ctx, 1)
	if err != nil || value != "s3cret" {
		t.Fatalf("stored credential: %q, %v", value, err)
	}
	if _, err := service.ReadWebDAVCredential(ctx, 99); err == nil {
		t.Fatal("stale generation accepted")
	}
	if err := service.WriteWebDAVCredential(ctx, 99, "x"); err == nil {
		t.Fatal("stale write accepted")
	}
}
