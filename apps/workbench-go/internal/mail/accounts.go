package mail

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

// Schema 与 Rust 的 ensure_schema 逐条一致：账号表、去重账本、拒收记录、同步游标。
// 每次调用都建表，因此本模块不需要改动别处的建表代码。
const schema = `
CREATE TABLE IF NOT EXISTS mail_accounts (
    id            TEXT PRIMARY KEY,
    config_json   TEXT NOT NULL,
    created_at    INTEGER NOT NULL DEFAULT 0,
    last_sync_at  INTEGER,
    last_error    TEXT,
    uid_validity  INTEGER,
    last_uid      INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS mail_imports (
    account_id   TEXT NOT NULL,
    folder       TEXT NOT NULL,
    uid_validity INTEGER NOT NULL,
    uid          INTEGER NOT NULL,
    message_id   TEXT NOT NULL DEFAULT '',
    material_id  TEXT NOT NULL,
    PRIMARY KEY (account_id, folder, uid_validity, uid)
);
DROP INDEX IF EXISTS idx_mail_imports_message;
CREATE INDEX IF NOT EXISTS idx_mail_imports_message_lookup
    ON mail_imports(account_id, folder, message_id)
    WHERE message_id <> '';
CREATE TABLE IF NOT EXISTS mail_rejected (
    account_id   TEXT NOT NULL,
    folder       TEXT NOT NULL,
    uid_validity INTEGER NOT NULL,
    uid          INTEGER NOT NULL,
    reason       TEXT NOT NULL DEFAULT '',
    rejected_at  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (account_id, folder, uid_validity, uid)
);
CREATE TABLE IF NOT EXISTS mail_sync_state (
    account_id       TEXT PRIMARY KEY,
    history_before   INTEGER,
    history_complete INTEGER NOT NULL DEFAULT 0,
    last_attempt_at  INTEGER
);
INSERT OR IGNORE INTO mail_sync_state(account_id,history_before)
    SELECT a.id, CASE WHEN a.uid_validity IS NULL THEN NULL ELSE
        COALESCE((SELECT MIN(uid) FROM (
            SELECT uid FROM mail_imports WHERE account_id=a.id AND uid_validity=a.uid_validity
            UNION ALL
            SELECT uid FROM mail_rejected WHERE account_id=a.id AND uid_validity=a.uid_validity
        )), NULLIF(a.last_uid,0)) END
    FROM mail_accounts a;
`

// Account 是列表里的一条账号；密码永不返回，只说有没有。
type Account struct {
	Config          Config  `json:"config"`
	LastSyncAt      *int64  `json:"lastSyncAt"`
	LastError       *string `json:"lastError"`
	HasPassword     bool    `json:"hasPassword"`
	HistoryComplete bool    `json:"historyComplete"`
	RejectedCount   int     `json:"rejectedCount"`
	LastAttemptAt   *int64  `json:"lastAttemptAt"`
}

const accountColumns = "SELECT a.config_json,a.last_sync_at,a.last_error,COALESCE(s.history_complete,0)," +
	" (SELECT COUNT(*) FROM mail_rejected r WHERE r.account_id=a.id AND r.uid_validity=a.uid_validity)," +
	" s.last_attempt_at FROM mail_accounts a LEFT JOIN mail_sync_state s ON s.account_id=a.id"

// Open 打开库并确保邮箱表存在（与 Rust 的 open 同义：busy_timeout 10 秒）。
func Open(dir string) (*sql.DB, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, errors.New("无法创建资料库目录")
	}
	uri, err := databaseURI(filepath.Join(dir, "knowflick.db"))
	if err != nil {
		return nil, err
	}
	uri.RawQuery = "mode=rwc&_pragma=busy_timeout(10000)"
	db, err := sql.Open("sqlite", uri.String())
	if err != nil {
		return nil, errors.New("无法打开资料库")
	}
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(schema); err != nil {
		db.Close()
		return nil, errors.New("邮箱数据表结构初始化失败")
	}
	return db, nil
}

// ListAccounts 列出全部账号，按创建时间与 id 排序；密码只说有没有。
func ListAccounts(dir string) ([]Account, error) {
	db, err := Open(dir)
	if err != nil {
		return nil, err
	}
	defer db.Close()
	rows, err := db.Query(accountColumns + " ORDER BY a.created_at,a.id")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	accounts := make([]Account, 0)
	for rows.Next() {
		account, err := scanAccount(rows)
		if err != nil {
			return nil, err
		}
		_, passwordErr := ReadPassword(dir, account.Config.ID)
		account.HasPassword = passwordErr == nil
		accounts = append(accounts, account)
	}
	return accounts, rows.Err()
}

