package library

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"

	"knowflick.local/workbench-go/internal/archive"
)

// restoreMail 恢复邮箱账号、同步状态与去重/隔离台账。密码不在包内，恢复后仍需用户重新输入。
func restoreMail(ctx context.Context, tx *sql.Tx, backup archive.SystemBackup) (int, int, int, int, error) {
	if len(backup.Mail) == 0 {
		return 0, 0, 0, 0, nil
	}
	var snapshot backupMailSnapshot
	if err := json.Unmarshal(backup.Mail, &snapshot); err != nil || snapshot.Version != 1 {
		return 0, 0, 0, 0, errors.New("mail.json 结构无效")
	}
	if err := validateMailSnapshot(snapshot); err != nil {
		return 0, 0, 0, 0, err
	}
	if err := checkMailBindings(snapshot, backup); err != nil {
		return 0, 0, 0, 0, err
	}
	counts := [4]int{}
	for _, account := range snapshot.Accounts {
		configJSON, err := json.Marshal(account.Config)
		if err != nil {
			return 0, 0, 0, 0, err
		}
		result, err := tx.ExecContext(ctx, "INSERT INTO mail_accounts (id,config_json,created_at,last_sync_at,last_error,uid_validity,last_uid) VALUES (?,?,?,?,NULL,?,?) ON CONFLICT(id) DO NOTHING",
			account.Config.ID, string(configJSON), account.CreatedAt, account.LastSyncAt, account.UIDValidity, account.LastUID)
		if err != nil {
			return 0, 0, 0, 0, fmt.Errorf("恢复邮箱账号失败：%w", err)
		}
		if rows, err := result.RowsAffected(); err == nil && rows > 0 {
			counts[0]++
		}
	}
	for _, state := range snapshot.SyncStates {
		result, err := tx.ExecContext(ctx, "INSERT INTO mail_sync_state (account_id,history_before,history_complete,last_attempt_at) VALUES (?,?,?,?) ON CONFLICT(account_id) DO NOTHING",
			state.AccountID, state.HistoryBefore, favoriteValue(state.HistoryComplete), state.LastAttemptAt)
		if err != nil {
			return 0, 0, 0, 0, fmt.Errorf("恢复邮箱同步状态失败：%w", err)
		}
		if rows, err := result.RowsAffected(); err == nil && rows > 0 {
			counts[1]++
		}
	}
	for _, item := range snapshot.Imports {
		result, err := tx.ExecContext(ctx, "INSERT INTO mail_imports (account_id,folder,uid_validity,uid,message_id,material_id) VALUES (?,?,?,?,?,?) ON CONFLICT DO NOTHING",
			item.AccountID, item.Folder, item.UIDValidity, item.UID, item.MessageID, item.MaterialID)
		if err != nil {
			return 0, 0, 0, 0, fmt.Errorf("恢复邮件去重记录失败：%w", err)
		}
		if rows, err := result.RowsAffected(); err == nil && rows > 0 {
			counts[2]++
		}
	}
	for _, item := range snapshot.Rejected {
		result, err := tx.ExecContext(ctx, "INSERT INTO mail_rejected (account_id,folder,uid_validity,uid,reason,rejected_at) VALUES (?,?,?,?,?,?) ON CONFLICT DO NOTHING",
			item.AccountID, item.Folder, item.UIDValidity, item.UID, item.Reason, item.RejectedAt)
		if err != nil {
			return 0, 0, 0, 0, fmt.Errorf("恢复邮件隔离记录失败：%w", err)
		}
		if rows, err := result.RowsAffected(); err == nil && rows > 0 {
			counts[3]++
		}
	}
	return counts[0], counts[1], counts[2], counts[3], nil
}

func checkMailBindings(snapshot backupMailSnapshot, backup archive.SystemBackup) error {
	var active []backupMaterial
	if err := json.Unmarshal(backup.Materials, &active); err != nil {
		return err
	}
	var deleted deletedRecordsSnapshot
	if len(backup.DeletedRecords) > 0 {
		if err := json.Unmarshal(backup.DeletedRecords, &deleted); err != nil {
			return err
		}
	}
	activeByID := make(map[string]backupMaterial, len(active))
	for _, item := range active {
		activeByID[item.ID] = item
	}
	deletedByID := make(map[string]bool, len(deleted.Materials))
	for _, record := range deleted.Materials {
		deletedByID[record.Material.ID] = true
	}
	for id, binding := range snapshot.MaterialBindings {
		switch binding.State {
		case "active":
			item, ok := activeByID[id]
			if !ok {
				return errors.New("邮件去重记录引用的有效素材未纳入备份")
			}
			expected, err := mailMaterialFingerprint(item, 0)
			if err != nil {
				return err
			}
			if binding.Fingerprint == nil || *binding.Fingerprint != expected {
				return errors.New("邮件去重记录引用的素材与备份正文不一致")
			}
		case "deleted":
			if !deletedByID[id] {
				return errors.New("邮件去重记录的来源状态与素材备份不一致")
			}
		case "missing":
		case "":
			return errors.New("邮件素材绑定无效")
		default:
			return errors.New("邮件素材绑定无效")
		}
	}
	return nil
}
