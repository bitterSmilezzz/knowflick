package mailstore

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"testing"

	_ "modernc.org/sqlite"
)

const schema = `
CREATE TABLE mail_accounts (
  id TEXT PRIMARY KEY, config_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL DEFAULT 0, last_sync_at INTEGER, last_error TEXT,
  uid_validity INTEGER, last_uid INTEGER NOT NULL DEFAULT 0);
CREATE TABLE mail_imports (
  account_id TEXT NOT NULL, folder TEXT NOT NULL, uid_validity INTEGER NOT NULL,
  uid INTEGER NOT NULL, message_id TEXT NOT NULL DEFAULT '', material_id TEXT NOT NULL,
  PRIMARY KEY (account_id, folder, uid_validity, uid));
CREATE TABLE mail_rejected (
  account_id TEXT NOT NULL, folder TEXT NOT NULL, uid_validity INTEGER NOT NULL,
  uid INTEGER NOT NULL, reason TEXT NOT NULL DEFAULT '', rejected_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, folder, uid_validity, uid));
CREATE TABLE mail_sync_state (
  account_id TEXT PRIMARY KEY, history_before INTEGER, history_complete INTEGER NOT NULL DEFAULT 0,
  last_attempt_at INTEGER);
`

func openStore(t *testing.T) (*Store, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "mail.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(schema); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("INSERT INTO mail_accounts(id) VALUES('acct-1')"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("INSERT INTO mail_sync_state(account_id) VALUES('acct-1')"); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return New(db), path
}

func TestBootstrapAlignsCursor(t *testing.T) {
	store, _ := openStore(t)
	ctx := context.Background()
	cursor, err := store.LoadCursor(ctx, "acct-1")
	if err != nil {
		t.Fatal(err)
	}
	if cursor.UIDValidity != nil || cursor.HistoryBefore != nil {
		t.Fatalf("fresh account should have no cursor: %+v", cursor)
	}
	if err := store.AlignBootstrap(ctx, "acct-1", 7, 100, false); err != nil {
		t.Fatal(err)
	}
	cursor, err = store.LoadCursor(ctx, "acct-1")
	if err != nil {
		t.Fatal(err)
	}
	if cursor.UIDValidity == nil || *cursor.UIDValidity != 7 {
		t.Fatalf("validity: %+v", cursor)
	}
	if cursor.LastUID != 99 {
		t.Fatalf("last_uid should be boundary-1: %d", cursor.LastUID)
	}
	if cursor.HistoryBefore == nil || *cursor.HistoryBefore != 100 {
		t.Fatalf("history_before: %+v", cursor)
	}
}

func TestAdvanceCursorIsMonotonic(t *testing.T) {
	store, _ := openStore(t)
	ctx := context.Background()
	if err := store.AlignBootstrap(ctx, "acct-1", 7, 100, false); err != nil {
		t.Fatal(err)
	}
	if err := store.AdvanceCursor(ctx, "acct-1", ModeNew, 150); err != nil {
		t.Fatal(err)
	}
	// 乱序或重放时给一个更小的 UID：游标必须保持 150，不能倒退。
	if err := store.AdvanceCursor(ctx, "acct-1", ModeNew, 120); err != nil {
		t.Fatal(err)
	}
	cursor, _ := store.LoadCursor(ctx, "acct-1")
	if cursor.LastUID != 150 {
		t.Fatalf("last_uid went backwards: %d", cursor.LastUID)
	}
	if err := store.AdvanceCursor(ctx, "acct-1", ModeHistory, 80); err != nil {
		t.Fatal(err)
	}
	// History 给一个更大的 UID 也不能把边界往上抬。
	if err := store.AdvanceCursor(ctx, "acct-1", ModeHistory, 90); err != nil {
		t.Fatal(err)
	}
	before, err := store.LoadHistoryBefore(ctx, "acct-1")
	if err != nil {
		t.Fatal(err)
	}
	if before != 80 {
		t.Fatalf("history_before moved the wrong way: %d", before)
	}
}

func TestKnownUIDRespectsRetryMode(t *testing.T) {
	store, _ := openStore(t)
	ctx := context.Background()
	if err := store.RecordRejected(ctx, "acct-1", "INBOX", 7, 42, "太大", 1000); err != nil {
		t.Fatal(err)
	}
	known, err := store.KnownUID(ctx, "acct-1", "INBOX", 7, 42, ModeNew)
	if err != nil || !known {
		t.Fatalf("rejected uid should be known in New mode: %v %v", known, err)
	}
	known, err = store.KnownUID(ctx, "acct-1", "INBOX", 7, 42, ModeRetry)
	if err != nil || known {
		t.Fatalf("rejected uid must not be known in Retry mode: %v %v", known, err)
	}
}

