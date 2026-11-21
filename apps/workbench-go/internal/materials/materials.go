package materials

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"unicode/utf16"

	"knowflick.local/workbench-go/internal/cards"
)

// Material 是一条素材（收件箱里的原始记录），字段与 Rust RawMaterialDto 对应。
type Material struct {
	ID              string  `json:"id"`
	SourceType      string  `json:"sourceType"`
	Title           string  `json:"title"`
	SourceURL       *string `json:"sourceUrl"`
	RawText         string  `json:"rawText"`
	CleanedMarkdown *string `json:"cleanedMarkdown"`
	ContentHash     string  `json:"contentHash"`
	MediaPath       *string `json:"mediaPath"`
	MediaSizeBytes  int64   `json:"mediaSizeBytes"`
	MetadataJSON    string  `json:"metadataJson"`
	InboxStatus     string  `json:"inboxStatus"`
	CreatedAt       int64   `json:"createdAt"`
	UpdatedAt       int64   `json:"updatedAt"`
}

const materialColumns = "id,source_type,title,source_url,raw_text,cleaned_markdown,content_hash," +
	"media_path,media_size_bytes,metadata_json,inbox_status,created_at,updated_at"

// List 列出未删除素材；inboxOnly 只看收件箱（与桌面端默认一致）。
func List(ctx context.Context, db *sql.DB, inboxOnly bool, limit, offset int) ([]Material, error) {
	where := " WHERE is_deleted = 0"
	if inboxOnly {
		where += " AND inbox_status = 'inbox'"
	}
	return read(ctx, db, "SELECT "+materialColumns+" FROM materials"+where+" ORDER BY created_at DESC,id LIMIT ? OFFSET ?", limit, offset)
}

// Search 先走全文索引；连续中文等前缀匹配不到的情况用 LIKE 兜底。
// 空查询退回全部素材（与 Rust search_materials_fts 同分支）。
func Search(ctx context.Context, db *sql.DB, query string, limit int) ([]Material, error) {
	clean := strings.TrimSpace(query)
	if clean == "" {
		return List(ctx, db, false, limit, 0)
	}
	words := strings.Fields(clean)
	for i, word := range words {
		words[i] = `"` + strings.ReplaceAll(word, `"`, `""`) + `*"`
	}
	match := strings.Join(words, " AND ")
	const search = ` WITH matches AS (
		SELECT f.material_id, bm25(fts_materials) AS score FROM fts_materials f
		JOIN materials m ON m.id = f.material_id
		WHERE m.is_deleted = 0 AND fts_materials MATCH ?1
	)
	`
	return read(ctx, db, search+"SELECT "+materialColumns+" FROM materials m"+
		" LEFT JOIN matches x ON x.material_id = m.id WHERE m.is_deleted = 0 AND ("+
		" x.material_id IS NOT NULL OR (NOT EXISTS (SELECT 1 FROM matches) AND"+
		" (m.title LIKE ?2 OR m.raw_text LIKE ?2 OR m.source_url LIKE ?2)))"+
		" ORDER BY x.score ASC, m.created_at DESC, m.id LIMIT ?3", match, "%"+clean+"%", limit)
}

func read(ctx context.Context, db *sql.DB, query string, args ...any) ([]Material, error) {
	rows, err := db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]Material, 0)
	for rows.Next() {
		var item Material
		var sourceURL, cleaned, media sql.NullString
		if err := rows.Scan(&item.ID, &item.SourceType, &item.Title, &sourceURL, &item.RawText, &cleaned,
			&item.ContentHash, &media, &item.MediaSizeBytes, &item.MetadataJSON, &item.InboxStatus,
			&item.CreatedAt, &item.UpdatedAt); err != nil {
			return nil, err
		}
		item.SourceURL, item.CleanedMarkdown, item.MediaPath = nullText(sourceURL), nullText(cleaned), nullText(media)
		items = append(items, item)
	}
	return items, rows.Err()
}

func nullText(value sql.NullString) *string {
	if !value.Valid {
		return nil
	}
	text := value.String
	return &text
}

