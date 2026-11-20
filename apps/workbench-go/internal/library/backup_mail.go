package library

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"

	"knowflick.local/workbench-go/internal/mail"
)

type backupMailAccount struct {
	Config      mail.Config `json:"config"`
	CreatedAt   int64       `json:"createdAt"`
	LastSyncAt  *int64      `json:"lastSyncAt"`
	UIDValidity *int64      `json:"uidValidity"`
	LastUID     int64       `json:"lastUid"`
}

type backupMailSyncState struct {
	AccountID       string `json:"accountId"`
	HistoryBefore   *int64 `json:"historyBefore"`
	HistoryComplete bool   `json:"historyComplete"`
	LastAttemptAt   *int64 `json:"lastAttemptAt"`
}

type backupMailImport struct {
	AccountID   string `json:"accountId"`
	Folder      string `json:"folder"`
	UIDValidity int64  `json:"uidValidity"`
	UID         int64  `json:"uid"`
	MessageID   string `json:"messageId"`
	MaterialID  string `json:"materialId"`
}

type backupMailRejected struct {
	AccountID   string `json:"accountId"`
	Folder      string `json:"folder"`
	UIDValidity int64  `json:"uidValidity"`
	UID         int64  `json:"uid"`
	Reason      string `json:"reason"`
	RejectedAt  int64  `json:"rejectedAt"`
}

type backupMailBinding struct {
	State       string  `json:"state"`
	Fingerprint *string `json:"fingerprint"`
}

type backupMailSnapshot struct {
	Version          int                          `json:"version"`
	Accounts         []backupMailAccount          `json:"accounts"`
	SyncStates       []backupMailSyncState        `json:"syncStates"`
	Imports          []backupMailImport           `json:"imports"`
	Rejected         []backupMailRejected         `json:"rejected"`
	MaterialBindings map[string]backupMailBinding `json:"materialBindings"`
}

const maxUID int64 = 4294967295

var mailSchemas = map[string][][4]any{
	"mail_accounts":   {{"id", "TEXT", false, 1}, {"config_json", "TEXT", true, 0}, {"created_at", "INTEGER", true, 0}, {"last_sync_at", "INTEGER", false, 0}, {"last_error", "TEXT", false, 0}, {"uid_validity", "INTEGER", false, 0}, {"last_uid", "INTEGER", true, 0}},
	"mail_imports":    {{"account_id", "TEXT", true, 1}, {"folder", "TEXT", true, 2}, {"uid_validity", "INTEGER", true, 3}, {"uid", "INTEGER", true, 4}, {"message_id", "TEXT", true, 0}, {"material_id", "TEXT", true, 0}},
	"mail_rejected":   {{"account_id", "TEXT", true, 1}, {"folder", "TEXT", true, 2}, {"uid_validity", "INTEGER", true, 3}, {"uid", "INTEGER", true, 4}, {"reason", "TEXT", true, 0}, {"rejected_at", "INTEGER", true, 0}},
	"mail_sync_state": {{"account_id", "TEXT", false, 1}, {"history_before", "INTEGER", false, 0}, {"history_complete", "INTEGER", true, 0}, {"last_attempt_at", "INTEGER", false, 0}},
}

func mailTablePresent(ctx context.Context, tx *sql.Tx, name string) (bool, error) {
	var present bool
	if err := tx.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?)", name).Scan(&present); err != nil {
		return false, fmt.Errorf("检查邮箱备份结构失败：%w", err)
	}
	return present, nil
}

func verifyMailSchema(ctx context.Context, tx *sql.Tx, name string) error {
	expected := mailSchemas[name]
	rows, err := tx.QueryContext(ctx, "PRAGMA table_info("+name+")")
	if err != nil {
		return fmt.Errorf("检查邮箱表结构失败：%w", err)
	}
	defer rows.Close()
	var actual [][4]any
	for rows.Next() {
		var cid, notNull, pk int
		var column, kind string
		var dflt any
		if err := rows.Scan(&cid, &column, &kind, &notNull, &dflt, &pk); err != nil {
			return fmt.Errorf("检查邮箱表结构失败：%w", err)
		}
		actual = append(actual, [4]any{column, kind, notNull != 0, pk})
	}
	if len(actual) != len(expected) {
		return fmt.Errorf("邮箱表 %s 的结构发生变化，需更新备份版本", name)
	}
	for i := range expected {
		if actual[i] != expected[i] {
			return fmt.Errorf("邮箱表 %s 的结构发生变化，需更新备份版本", name)
		}
	}
	return nil
}

