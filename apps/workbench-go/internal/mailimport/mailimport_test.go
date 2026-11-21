package mailimport

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func testAccount() Account {
	return Account{ID: "acct-1", Host: "imap.example.com", Port: 993, Username: "me@example.com", Email: "me@example.com", Folder: "INBOX"}
}

func TestIdentityPrefersMessageID(t *testing.T) {
	a := Identity(testAccount(), 7, 42, "<m1@x>")
	b := Identity(testAccount(), 7, 43, "<m1@x>")
	if a != b {
		t.Fatal("same Message-ID with different UID must share identity")
	}
	c := Identity(testAccount(), 8, 42, "<m2@x>")
	if a == c {
		t.Fatal("different Message-ID must not share identity")
	}
}

func TestIdentityFallsBackToUidTriple(t *testing.T) {
	a := Identity(testAccount(), 7, 42, "  ")
	b := Identity(testAccount(), 7, 43, "")
	if a == b {
		t.Fatal("different UID without Message-ID must not collide")
	}
	if !strings.Contains(a, "uid:7:42") {
		t.Fatalf("uid triple missing: %s", a)
	}
}

func TestIdentityIsScopedToAccountAndFolder(t *testing.T) {
	base := testAccount()
	other := base
	other.Folder = "Archive"
	if Identity(base, 7, 42, "<m1@x>") == Identity(other, 7, 42, "<m1@x>") {
		t.Fatal("different folders must not share identity")
	}
	otherHost := base
	otherHost.Host = "imap.other.com"
	if Identity(base, 7, 42, "<m1@x>") == Identity(otherHost, 7, 42, "<m1@x>") {
		t.Fatal("different hosts must not share identity")
	}
}

func TestMaterialIDIsStableAndPrefixed(t *testing.T) {
	id := MaterialID("identity")
	if !strings.HasPrefix(id, "mail-") || len(id) != len("mail-")+32 {
		t.Fatalf("unexpected id: %s", id)
	}
	if id != MaterialID("identity") {
		t.Fatal("id is not deterministic")
	}
	if id == MaterialID("other") {
		t.Fatal("different identities collided")
	}
}

func TestFromMailFillsChinesePlaceholders(t *testing.T) {
	material, err := FromMail(testAccount(), 7, 42, Mail{MessageID: "<m1@x>"}, 1000)
	if err != nil {
		t.Fatal(err)
	}
	if material.Title != "（无主题）" {
		t.Fatalf("title placeholder: %q", material.Title)
	}
	if material.RawText != "（这封邮件没有可读的正文，可能只有附件）" {
		t.Fatalf("body placeholder: %q", material.RawText)
	}
	if material.SourceType != "email" || material.InboxStatus != "inbox" {
		t.Fatalf("classification: %+v", material)
	}
}

func TestFromMailKeepsSubjectBodyAndMetadata(t *testing.T) {
	mail := Mail{
		Subject: "周报", MessageID: "<m1@x>", From: "a@x", To: "b@x", Date: "Mon, 1 Jan 2026 00:00:00 +0000",
		Text: "正文内容", Attachments: []string{"报告.pdf"}, OriginalSize: 1234,
	}
	material, err := FromMail(testAccount(), 7, 42, mail, 1000)
	if err != nil {
		t.Fatal(err)
	}
	if material.Title != "周报" || material.RawText != "正文内容" {
		t.Fatalf("content: %+v", material)
	}
	var metadata Metadata
	if err := json.Unmarshal([]byte(material.MetadataJSON), &metadata); err != nil {
		t.Fatal(err)
	}
	if metadata.MailAccountID != "acct-1" || metadata.UID != 42 || metadata.UIDValidity != 7 {
		t.Fatalf("metadata: %+v", metadata)
	}
	if len(metadata.AttachmentFilenames) != 1 || metadata.AttachmentFilenames[0] != "报告.pdf" {
		t.Fatalf("attachments: %+v", metadata.AttachmentFilenames)
	}
	if metadata.OriginalSizeBytes != 1234 {
		t.Fatalf("size: %d", metadata.OriginalSizeBytes)
	}
	if MessageIDOf(material.MetadataJSON) != "<m1@x>" {
		t.Fatalf("message id round trip: %q", MessageIDOf(material.MetadataJSON))
	}
}

func TestFromMailIsDeterministic(t *testing.T) {
	mail := Mail{Subject: "x", MessageID: "<m@x>", Text: "y"}
	a, _ := FromMail(testAccount(), 7, 42, mail, 1000)
	b, _ := FromMail(testAccount(), 7, 99, mail, 2000)
	if a.ID != b.ID {
		t.Fatalf("same Message-ID must map to the same material id: %s vs %s", a.ID, b.ID)
	}
}

// TestExportMaterialFixture 导出 Go 的素材映射结论，供 Rust 对拍。
func TestExportMaterialFixture(t *testing.T) {
	target := os.Getenv("KF_GO_MATERIAL_FIXTURE")
	if target == "" {
		t.Skip("set KF_GO_MATERIAL_FIXTURE to export the material fixture")
	}
	material, err := FromMail(testAccount(), 7, 42, Mail{MessageID: "<m1@x>"}, 1000)
	if err != nil {
		t.Fatal(err)
	}
	lines := []string{
		"material_id=" + material.ID,
		"title=" + material.Title,
		"text=" + material.RawText,
	}
	if err := os.WriteFile(target, []byte(strings.Join(lines, "\n")), 0644); err != nil {
		t.Fatal(err)
	}
}
