package library

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"

	"knowflick.local/workbench-go/internal/media"
)

// ImportedMaterial 是订阅抓取要落库的一条素材；id 与哈希由调用方按前端同一规则生成，
// 避免 Go 与 TypeScript 各算一份指纹导致去重失效。
type ImportedMaterial struct {
	ID           string `json:"id"`
	SourceType   string `json:"sourceType"`
	Title        string `json:"title"`
	SourceURL    string `json:"sourceUrl"`
	RawText      string `json:"rawText"`
	MetadataJSON string `json:"metadataJson"`
	InboxStatus  string `json:"inboxStatus"`
	CreatedAt    int64  `json:"createdAt"`
	UpdatedAt    int64  `json:"updatedAt"`
}

// LoadSubscription 读一条订阅；不存在时返回明确错误。
func LoadSubscription(ctx context.Context, db *sql.DB, id string) (Subscription, error) {
	var item Subscription
	var polled sql.NullInt64
	var active int
	err := db.QueryRowContext(ctx, "SELECT id,type,title,target_url,interval_minutes,last_polled_at,is_active,created_at FROM subscriptions WHERE id = ?", id).
		Scan(&item.ID, &item.Type, &item.Title, &item.TargetURL, &item.IntervalMinutes, &polled, &active, &item.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return item, errors.New("订阅不存在")
	}
	if err != nil {
		return item, err
	}
	if polled.Valid {
		value := polled.Int64
		item.LastPolledAt = &value
	}
	item.IsActive = active != 0
	return item, nil
}

// MaterialSourceURLs 列出未删除素材的来源链接：抓取前用它做同链接去重。
func MaterialSourceURLs(ctx context.Context, db *sql.DB) ([]string, error) {
	rows, err := db.QueryContext(ctx, "SELECT source_url FROM materials WHERE is_deleted = 0 AND source_url IS NOT NULL AND source_url <> ''")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	urls := make([]string, 0)
	for rows.Next() {
		var value string
		if err := rows.Scan(&value); err != nil {
			return nil, err
		}
		urls = append(urls, value)
	}
	return urls, rows.Err()
}

// SaveImportedMaterial 插入一条素材并刷新全文索引。同 id 已存在时返回 false。
func SaveImportedMaterial(ctx context.Context, db *sql.DB, material ImportedMaterial) (bool, error) {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer tx.Rollback()
	inserted, err := insertImportedMaterial(ctx, tx, material)
	if err != nil || !inserted {
		return false, err
	}
	return true, tx.Commit()
}

func insertImportedMaterial(ctx context.Context, tx *sql.Tx, material ImportedMaterial) (bool, error) {
	if material.ID == "" || material.RawText == "" {
		return false, errors.New("素材缺少标识或正文")
	}
	sum := sha256.Sum256([]byte(material.RawText))
	hash := hex.EncodeToString(sum[:])
	result, err := tx.ExecContext(ctx, "INSERT INTO materials (id,source_type,title,source_url,raw_text,cleaned_markdown,content_hash,media_path,media_size_bytes,metadata_json,inbox_status,created_at,updated_at,version,is_deleted) "+
		"VALUES (?,?,?,?,?,NULL,?,NULL,0,?,?,?,?,1,0) ON CONFLICT(id) DO NOTHING",
		material.ID, material.SourceType, material.Title, nullableText(material.SourceURL), material.RawText, hash, material.MetadataJSON, material.InboxStatus, material.CreatedAt, material.UpdatedAt)
	if err != nil {
		return false, err
	}
	affected, err := result.RowsAffected()
	if err != nil || affected == 0 {
		return false, err
	}
	_, err = tx.ExecContext(ctx, "INSERT INTO fts_materials (material_id,title,raw_text,source_url) VALUES (?,?,?,?)", material.ID, material.Title, material.RawText, material.SourceURL)
	return err == nil, err
}

func nullableText(value string) any {
	if value == "" {
		return nil
	}
	return value
}

// saveMaterialAttachment 新建素材、全文索引及库内附件。
func (l *Library) saveMaterialAttachment(ctx context.Context, material ImportedMaterial, dir, kind, mime string, data []byte) (string, error) {
	tx, err := l.db.BeginTx(ctx, nil)
	if err != nil {
		return "", err
	}
	defer tx.Rollback()
	inserted, err := insertImportedMaterial(ctx, tx, material)
	if err != nil {
		return "", err
	}
	if !inserted {
		return "", errors.New("素材标识冲突，请重试")
	}
	if err := commitMaterialAttachment(ctx, tx, material.ID, dir, kind, mime, data); err != nil {
		return "", err
	}
	return material.ID, nil
}

func commitMaterialAttachment(ctx context.Context, tx *sql.Tx, id, dir, kind, mime string, data []byte) error {
	return media.SaveLinked(dir, kind, mime, data, func(relative string) error {
		result, err := tx.ExecContext(ctx, "UPDATE materials SET media_path = ?, media_size_bytes = ? WHERE id = ?", relative, len(data), id)
		if err != nil {
			return err
		}
		affected, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if affected != 1 {
			return errors.New("未能将附件关联到素材")
		}
		return tx.Commit()
	})
}