func mailConfigFromJSON(raw string) (mail.Config, error) {
	var fields map[string]json.RawMessage
	if json.Unmarshal([]byte(raw), &fields) != nil || fields == nil {
		return mail.Config{}, fmt.Errorf("邮箱账号配置损坏，未纳入备份")
	}
	allowed := map[string]bool{"id": true, "name": true, "email": true, "host": true, "port": true, "username": true, "folder": true, "syncLimit": true, "syncIntervalMinutes": true}
	for key := range fields {
		if !allowed[key] {
			return mail.Config{}, fmt.Errorf("邮箱账号含有未识别字段，无法确认不含凭据，未纳入备份")
		}
	}
	var config mail.Config
	if json.Unmarshal([]byte(raw), &config) != nil {
		return mail.Config{}, fmt.Errorf("邮箱账号配置损坏，未纳入备份")
	}
	normalized, err := mail.Validate(config)
	if err != nil {
		return mail.Config{}, fmt.Errorf("邮箱账号配置无效，未纳入备份")
	}
	if normalized != config {
		return mail.Config{}, fmt.Errorf("邮箱账号配置未规范化，无法安全迁移")
	}
	return config, nil
}

func validMailLabel(value string, max int) bool {
	if value == "" || len(value) > max {
		return false
	}
	for _, r := range value {
		if r < 0x20 || (r >= 0x7f && r <= 0x9f) {
			return false
		}
	}
	return true
}

func validMailTime(value *int64) bool { return value == nil || *value >= 0 }

func mailMaterialFingerprint(item backupMaterial, deleted int64) (string, error) {
	tuple := []any{item.ID, item.SourceType, item.Title, item.SourceURL, item.RawText, item.CleanedMarkdown, item.ContentHash,
		item.MediaPath, item.MediaSizeBytes, item.MetadataJSON, item.InboxStatus, item.CreatedAt, item.UpdatedAt, deleted}
	encoded, err := json.Marshal(tuple)
	if err != nil {
		return "", fmt.Errorf("邮件素材指纹计算失败")
	}
	digest := sha256.Sum256(encoded)
	return hex.EncodeToString(digest[:]), nil
}

type storedMaterial struct {
	Item    backupMaterial
	Deleted int64
}

func mailMaterialRecord(ctx context.Context, tx *sql.Tx, id string) (*storedMaterial, error) {
	rows, err := tx.QueryContext(ctx, "SELECT id,source_type,title,source_url,raw_text,cleaned_markdown,content_hash,media_path,media_size_bytes,metadata_json,inbox_status,created_at,updated_at,is_deleted FROM materials WHERE id=?", id)
	if err != nil {
		return nil, fmt.Errorf("读取邮件来源素材失败：%w", err)
	}
	defer rows.Close()
	if !rows.Next() {
		return nil, rows.Err()
	}
	var record storedMaterial
	if err := rows.Scan(&record.Item.ID, &record.Item.SourceType, &record.Item.Title, &record.Item.SourceURL, &record.Item.RawText,
		&record.Item.CleanedMarkdown, &record.Item.ContentHash, &record.Item.MediaPath, &record.Item.MediaSizeBytes, &record.Item.MetadataJSON,
		&record.Item.InboxStatus, &record.Item.CreatedAt, &record.Item.UpdatedAt, &record.Deleted); err != nil {
		return nil, fmt.Errorf("读取邮件来源素材失败：%w", err)
	}
	return &record, nil
}

