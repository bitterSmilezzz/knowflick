package library

import (
	"context"
	"database/sql"
	"encoding/json"

	"errors"
	"fmt"
	"knowflick.local/workbench-go/internal/archive"
)

// restoreDeletedRecords 恢复回收站墓碑：目标已有同标识但非删除态即冲突。
func restoreDeletedRecords(ctx context.Context, tx *sql.Tx, backup archive.SystemBackup) (int, int, int, error) {
	if len(backup.DeletedRecords) == 0 {
		return 0, 0, 0, nil
	}
	var snapshot deletedRecordsSnapshot
	if err := json.Unmarshal(backup.DeletedRecords, &snapshot); err != nil || snapshot.Version != 1 {
		return 0, 0, 0, errors.New("deleted_records.json 结构无效")
	}
	counts := [3]int{}
	for _, record := range snapshot.Materials {
		var deleted int64
		err := tx.QueryRowContext(ctx, "SELECT is_deleted FROM materials WHERE id = ?", record.Material.ID).Scan(&deleted)
		if err == nil {
			if deleted != 1 {
				return 0, 0, 0, errors.New("本地存在同标识的活动素材，未恢复回收站内容")
			}
			continue
		} else if !errors.Is(err, sql.ErrNoRows) {
			return 0, 0, 0, fmt.Errorf("读取本地回收站素材失败：%w", err)
		}
		if _, err := tx.ExecContext(ctx, "INSERT INTO materials (id,source_type,title,source_url,raw_text,cleaned_markdown,content_hash,media_path,media_size_bytes,metadata_json,inbox_status,created_at,updated_at,is_deleted,deleted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,?)",
			record.Material.ID, record.Material.SourceType, record.Material.Title, record.Material.SourceURL, record.Material.RawText, record.Material.CleanedMarkdown, record.Material.ContentHash, record.Material.MediaPath, record.Material.MediaSizeBytes, record.Material.MetadataJSON, record.Material.InboxStatus, record.Material.CreatedAt, record.Material.UpdatedAt, record.DeletedAt); err != nil {
			return 0, 0, 0, fmt.Errorf("恢复回收站素材失败：%w", err)
		}
		counts[0]++
	}
	for _, record := range snapshot.Cards {
		var deleted int64
		err := tx.QueryRowContext(ctx, "SELECT is_deleted FROM cards WHERE id = ?", record.Card.ID).Scan(&deleted)
		if err == nil {
			if deleted != 1 {
				return 0, 0, 0, errors.New("本地存在同标识的活动卡片，未恢复回收站内容")
			}
			continue
		} else if !errors.Is(err, sql.ErrNoRows) {
			return 0, 0, 0, fmt.Errorf("读取本地回收站卡片失败：%w", err)
		}
		links, tags, prereq, err := encodeCardJSON(record.Card)
		if err != nil {
			return 0, 0, 0, err
		}
		if _, err := tx.ExecContext(ctx, "INSERT INTO cards (id,material_id,category,headline,summary,details,links_json,tags_json,source,seen_at,swiped,is_favorite,favorited_at,review_count,mastery_level,last_reviewed_at,repetition,interval_days,ease_factor,stability,difficulty,subject,branch,level,track,order_key,prereq_json,created_at,edited_at,updated_at,is_deleted,deleted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?)",
			record.Card.ID, record.Card.MaterialID, record.Card.Category, record.Card.Headline, record.Card.Summary, record.Card.Details, links, tags, record.Card.Source, record.Card.SeenAt, record.Card.Swiped, favoriteValue(record.Card.IsFavorite), record.Card.FavoritedAt, record.Card.ReviewCount, record.Card.MasteryLevel, record.Card.LastReviewedAt, record.Card.Repetition, record.Card.IntervalDays, record.Card.EaseFactor, record.Card.Stability, record.Card.Difficulty, record.Card.Subject, record.Card.Branch, record.Card.Level, record.Card.Track, record.Card.OrderKey, prereq, record.Card.CreatedAt, record.Card.EditedAt, record.Card.CreatedAt, record.DeletedAt); err != nil {
			return 0, 0, 0, fmt.Errorf("恢复回收站卡片失败：%w", err)
		}
		counts[1]++
	}
	for _, artifact := range snapshot.Artifacts {
		var deleted int64
		err := tx.QueryRowContext(ctx, "SELECT is_deleted FROM artifacts WHERE id = ?", artifact.ID).Scan(&deleted)
		if err == nil {
			if deleted != 1 {
				return 0, 0, 0, errors.New("本地存在同标识的活动产物，未恢复回收站内容")
			}
			continue
		} else if !errors.Is(err, sql.ErrNoRows) {
			return 0, 0, 0, fmt.Errorf("读取本地回收站产物失败：%w", err)
		}
		cardIDs, noteIDs, err := encodeArtifactIDs(artifact)
		if err != nil {
			return 0, 0, 0, err
		}
		if _, err := tx.ExecContext(ctx, "INSERT INTO artifacts (id,artifact_type,title,content_markdown,source_card_ids,source_note_ids,date_scope_start,date_scope_end,created_at,updated_at,is_deleted) VALUES (?,?,?,?,?,?,?,?,?,?,1)",
			artifact.ID, artifact.ArtifactType, artifact.Title, artifact.ContentMarkdown, cardIDs, noteIDs, artifact.DateScopeStart, artifact.DateScopeEnd, artifact.CreatedAt, artifact.UpdatedAt); err != nil {
			return 0, 0, 0, fmt.Errorf("恢复回收站产物失败：%w", err)
		}
		counts[2]++
	}
	return counts[0], counts[1], counts[2], nil
}