func TestRecordImportedClearsRejection(t *testing.T) {
	store, _ := openStore(t)
	ctx := context.Background()
	if err := store.RecordRejected(ctx, "acct-1", "INBOX", 7, 42, "太大", 1000); err != nil {
		t.Fatal(err)
	}
	if err := store.RecordImported(ctx, "acct-1", "INBOX", 7, 42, "<m1@x>", "mail-abc"); err != nil {
		t.Fatal(err)
	}
	rejected, err := store.RejectedUIDs(ctx, "acct-1", "INBOX", 7, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(rejected) != 0 {
		t.Fatalf("rejection should be cleared after import: %v", rejected)
	}
	materialID, ok, err := store.ExistingMaterial(ctx, "acct-1", "INBOX", "<m1@x>")
	if err != nil || !ok || materialID != "mail-abc" {
		t.Fatalf("existing material: %q %v %v", materialID, ok, err)
	}
}

func TestSameMessageIDReusesMaterialAcrossUids(t *testing.T) {
	store, _ := openStore(t)
	ctx := context.Background()
	if err := store.RecordImported(ctx, "acct-1", "INBOX", 7, 42, "<same@x>", "mail-same"); err != nil {
		t.Fatal(err)
	}
	// UIDVALIDITY 翻滚后同一封邮件有新 UID：账本多一行，但素材仍是同一个。
	materialID, ok, err := store.ExistingMaterial(ctx, "acct-1", "INBOX", "<same@x>")
	if err != nil || !ok || materialID != "mail-same" {
		t.Fatalf("material: %q %v %v", materialID, ok, err)
	}
	if err := store.RecordImported(ctx, "acct-1", "INBOX", 8, 1, "<same@x>", materialID); err != nil {
		t.Fatal(err)
	}
	var rows int
	if err := store.DB.QueryRow("SELECT COUNT(*) FROM mail_imports").Scan(&rows); err != nil {
		t.Fatal(err)
	}
	if rows != 2 {
		t.Fatalf("ledger should keep both uids: %d", rows)
	}
}

func TestFinishAndFail(t *testing.T) {
	store, _ := openStore(t)
	ctx := context.Background()
	if err := store.MarkAttempt(ctx, "acct-1", 500); err != nil {
		t.Fatal(err)
	}
	if err := store.Fail(ctx, "acct-1", "连接断了"); err != nil {
		t.Fatal(err)
	}
	var lastError string
	if err := store.DB.QueryRow("SELECT last_error FROM mail_accounts WHERE id='acct-1'").Scan(&lastError); err != nil {
		t.Fatal(err)
	}
	if lastError != "连接断了" {
		t.Fatalf("last_error: %q", lastError)
	}
	if err := store.Finish(ctx, "acct-1", true, 1000); err != nil {
		t.Fatal(err)
	}
	var lastSync sql.NullInt64
	if err := store.DB.QueryRow("SELECT last_sync_at FROM mail_accounts WHERE id='acct-1'").Scan(&lastSync); err != nil {
		t.Fatal(err)
	}
	if !lastSync.Valid || lastSync.Int64 != 1000 {
		t.Fatalf("last_sync_at: %+v", lastSync)
	}
	// Finish 必须清空错误。清空是写成 NULL（与 Rust 的 last_error=NULL 一致），
	// 所以这里必须用 NullString 接——用 string 接会报「converting NULL」。
	var cleared sql.NullString
	if err := store.DB.QueryRow("SELECT last_error FROM mail_accounts WHERE id='acct-1'").Scan(&cleared); err != nil {
		t.Fatal(err)
	}
	if cleared.Valid {
		t.Fatalf("last_error should be NULL after Finish, got %q", cleared.String)
	}
}

// TestExportStoreFixture 导出 Go 写的账本库，供 Rust 读回对拍。
func TestExportStoreFixture(t *testing.T) {
	target := os.Getenv("KF_GO_STORE_DB")
	if target == "" {
		t.Skip("set KF_GO_STORE_DB to export the ledger database")
	}
	store := openStoreAt(t, target)
	ctx := context.Background()
	if err := store.AlignBootstrap(ctx, "acct-1", 7, 100, false); err != nil {
		t.Fatal(err)
	}
	if err := store.RecordImported(ctx, "acct-1", "INBOX", 7, 42, "<ledger@x>", "mail-ledger"); err != nil {
		t.Fatal(err)
	}
	if err := store.RecordRejected(ctx, "acct-1", "INBOX", 7, 43, "邮件大小超过导入上限", 1000); err != nil {
		t.Fatal(err)
	}
	if err := store.AdvanceCursor(ctx, "acct-1", ModeNew, 42); err != nil {
		t.Fatal(err)
	}
}

func openStoreAt(t *testing.T, path string) *Store {
	t.Helper()
	if _, err := os.Lstat(path); !os.IsNotExist(err) {
		t.Fatalf("fixture must be a new file: %v", err)
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(schema); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("INSERT INTO mail_accounts(id) VALUES('acct-1')"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("INSERT INTO mail_sync_state(account_id) VALUES('acct-1')"); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return New(db)
}
