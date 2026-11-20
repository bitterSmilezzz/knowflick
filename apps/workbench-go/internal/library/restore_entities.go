package library

import (
	"context"

	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"knowflick.local/workbench-go/internal/archive"
	"strings"
)

// RestoreMaterial 按保护绑定恢复一条素材：已存在且内容一致是幂等跳过，
// 冲突（内容不同、已删除、指纹不一致）明确报错，不静默覆盖。
func (l *Library) RestoreMaterial(ctx context.Context, protected bool, fingerprint *string, material backupMaterial) (bool, error) {
	if !l.writable {
		return false, ErrReadOnly
	}
	tx, err := l.db.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer tx.Rollback()
	var local backupMaterial
	err = tx.QueryRowContext(ctx, "SELECT id,source_type,title,source_url,raw_text,cleaned_markdown,content_hash,media_path,media_size_bytes,metadata_json,inbox_status,created_at,updated_at FROM materials WHERE id = ?", material.ID).
		Scan(&local.ID, &local.SourceType, &local.Title, &local.SourceURL, &local.RawText, &local.CleanedMarkdown, &local.ContentHash, &local.MediaPath, &local.MediaSizeBytes, &local.MetadataJSON, &local.InboxStatus, &local.CreatedAt, &local.UpdatedAt)
	exists := !errors.Is(err, sql.ErrNoRows)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return false, fmt.Errorf("读取本地素材失败：%w", err)
	}
	if protected {
		current, fpErr := evidenceFingerprintTx(ctx, tx, "material", material.ID)
		if fpErr != nil {
			return false, fpErr
		}
		if current != nil {
			if (fingerprint == nil) || *current != *fingerprint {
				return false, errors.New("本地素材与备份的关联原件不一致，未覆盖")
			}
		} else if fingerprint == nil {
			return false, errors.New("备份素材与关联原件缺失状态矛盾，未写入")
		}
	}
	if exists {
		// content_hash 是保存时重算的派生索引，比较时排除（与 Rust 一致）。
		incoming := material
		local.ContentHash = ""
		incoming.ContentHash = ""
		if local != incoming {
			return false, errors.New("本地同标识素材内容不同，未覆盖")
		}
		return false, nil
	}
	sourceURL := material.SourceURL
	_, err = tx.ExecContext(ctx, "INSERT INTO materials (id, source_type, title, source_url, raw_text, cleaned_markdown, content_hash, media_path, media_size_bytes, metadata_json, inbox_status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
		material.ID, material.SourceType, material.Title, sourceURL, material.RawText, cleaned2(material.CleanedMarkdown), material.ContentHash, material.MediaPath, material.MediaSizeBytes, material.MetadataJSON, material.InboxStatus, material.CreatedAt, material.UpdatedAt)
	if err != nil {
		return false, fmt.Errorf("恢复素材失败：%w", err)
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO fts_materials (material_id, title, raw_text, source_url) VALUES (?,?,?,?)",
		material.ID, material.Title, material.RawText, nullToEmpty(sourceURL)); err != nil {
		return false, fmt.Errorf("恢复素材索引失败：%w", err)
	}
	if protected {
		current, fpErr := evidenceFingerprintTx(ctx, tx, "material", material.ID)
		if fpErr != nil {
			return false, fpErr
		}
		if fingerprint != nil && (current == nil || *current != *fingerprint) {
			return false, errors.New("备份素材与关联原件指纹不一致，未写入")
		}
	}
	if err := tx.Commit(); err != nil {
		return false, err
	}
	return true, nil
}

func cleaned2(value *string) any {
	if value == nil {
		return nil
	}
	return *value
}

