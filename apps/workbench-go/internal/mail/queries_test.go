package mail

import (
	"os"
	"path/filepath"
	"testing"
)

func TestListRejectedUsesCurrentValidityAndListImportedUsesMetadata(t *testing.T) {
	dir, err := os.MkdirTemp("", "kf-mail-query-")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(dir)
	config := Config{ID: "11111111-1111-4111-8111-111111111111", Name: "账号", Email: "demo@example.org", Host: "imap.example.org", Port: 993, Username: "demo", Folder: "INBOX", SyncLimit: 50}
	if _, err := SaveAccount(dir, config, "fixture"); err != nil {
		t.Fatal(err)
	}
	db, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec("UPDATE mail_accounts SET uid_validity = 42, last_uid = 7 WHERE id = ?", config.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("INSERT INTO mail_rejected (account_id,folder,uid_validity,uid,reason,rejected_at) VALUES (?1,'INBOX',42,9,'邮件大小超过导入上限',100), (?1,'INBOX',7,8,'旧时代记录',90)", config.ID); err != nil {
		t.Fatal(err)
	}
	rejected, err := ListRejected(dir, config.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(rejected) != 1 || rejected[0].UID != 9 || rejected[0].Reason != "邮件大小超过导入上限" || rejected[0].RejectedAt != 100 {
		t.Fatalf("rejected: %+v", rejected)
	}
	if _, err := db.Exec("CREATE TABLE materials (id TEXT PRIMARY KEY, source_type TEXT NOT NULL, title TEXT NOT NULL, source_url TEXT, raw_text TEXT NOT NULL, content_hash TEXT NOT NULL, metadata_json TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, is_deleted INTEGER NOT NULL DEFAULT 0)"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("INSERT INTO materials (id,source_type,title,source_url,raw_text,content_hash,metadata_json,created_at,updated_at) VALUES ('m1','email','邮件一','https://example.org/1','正文','hash',?,1,1)", `{"mailAccountId":"`+config.ID+`"}`); err != nil {
		t.Fatal(err)
	}
	imported, err := ListImported(dir, config.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(imported) != 1 || imported[0].ID != "m1" || imported[0].Title != "邮件一" {
		t.Fatalf("imported: %+v", imported)
	}
	_ = filepath.Join
}
