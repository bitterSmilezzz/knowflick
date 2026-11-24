package library

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"knowflick.local/workbench-go/internal/errtext"

	"knowflick.local/workbench-go/internal/archive"
	"knowflick.local/workbench-go/internal/cards"
)

type deletedMaterialRecord struct {
	Material  backupMaterial `json:"material"`
	DeletedAt *int64         `json:"deletedAt"`
}

type deletedCardRecord struct {
	Card      cards.Card `json:"card"`
	DeletedAt *int64     `json:"deletedAt"`
}

type deletedRecordsSnapshot struct {
	Version   int                     `json:"version"`
	Materials []deletedMaterialRecord `json:"materials"`
	Cards     []deletedCardRecord     `json:"cards"`
	Artifacts []backupArtifact        `json:"artifacts"`
}

func captureDeletedRecords(ctx context.Context, tx *sql.Tx, activeMaterials []backupMaterial) (deletedRecordsSnapshot, error) {
	snapshot := deletedRecordsSnapshot{Version: 1, Materials: []deletedMaterialRecord{}, Cards: []deletedCardRecord{}, Artifacts: []backupArtifact{}}
	materials, err := readBackupRows(ctx, tx, `SELECT id,source_type,title,source_url,raw_text,cleaned_markdown,content_hash,media_path,media_size_bytes,metadata_json,inbox_status,created_at,updated_at,deleted_at FROM materials WHERE is_deleted=1 ORDER BY created_at DESC`,
		func(rows *sql.Rows, item *deletedMaterialRecord) error {
			return rows.Scan(&item.Material.ID, &item.Material.SourceType, &item.Material.Title, &item.Material.SourceURL, &item.Material.RawText,
				&item.Material.CleanedMarkdown, &item.Material.ContentHash, &item.Material.MediaPath, &item.Material.MediaSizeBytes,
				&item.Material.MetadataJSON, &item.Material.InboxStatus, &item.Material.CreatedAt, &item.Material.UpdatedAt, &item.DeletedAt)
		})
	if err != nil {
		return snapshot, errtext.Wrap("读取备份回收站素材失败", err)
	}
	snapshot.Materials = materials
	deletedCards, err := cards.ListDeleted(ctx, tx)
	if err != nil {
		return snapshot, errtext.Wrap("读取备份回收站卡片失败", err)
	}
	for _, item := range deletedCards {
		snapshot.Cards = append(snapshot.Cards, deletedCardRecord{Card: item.Card, DeletedAt: item.DeletedAt})
	}
	artifacts, err := readBackupRows(ctx, tx, `SELECT id,artifact_type,title,content_markdown,source_card_ids,source_note_ids,date_scope_start,date_scope_end,created_at,updated_at,is_deleted FROM artifacts WHERE is_deleted=1 ORDER BY created_at DESC`, scanBackupArtifact)
	if err != nil {
		return snapshot, errtext.Wrap("读取备份回收站产物失败", err)
	}
	snapshot.Artifacts = artifacts
	available := map[string]bool{}
	for _, item := range activeMaterials {
		available[item.ID] = true
	}
	materialIDs := map[string]bool{}
	for _, record := range snapshot.Materials {
		id := record.Material.ID
		if id == "" || materialIDs[id] || available[id] {
			return snapshot, fmt.Errorf("回收站素材标识为空或重复")
		}
		if record.DeletedAt != nil && *record.DeletedAt < 0 {
			return snapshot, fmt.Errorf("回收站素材删除时间无效")
		}
		if record.Material.MediaPath != nil && !archive.IsSystemMediaPath(*record.Material.MediaPath) {
			return snapshot, fmt.Errorf("回收站素材附件路径无效")
		}
		materialIDs[id] = true
		available[id] = true
	}
	cardIDs := map[string]bool{}
	for _, record := range snapshot.Cards {
		id := record.Card.ID
		if id == "" || cardIDs[id] {
			return snapshot, fmt.Errorf("回收站卡片标识为空或重复")
		}
		if record.DeletedAt != nil && *record.DeletedAt < 0 {
			return snapshot, fmt.Errorf("回收站卡片删除时间无效")
		}
		if record.Card.MaterialID != nil && !available[*record.Card.MaterialID] {
			return snapshot, fmt.Errorf("回收站卡片引用的来源素材未纳入备份或本机资料库")
		}
		cardIDs[id] = true
	}
	artifactIDs := map[string]bool{}
	for _, artifact := range snapshot.Artifacts {
		if artifact.ID == "" || artifactIDs[artifact.ID] || !artifact.IsDeleted {
			return snapshot, fmt.Errorf("回收站产物标识重复或删除状态无效")
		}
		artifactIDs[artifact.ID] = true
	}
	encoded, err := json.Marshal(snapshot)
	if err != nil {
		return snapshot, err
	}
	_ = encoded
	return snapshot, nil
}