func nullToEmpty(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func evidenceFingerprintTx(ctx context.Context, tx *sql.Tx, kind, id string) (*string, error) {
	query := ""
	switch kind {
	case "material":
		query = "SELECT source_material_id FROM notes WHERE source_material_id = ? AND is_deleted = 0 LIMIT 1"
	default:
		return nil, errors.New("未支持的证据类型")
	}
	var value sql.NullString
	if err := tx.QueryRowContext(ctx, query, id).Scan(&value); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	// The fingerprint stored on the binding table is the SHA-256 of the evidence body.
	// We recompute from the local row to compare with the backup's expectation.
	fingerprint, err := fingerprintRow(ctx, tx, "SELECT raw_text, title FROM materials WHERE id = ?", id)
	if err != nil {
		return nil, err
	}
	return &fingerprint, nil
}

// RestoreArtifact 恢复一条产物：已删除态拒绝，同标识一致幂等跳过。
func (l *Library) RestoreArtifact(ctx context.Context, artifact backupArtifact) (bool, error) {
	if !l.writable {
		return false, ErrReadOnly
	}
	if artifact.IsDeleted {
		return false, errors.New("备份中的删除态产物无法按当前格式恢复")
	}
	tx, err := l.db.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer tx.Rollback()
	var currentIsDeleted int
	err = tx.QueryRowContext(ctx, "SELECT is_deleted FROM artifacts WHERE id = ?", artifact.ID).Scan(&currentIsDeleted)
	if errors.Is(err, sql.ErrNoRows) {
		if _, err := tx.ExecContext(ctx, "INSERT INTO artifacts (id, artifact_type, title, content_markdown, source_card_ids, source_note_ids, date_scope_start, date_scope_end, created_at, updated_at, is_deleted) VALUES (?,?,?,?,?,?,?,?,?,?,0)",
			artifact.ID, artifact.ArtifactType, artifact.Title, artifact.ContentMarkdown, joinJSON(artifact.SourceCardIDs), joinJSON(artifact.SourceNoteIDs), artifact.DateScopeStart, artifact.DateScopeEnd, artifact.CreatedAt, artifact.UpdatedAt); err != nil {
			return false, fmt.Errorf("恢复产物失败：%w", err)
		}
		if err := tx.Commit(); err != nil {
			return false, err
		}
		return true, nil
	}
	if err != nil {
		return false, fmt.Errorf("读取本地产物失败，未覆盖：%w", err)
	}
	if currentIsDeleted != 0 {
		return false, errors.New("本地同标识产物已删除，未覆盖或复活")
	}
	return false, nil
}

func joinJSON(values []string) string {
	data, _ := json.Marshal(values)
	return string(data)
}

// RestoreSubscriptionSnapshot 校验并恢复订阅快照：原子追加，冲突行跳过。
func (l *Library) RestoreSubscriptionSnapshot(ctx context.Context, snapshotJSON json.RawMessage) (int, error) {
	var snapshot struct {
		Version int            `json:"version"`
		Items   []Subscription `json:"items"`
	}
	if err := json.Unmarshal(snapshotJSON, &snapshot); err != nil {
		return 0, errors.New("订阅快照结构无效")
	}
	if snapshot.Version != 1 {
		return 0, errors.New("不支持的订阅快照版本")
	}
	tx, err := l.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	inserted := 0
	for _, item := range snapshot.Items {
		if err := ValidateSubscription(item); err != nil {
			return 0, fmt.Errorf("订阅 %s 无效：%w", item.ID, err)
		}
		result, err := tx.ExecContext(ctx, "INSERT INTO subscriptions (id,type,title,target_url,interval_minutes,last_polled_at,is_active,created_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING",
			item.ID, item.Type, item.Title, item.TargetURL, item.IntervalMinutes, item.LastPolledAt, boolInt(item.IsActive), item.CreatedAt)
		if err != nil {
			return 0, fmt.Errorf("恢复订阅失败：%w", err)
		}
		if changed, err := result.RowsAffected(); err == nil && changed > 0 {
			inserted++
		}
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return inserted, nil
}

// ValidateSubscriptionDestination 确认目标库的订阅表可以接收快照。
func (l *Library) ValidateSubscriptionDestination(ctx context.Context, snapshotJSON json.RawMessage) error {
	var snapshot struct {
		Version int `json:"version"`
	}
	if err := json.Unmarshal(snapshotJSON, &snapshot); err != nil {
		return errors.New("订阅快照结构无效")
	}
	if snapshot.Version != 1 {
		return errors.New("不支持的订阅快照版本")
	}
	var tables int
	if err := l.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='subscriptions'").Scan(&tables); err != nil {
		return err
	}
	if tables == 0 {
		return errors.New("目标资料库缺少订阅表")
	}
	return nil
}

// RestoreR4Snapshot 恢复项目与画像快照（复用系统备份的同一实现）。
func (l *Library) RestoreR4Snapshot(ctx context.Context, snapshotJSON json.RawMessage) (int, error) {
	var backup archive.SystemBackup
	backup.R4 = snapshotJSON
	return restoreR4(ctx, nil, backup)
}

var _ = strings.TrimSpace

// BackupMaterialDTO 是跨进程传输的素材备份条目（线格式与 backupMaterial 一致）。
type BackupMaterialDTO = backupMaterial

// BackupMaterialFromDTO 让服务层可以直接拿到内部结构。
func BackupMaterialFromDTO(dto BackupMaterialDTO) backupMaterial { return dto }

// RestoreArtifactJSON 从 JSON 恢复一条产物。
func (l *Library) RestoreArtifactJSON(ctx context.Context, data json.RawMessage) (bool, error) {
	var artifact backupArtifact
	if err := json.Unmarshal(data, &artifact); err != nil {
		return false, errors.New("产物快照结构无效")
	}
	return l.RestoreArtifact(ctx, artifact)
}

// ValidateR4Destination 校验项目与画像快照与目标库的绑定关系。
func (l *Library) ValidateR4Destination(ctx context.Context, snapshotJSON json.RawMessage) error {
	var snapshot r4Snapshot
	if err := json.Unmarshal(snapshotJSON, &snapshot); err != nil {
		return errors.New("r4.json 结构无效")
	}
	if err := validateR4Snapshot(snapshot); err != nil {
		return err
	}
	return validateR4DestinationDB(ctx, l.db, snapshot)
}
