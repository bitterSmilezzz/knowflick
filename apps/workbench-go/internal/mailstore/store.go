package mailstore

import (
	"context"
	"database/sql"
	"errors"

	"knowflick.local/workbench-go/internal/mailsync"
)

// 别名让调用方不必同时导入两个包。
type Mode = mailsync.Mode
type Cursor = mailsync.Cursor

const (
	ModeNew     = mailsync.ModeNew
	ModeHistory = mailsync.ModeHistory
	ModeRetry   = mailsync.ModeRetry
)

var _ mailsync.Store = (*Store)(nil)

// Store 持有同步所需的表连接。
type Store struct {
	DB *sql.DB
}

// New 包一层连接。
func New(db *sql.DB) *Store {
	return &Store{DB: db}
}

// LoadCursor 读账号的 UIDVALIDITY、last_uid 与 history_before。
func (s *Store) LoadCursor(ctx context.Context, accountID string) (Cursor, error) {
	var cursor Cursor
	var validity sql.NullInt64
	var before sql.NullInt64
	err := s.DB.QueryRowContext(ctx, `SELECT a.uid_validity, a.last_uid, s.history_before
		FROM mail_accounts a JOIN mail_sync_state s ON s.account_id = a.id WHERE a.id = ?1`, accountID).Scan(&validity, &cursor.LastUID, &before)
	if errors.Is(err, sql.ErrNoRows) {
		return Cursor{}, errors.New("邮箱账号不存在")
	}
	if err != nil {
		return Cursor{}, err
	}
	if validity.Valid && validity.Int64 > 0 {
		value := uint32(validity.Int64)
		cursor.UIDValidity = &value
	}
	if before.Valid && before.Int64 > 0 {
		value := uint32(before.Int64)
		cursor.HistoryBefore = &value
	}
	return cursor, nil
}

// AlignBootstrap 把游标对齐到 bootstrap 边界。
// last_uid 设为 boundary-1：边界那封还没处理，处理完自然会抬到它。
func (s *Store) AlignBootstrap(ctx context.Context, accountID string, validity, boundary uint32, complete bool) error {
	if boundary == 0 {
		boundary = 1
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "UPDATE mail_accounts SET uid_validity=?1, last_uid=?2 WHERE id=?3", validity, boundary-1, accountID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, "UPDATE mail_sync_state SET history_before=?1, history_complete=?2 WHERE account_id=?3", boundary, complete, accountID); err != nil {
		return err
	}
	return tx.Commit()
}