func mailMaterialBinding(ctx context.Context, tx *sql.Tx, id string) (backupMailBinding, error) {
	record, err := mailMaterialRecord(ctx, tx, id)
	if err != nil {
		return backupMailBinding{}, err
	}
	if record == nil {
		return backupMailBinding{State: "missing"}, nil
	}
	if record.Deleted != 0 && record.Deleted != 1 {
		return backupMailBinding{}, fmt.Errorf("邮件来源素材删除状态无效，无法安全备份")
	}
	state := "active"
	if record.Deleted == 1 {
		state = "deleted"
	}
	fingerprint, err := mailMaterialFingerprint(record.Item, record.Deleted)
	if err != nil {
		return backupMailBinding{}, err
	}
	return backupMailBinding{State: state, Fingerprint: &fingerprint}, nil
}
func captureMailSnapshot(ctx context.Context, tx *sql.Tx, materials []backupMaterial) (backupMailSnapshot, error) {
	empty := func() backupMailSnapshot {
		return backupMailSnapshot{Version: 1, Accounts: []backupMailAccount{}, SyncStates: []backupMailSyncState{}, Imports: []backupMailImport{}, Rejected: []backupMailRejected{}, MaterialBindings: map[string]backupMailBinding{}}
	}
	snapshot := empty()
	names := []string{"mail_accounts", "mail_imports", "mail_rejected", "mail_sync_state"}
	present, err := 0, error(nil)
	_ = present
	found := 0
	for _, name := range names {
		ok, err := mailTablePresent(ctx, tx, name)
		if err != nil {
			return snapshot, err
		}
		if ok {
			found++
		}
	}
	if found == 0 {
		return snapshot, nil
	}
	if found != len(names) {
		return snapshot, fmt.Errorf("邮箱同步表结构不完整，未纳入备份")
	}
	for _, name := range names {
		if err := verifyMailSchema(ctx, tx, name); err != nil {
			return snapshot, err
		}
	}
	rows, err := tx.QueryContext(ctx, "SELECT account_id,history_before,history_complete,last_attempt_at FROM mail_sync_state ORDER BY account_id")
	if err != nil {
		return snapshot, fmt.Errorf("读取邮箱同步状态失败：%w", err)
	}
	for rows.Next() {
		var state backupMailSyncState
		var complete int64
		if err := rows.Scan(&state.AccountID, &state.HistoryBefore, &complete, &state.LastAttemptAt); err != nil {
			rows.Close()
			return snapshot, fmt.Errorf("读取邮箱同步状态失败：%w", err)
		}
		if complete != 0 && complete != 1 {
			rows.Close()
			return snapshot, fmt.Errorf("邮箱同步状态无效")
		}
		state.HistoryComplete = complete == 1
		snapshot.SyncStates = append(snapshot.SyncStates, state)
	}
	rows.Close()
	rows, err = tx.QueryContext(ctx, "SELECT id,config_json,created_at,last_sync_at,uid_validity,last_uid FROM mail_accounts ORDER BY created_at,id")
	if err != nil {
		return snapshot, fmt.Errorf("读取邮箱账号失败：%w", err)
	}
	for rows.Next() {
		var id, configJSON string
		var account backupMailAccount
		if err := rows.Scan(&id, &configJSON, &account.CreatedAt, &account.LastSyncAt, &account.UIDValidity, &account.LastUID); err != nil {
			rows.Close()
			return snapshot, fmt.Errorf("读取邮箱账号失败：%w", err)
		}
		config, err := mailConfigFromJSON(configJSON)
		if err != nil {
			rows.Close()
			return snapshot, err
		}
		if id != config.ID {
			rows.Close()
			return snapshot, fmt.Errorf("邮箱账号标识不一致，未纳入备份")
		}
		account.Config = config
		snapshot.Accounts = append(snapshot.Accounts, account)
	}
	rows.Close()
	rows, err = tx.QueryContext(ctx, "SELECT account_id,folder,uid_validity,uid,message_id,material_id FROM mail_imports ORDER BY account_id,folder,uid_validity,uid")
	if err != nil {
		return snapshot, fmt.Errorf("读取邮件去重记录失败：%w", err)
	}
	for rows.Next() {
		var item backupMailImport
		if err := rows.Scan(&item.AccountID, &item.Folder, &item.UIDValidity, &item.UID, &item.MessageID, &item.MaterialID); err != nil {
			rows.Close()
			return snapshot, fmt.Errorf("读取邮件去重记录失败：%w", err)
		}
		snapshot.Imports = append(snapshot.Imports, item)
	}
	rows.Close()
	rows, err = tx.QueryContext(ctx, "SELECT account_id,folder,uid_validity,uid,reason,rejected_at FROM mail_rejected ORDER BY account_id,folder,uid_validity,uid")
	if err != nil {
		return snapshot, fmt.Errorf("读取邮件隔离记录失败：%w", err)
	}
	for rows.Next() {
		var item backupMailRejected
		if err := rows.Scan(&item.AccountID, &item.Folder, &item.UIDValidity, &item.UID, &item.Reason, &item.RejectedAt); err != nil {
			rows.Close()
			return snapshot, fmt.Errorf("读取邮件隔离记录失败：%w", err)
		}
		snapshot.Rejected = append(snapshot.Rejected, item)
	}
	rows.Close()
	for _, item := range snapshot.Imports {
		if _, ok := snapshot.MaterialBindings[item.MaterialID]; ok {
			continue
		}
		binding, err := mailMaterialBinding(ctx, tx, item.MaterialID)
		if err != nil {
			return snapshot, err
		}
		snapshot.MaterialBindings[item.MaterialID] = binding
	}
	if err := validateMailSnapshot(snapshot); err != nil {
		return snapshot, err
	}
	exported := make(map[string]backupMaterial, len(materials))
	for _, item := range materials {
		exported[item.ID] = item
	}
	for id, binding := range snapshot.MaterialBindings {
		item, ok := exported[id]
		switch binding.State {
		case "active":
			if !ok {
				return snapshot, fmt.Errorf("邮件去重记录引用的有效素材未纳入备份")
			}
			expected, err := mailMaterialFingerprint(item, 0)
			if err != nil {
				return snapshot, err
			}
			if binding.Fingerprint == nil || *binding.Fingerprint != expected {
				return snapshot, fmt.Errorf("邮件去重记录引用的素材与备份正文不一致")
			}
		case "deleted", "missing":
			if ok {
				return snapshot, fmt.Errorf("邮件去重记录的来源状态与素材备份不一致")
			}
		default:
			return snapshot, fmt.Errorf("邮件素材绑定无效")
		}
	}
	return snapshot, nil
}