// UpdateStatus 改素材的收件箱状态；状态取值只有三种，写错直接报错。
func UpdateStatus(ctx context.Context, db *sql.DB, id, status string, now int64) error {
	switch status {
	case "inbox", "processed", "dismissed":
	default:
		return errors.New("素材状态只能是 inbox、processed 或 dismissed")
	}
	result, err := db.ExecContext(ctx, "UPDATE materials SET inbox_status = ?, updated_at = ? WHERE id = ? AND is_deleted = 0", status, now, id)
	if err != nil {
		return err
	}
	changed, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if changed == 0 {
		return errors.New("素材不存在或已删除")
	}
	return nil
}

// ToCard 按桌面端 materialToCard 的规则生成卡片正文：分类「随手笔记」、
// 摘要取前 160 个 UTF-16 码元（与前端 slice 同义）、来源链接单列一条。
func ToCard(material Material, cardID string, now int64) cards.EditableCard {
	headline := strings.TrimSpace(material.Title)
	if headline == "" {
		if line := strings.SplitN(material.RawText, "\n", 2)[0]; line != "" {
			headline = line
		}
	}
	card := cards.EditableCard{
		ID:      cardID,
		Content: cards.Content{Category: "随手笔记", Headline: headline, Summary: utf16Slice(material.RawText, 160), Details: material.RawText, Tags: []string{}},
	}
	if material.SourceURL != nil && *material.SourceURL != "" {
		card.Links = []cards.ScienceLink{{Title: "原始来源", URL: *material.SourceURL}}
	}
	if material.ID != "" {
		card.MaterialID = &material.ID
	}
	card.Source = "imported"
	return card
}

// utf16Slice 取前 limit 个 UTF-16 码元：与 JavaScript 的 slice 语义一致，
// emoji 等增补字符按两个码元计。
func utf16Slice(text string, limit int) string {
	units := utf16.Encode([]rune(text))
	if len(units) <= limit {
		return text
	}
	return string(utf16.Decode(units[:limit]))
}

// ConvertToCard 把素材变成卡片并标为已处理：卡片与素材状态在同一事务里提交。
// 已经有卡片的素材不会重复建卡，只把状态推进到 processed。
func ConvertToCard(ctx context.Context, db *sql.DB, materialID, cardID string, now int64) (bool, error) {
	if materialID == "" || cardID == "" {
		return false, errors.New("素材或卡片标识无效")
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer tx.Rollback()
	var material Material
	var sourceURL, cleaned, media sql.NullString
	err = tx.QueryRowContext(ctx, "SELECT "+materialColumns+" FROM materials WHERE id = ? AND is_deleted = 0", materialID).
		Scan(&material.ID, &material.SourceType, &material.Title, &sourceURL, &material.RawText, &cleaned,
			&material.ContentHash, &media, &material.MediaSizeBytes, &material.MetadataJSON, &material.InboxStatus,
			&material.CreatedAt, &material.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return false, errors.New("素材不存在或已删除")
	}
	if err != nil {
		return false, err
	}
	material.SourceURL, material.CleanedMarkdown, material.MediaPath = nullText(sourceURL), nullText(cleaned), nullText(media)

	var existing string
	err = tx.QueryRowContext(ctx, "SELECT id FROM cards WHERE material_id = ? AND is_deleted = 0", materialID).Scan(&existing)
	switch {
	case err == nil:
		created := false
		if err := markProcessed(ctx, tx, materialID, now); err != nil {
			return false, err
		}
		return created, tx.Commit()
	case !errors.Is(err, sql.ErrNoRows):
		return false, err
	}
	if err := cards.SaveContentTx(ctx, tx, ToCard(material, cardID, now), now); err != nil {
		return false, err
	}
	if err := markProcessed(ctx, tx, materialID, now); err != nil {
		return false, err
	}
	return true, tx.Commit()
}

func markProcessed(ctx context.Context, tx *sql.Tx, id string, now int64) error {
	result, err := tx.ExecContext(ctx, "UPDATE materials SET inbox_status = 'processed', updated_at = ? WHERE id = ? AND is_deleted = 0", now, id)
	if err != nil {
		return err
	}
	changed, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if changed == 0 {
		return errors.New("素材不存在或已删除")
	}
	return nil
}

var _ = json.Marshal