// RejectedUIDs 按拒收时间列出待重试的 UID。
func (s *Store) RejectedUIDs(ctx context.Context, accountID, folder string, validity uint32, limit int) ([]uint32, error) {
	rows, err := s.DB.QueryContext(ctx, "SELECT uid FROM mail_rejected WHERE account_id=?1 AND folder=?2 AND uid_validity=?3 ORDER BY rejected_at, uid LIMIT ?4",
		accountID, folder, validity, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	uids := make([]uint32, 0, limit)
	for rows.Next() {
		var uid uint32
		if err := rows.Scan(&uid); err != nil {
			return nil, err
		}
		uids = append(uids, uid)
	}
	return uids, rows.Err()
}

// KnownUID 判断这封是否已经处理过。
// Retry 模式不把拒收当作已处理——那正是要重试的对象。
func (s *Store) KnownUID(ctx context.Context, accountID, folder string, validity, uid uint32, mode Mode) (bool, error) {
	var imported, rejected bool
	err := s.DB.QueryRowContext(ctx, `SELECT
		EXISTS(SELECT 1 FROM mail_imports WHERE account_id=?1 AND folder=?2 AND uid_validity=?3 AND uid=?4),
		EXISTS(SELECT 1 FROM mail_rejected WHERE account_id=?1 AND folder=?2 AND uid_validity=?3 AND uid=?4)`,
		accountID, folder, validity, uid).Scan(&imported, &rejected)
	if err != nil {
		return false, err
	}
	if mode == ModeRetry {
		return imported, nil
	}
	return imported || rejected, nil
}

// RecordRejected 记一封被拒的邮件（同键覆盖，保留最新原因）。
func (s *Store) RecordRejected(ctx context.Context, accountID, folder string, validity, uid uint32, reason string, now int64) error {
	_, err := s.DB.ExecContext(ctx, `INSERT OR REPLACE INTO mail_rejected
		(account_id, folder, uid_validity, uid, reason, rejected_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
		accountID, folder, validity, uid, reason, now)
	return err
}

// RecordImported 记一封已导入的邮件，并清掉它可能存在的拒收记录。
// 同一 Message-ID 已有素材时复用它的 material_id——UIDVALIDITY 翻滚后
// 同一封邮件会拿到新 UID，但素材不该变成两条。
func (s *Store) RecordImported(ctx context.Context, accountID, folder string, validity, uid uint32, messageID, materialID string) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, `INSERT OR IGNORE INTO mail_imports
		(account_id, folder, uid_validity, uid, message_id, material_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
		accountID, folder, validity, uid, messageID, materialID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, "DELETE FROM mail_rejected WHERE account_id=?1 AND folder=?2 AND uid_validity=?3 AND uid=?4",
		accountID, folder, validity, uid); err != nil {
		return err
	}
	return tx.Commit()
}

// ExistingMaterial 查同一 Message-ID 是否已有素材（去重的主判据）。
func (s *Store) ExistingMaterial(ctx context.Context, accountID, folder, messageID string) (string, bool, error) {
	if messageID == "" {
		return "", false, nil
	}
	var materialID string
	err := s.DB.QueryRowContext(ctx, "SELECT material_id FROM mail_imports WHERE account_id=?1 AND folder=?2 AND message_id=?3 LIMIT 1",
		accountID, folder, messageID).Scan(&materialID)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return materialID, true, nil
}

// AdvanceCursor 推进游标。New 取 MAX、History 取 MIN：重复或乱序处理都不会让游标倒退。
func (s *Store) AdvanceCursor(ctx context.Context, accountID string, mode Mode, uid uint32) error {
	switch mode {
	case ModeNew:
		_, err := s.DB.ExecContext(ctx, "UPDATE mail_accounts SET last_uid=MAX(last_uid,?1) WHERE id=?2", uid, accountID)
		return err
	case ModeHistory:
		_, err := s.DB.ExecContext(ctx, "UPDATE mail_sync_state SET history_before=MIN(history_before,?1) WHERE account_id=?2", uid, accountID)
		return err
	case ModeRetry:
		return nil
	default:
		return errors.New("未知的同步模式")
	}
}

// LoadHistoryBefore 读当前历史边界；没有值时按 1 处理（视为已到底）。
func (s *Store) LoadHistoryBefore(ctx context.Context, accountID string) (uint32, error) {
	var before sql.NullInt64
	err := s.DB.QueryRowContext(ctx, "SELECT history_before FROM mail_sync_state WHERE account_id=?1", accountID).Scan(&before)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && !before.Valid) {
		return 1, nil
	}
	if err != nil {
		return 0, err
	}
	if before.Int64 <= 0 {
		return 1, nil
	}
	return uint32(before.Int64), nil
}

// Finish 写入完成标志、最后同步时间并清空错误。
func (s *Store) Finish(ctx context.Context, accountID string, complete bool, now int64) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "UPDATE mail_sync_state SET history_complete=?1 WHERE account_id=?2", complete, accountID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, "UPDATE mail_accounts SET last_sync_at=?1, last_error=NULL WHERE id=?2", now, accountID); err != nil {
		return err
	}
	return tx.Commit()
}

// Fail 记下本轮错误。
func (s *Store) Fail(ctx context.Context, accountID, reason string) error {
	_, err := s.DB.ExecContext(ctx, "UPDATE mail_accounts SET last_error=?1 WHERE id=?2", reason, accountID)
	return err
}

// MarkAttempt 记下本轮尝试时间。
func (s *Store) MarkAttempt(ctx context.Context, accountID string, now int64) error {
	_, err := s.DB.ExecContext(ctx, "UPDATE mail_sync_state SET last_attempt_at=?1 WHERE account_id=?2", now, accountID)
	return err
}