func scanAccount(rows *sql.Rows) (Account, error) {
	var raw string
	var account Account
	if err := rows.Scan(&raw, &account.LastSyncAt, &account.LastError, &account.HistoryComplete, &account.RejectedCount, &account.LastAttemptAt); err != nil {
		return Account{}, err
	}
	if err := json.Unmarshal([]byte(raw), &account.Config); err != nil {
		return Account{}, errors.New("无法解析已保存的邮箱账号")
	}
	return account, nil
}

// GetAccount 读单个账号；不存在时返回 nil, nil。
func GetAccount(dir, id string) (*Account, error) {
	if err := ValidID(id); err != nil {
		return nil, err
	}
	db, err := Open(dir)
	if err != nil {
		return nil, err
	}
	defer db.Close()
	rows, err := db.Query(accountColumns+" WHERE a.id=?1", id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	if !rows.Next() {
		return nil, rows.Err()
	}
	account, err := scanAccount(rows)
	if err != nil {
		return nil, err
	}
	_, passwordErr := ReadPassword(dir, account.Config.ID)
	account.HasPassword = passwordErr == nil
	return &account, nil
}

// SaveAccount 存账号。空密码沿用已存的；新账号或换了服务器/用户名必须重输密码。
// 换了 host/port/username/folder 时清空去重账本与游标——不同邮箱会复用同一对
// (UIDVALIDITY, UID)，不清会让无关邮件被静默跳过。
func SaveAccount(dir string, config Config, password string) (*Account, error) {
	validated, err := Validate(config)
	if err != nil {
		return nil, err
	}
	db, err := Open(dir)
	if err != nil {
		return nil, err
	}
	defer db.Close()

	var storedRaw string
	err = db.QueryRow("SELECT config_json FROM mail_accounts WHERE id=?1", validated.ID).Scan(&storedRaw)
	hasStored := err == nil
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	var previous Config
	if hasStored {
		if err := json.Unmarshal([]byte(storedRaw), &previous); err != nil {
			return nil, errors.New("无法解析已保存的邮箱账号")
		}
	}

	if password == "" {
		if !hasStored {
			return nil, errors.New("新账号需要输入密码")
		}
		if previous.Host != validated.Host || previous.Port != validated.Port || previous.Username != validated.Username {
			return nil, errors.New("更换服务器或用户名时需要重新输入密码")
		}
		if _, err := ReadPassword(dir, validated.ID); err != nil {
			return nil, err
		}
	} else if err := WritePassword(dir, validated.ID, password); err != nil {
		return nil, err
	}

	identityChanged := hasStored && (previous.Host != validated.Host || previous.Port != validated.Port ||
		previous.Username != validated.Username || previous.Folder != validated.Folder)
	raw, err := json.Marshal(validated)
	if err != nil {
		return nil, errors.New("无法编码邮箱账号")
	}
	tx, err := db.Begin()
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	if identityChanged {
		for _, table := range []string{"mail_imports", "mail_rejected", "mail_sync_state"} {
			if _, err := tx.Exec("DELETE FROM "+table+" WHERE account_id=?1", validated.ID); err != nil {
				return nil, err
			}
		}
	}
	if _, err := tx.Exec(`INSERT INTO mail_accounts(id,config_json,created_at) VALUES(?1,?2,?3)
		ON CONFLICT(id) DO UPDATE SET
			config_json = excluded.config_json,
			last_error = NULL,
			last_sync_at = CASE WHEN ?4 THEN NULL ELSE mail_accounts.last_sync_at END,
			uid_validity = CASE WHEN ?4 THEN NULL ELSE mail_accounts.uid_validity END,
			last_uid = CASE WHEN ?4 THEN 0 ELSE mail_accounts.last_uid END`,
		validated.ID, string(raw), nowMillis(), identityChanged); err != nil {
		return nil, err
	}
	if _, err := tx.Exec("INSERT OR IGNORE INTO mail_sync_state(account_id) VALUES(?1)", validated.ID); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return GetAccount(dir, validated.ID)
}

// RemoveAccount 断开账号：删凭据与账号行。
// 已导入的素材与去重账本保留——重新加回同一账号不会重复导入。
func RemoveAccount(dir, id string) error {
	if err := ValidID(id); err != nil {
		return err
	}
	db, err := Open(dir)
	if err != nil {
		return err
	}
	defer db.Close()
	path, err := CredentialPath(dir, id)
	if err != nil {
		return err
	}
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return errors.New("凭据文件删不掉，请检查它的权限")
	}
	_, err = db.Exec("DELETE FROM mail_accounts WHERE id=?1", id)
	return err
}

func nowMillis() int64 { return time.Now().UnixMilli() }

func databaseURI(path string) (url.URL, error) {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return url.URL{}, err
	}
	slash := filepath.ToSlash(absolute)
	if !strings.HasPrefix(slash, "/") {
		slash = "/" + slash
	}
	return url.URL{Scheme: "file", Path: slash}, nil
}