func validateMailSnapshot(snapshot backupMailSnapshot) error {
	if snapshot.Version != 1 {
		return fmt.Errorf("不支持的邮箱备份版本")
	}
	accountIDs := map[string]bool{}
	for _, account := range snapshot.Accounts {
		normalized, err := mail.Validate(account.Config)
		if err != nil || normalized != account.Config || accountIDs[account.Config.ID] || account.CreatedAt < 0 || !validMailTime(account.LastSyncAt) ||
			account.LastUID < 0 || account.LastUID > maxUID || (account.UIDValidity != nil && (*account.UIDValidity < 1 || *account.UIDValidity > maxUID)) {
			return fmt.Errorf("邮箱账号或同步游标无效")
		}
		accountIDs[account.Config.ID] = true
	}
	syncIDs := map[string]bool{}
	for _, state := range snapshot.SyncStates {
		if mail.ValidID(state.AccountID) != nil || syncIDs[state.AccountID] ||
			(state.HistoryBefore != nil && (*state.HistoryBefore < 1 || *state.HistoryBefore > maxUID)) || !validMailTime(state.LastAttemptAt) {
			return fmt.Errorf("邮箱同步状态无效")
		}
		syncIDs[state.AccountID] = true
	}
	for id := range accountIDs {
		if !syncIDs[id] {
			return fmt.Errorf("邮箱账号缺少同步状态")
		}
	}
	importKeys := map[string]bool{}
	for _, item := range snapshot.Imports {
		if mail.ValidID(item.AccountID) != nil || !validMailLabel(item.Folder, 512) || item.UIDValidity < 1 || item.UIDValidity > maxUID || item.UID < 1 || item.UID > maxUID ||
			len(item.MessageID) > 4096 || strings.ContainsFunc(item.MessageID, func(r rune) bool { return r < 0x20 || (r >= 0x7f && r <= 0x9f) }) || !validMailLabel(item.MaterialID, 512) {
			return fmt.Errorf("邮件去重记录字段无效")
		}
		key := fmt.Sprintf("%s\n%s\n%d\n%d", item.AccountID, item.Folder, item.UIDValidity, item.UID)
		if importKeys[key] {
			return fmt.Errorf("邮件去重记录重复")
		}
		importKeys[key] = true
	}
	for _, item := range snapshot.Rejected {
		if mail.ValidID(item.AccountID) != nil || !validMailLabel(item.Folder, 512) || item.UIDValidity < 1 || item.UIDValidity > maxUID || item.UID < 1 || item.UID > maxUID || item.RejectedAt < 0 {
			return fmt.Errorf("邮件隔离记录字段无效")
		}
		if !sortAllowedReason(item.Reason) {
			return fmt.Errorf("邮件隔离原因无效")
		}
	}
	return nil
}

func sortAllowedReason(reason string) bool {
	return reason == "邮件大小超过导入上限" || reason == "无法读取邮件正文或 MIME 结构"
}
